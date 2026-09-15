// Phase 6.0 — DYNAMIC PERMISSION RESOLUTION.
//
// Turns the two company-scoped assignment collections (RolePermission, UserPermissionOverride) into
// one resolved decision set for ONE user in ONE company, which services/permissionService.js then
// consults synchronously. Resolution happens once per request (middleware/permissions.js), never
// once per permission check.
//
// =============================================================================================
// PRECEDENCE (FINAL — the exact order, no silent merging)
// =============================================================================================
//
//   0. role === 'super'                      -> ALLOW everything
//                                               (API_ARCHITECTURE.md §7 "if super → allow", unchanged
//                                               from Phase 1. Super's business-record MUTATIONS are
//                                               still gated separately by the Support-Op path in
//                                               middleware/ownership.js — a permission bypass is not
//                                               a mutation bypass. This function does not special-case
//                                               super at all; middleware/permissions.js short-circuits
//                                               before calling it, so no super shortcut is buried in
//                                               the resolution logic. Spec §H.)
//
//   1. UserPermissionOverride granted=false  -> DENY   (explicit per-user REVOKE — highest priority)
//   2. UserPermissionOverride granted=true   -> ALLOW  (explicit per-user GRANT)
//   3. RolePermission        granted=false   -> DENY   (explicit role-level REVOKE for this company)
//   4. RolePermission        granted=true    -> ALLOW  (role default for this company)
//   5. legacy User.permissions[]             -> ALLOW  (Phase 1-5 compatibility layer, incl. '*')
//   6. otherwise                             -> DENY
//
// Two rules are doing the real work here:
//
//   * WITHIN a level, revoke beats grant. This mirrors DOCUMENT_AUTHORITY.md's frozen Canonical
//     Effective-Entitlement Precedence ("EXPLICIT MANUAL DISABLE > EXPLICIT MANUAL ENABLE"), so the
//     platform has ONE precedence philosophy rather than a different one per subsystem.
//   * ACROSS levels, the more specific level wins: a per-user row (grant OR revoke) always beats the
//     role row, which is what "must apply after role permissions" (spec §B) means. A per-user GRANT
//     can therefore restore a permission the role revokes — that is deliberate, and is the mechanism
//     for "different users with same role but different overrides" (spec §J.7).
//
// Levels 1-4 never "merge" with each other: for any single code, exactly one level decides, and the
// decision is recorded with the level that made it (`sources`), so an administration UI can always
// explain WHY a user holds or lacks a code.
//
// =============================================================================================
// WHY THE LEGACY LAYER (level 5) STILL EXISTS
// =============================================================================================
// Removing it would be a silent, platform-wide DOWNGRADE of every existing user: today every
// Phase 1-5 authorization decision reads `User.permissions[]`, and no company has any RolePermission
// row yet (this phase creates the collections empty). Dropping level 5 would lock every existing
// user out of every protected route the moment this phase deploys.
//
// It is a compatibility BASELINE, not an escape hatch: it only ever GRANTS, and both revoke levels
// outrank it — including against its '*' wildcard (spec §I: "revoked permission cannot be used merely
// because role grants it"). A later phase retires it per company once that company's matrix is
// populated, exactly as `Company.settings.enforceEntitlements` retires entitlement log-only mode.
const RolePermission = require('../models/RolePermission');
const UserPermissionOverride = require('../models/UserPermissionOverride');
const { isConnected } = require('../db/connection');
const { logger } = require('../utils/logger');

// The level that decided a code — surfaced to the administration API so a matrix screen can show
// the provenance of every cell instead of a bare yes/no.
const SOURCES = Object.freeze({
  USER_REVOKE: 'user_revoke',
  USER_GRANT: 'user_grant',
  ROLE_REVOKE: 'role_revoke',
  ROLE_GRANT: 'role_grant',
});

class PermissionResolutionError extends Error {
  constructor(message, code = 'PERMISSION_RESOLUTION_FAILED') {
    super(message);
    this.name = 'PermissionResolutionError';
    this.code = code;
  }
}

function idOf(value) {
  return value == null ? null : String(value);
}

async function toArray(query) {
  const result = typeof query?.lean === 'function' ? await query.lean() : await query;
  return Array.isArray(result) ? result : [];
}

/**
 * resolveEffectivePermissions — reads the two company-scoped collections and applies levels 1-4.
 *
 * Returns `null` when v3 has no live database connection. That is NOT a silent failure: it means
 * this process has no dynamic assignment store to consult (a unit test, or a caller running before
 * connectV3DB()), so permissionService falls through to level 5 and behaves exactly as it did in
 * Phases 1-5. A resolution that FAILS while the database IS connected throws instead — an unreadable
 * revoke must never be mistaken for an absent one.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.companyId  ALWAYS the authenticated company — never a client value.
 * @param {string|ObjectId} params.userId
 * @param {string} params.designation         resolved designation (services/roleResolver.js)
 * @returns {Promise<{granted:string[], revoked:string[], sources:Object, designation:string}|null>}
 */
async function resolveEffectivePermissions({ companyId, userId, designation }) {
  if (!isConnected()) return null;
  if (companyId == null) {
    // A resolution with no company scope would be a cross-tenant read by construction.
    throw new PermissionResolutionError('A permission resolution always requires a company scope', 'COMPANY_SCOPE_REQUIRED');
  }

  let roleRows = [];
  let userRows = [];
  try {
    // Both queries are company-scoped at the driver level — company isolation is not something the
    // caller can forget to apply (spec §H).
    [roleRows, userRows] = await Promise.all([
      designation
        ? toArray(RolePermission.find({ co: companyId, designation }))
        : Promise.resolve([]),
      userId
        ? toArray(UserPermissionOverride.find({ co: companyId, userId }))
        : Promise.resolve([]),
    ]);
  } catch (err) {
    // Connected but unreadable: fail loudly. Falling back to level 5 here would quietly ignore every
    // revoke in the company.
    logger.error('permission_resolution_failed', { message: err.message });
    throw new PermissionResolutionError(`Permission resolution failed: ${err.message}`);
  }

  const granted = new Set();
  const revoked = new Set();
  const sources = {};

  // Level 4 then 3: role grants first, role revokes overwrite them.
  for (const row of roleRows) {
    if (row.granted) {
      granted.add(row.permissionCode);
      sources[row.permissionCode] = SOURCES.ROLE_GRANT;
    }
  }
  for (const row of roleRows) {
    if (!row.granted) {
      granted.delete(row.permissionCode);
      revoked.add(row.permissionCode);
      sources[row.permissionCode] = SOURCES.ROLE_REVOKE;
    }
  }

  // Level 2 then 1: the per-user level overwrites whatever the role level decided, in both
  // directions, and the revoke pass runs last so a contradictory pair of rows can never leave a code
  // granted (the unique index makes such a pair impossible, but the order is not left to chance).
  for (const row of userRows) {
    if (row.granted) {
      revoked.delete(row.permissionCode);
      granted.add(row.permissionCode);
      sources[row.permissionCode] = SOURCES.USER_GRANT;
    }
  }
  for (const row of userRows) {
    if (!row.granted) {
      granted.delete(row.permissionCode);
      revoked.add(row.permissionCode);
      sources[row.permissionCode] = SOURCES.USER_REVOKE;
    }
  }

  return {
    designation: designation || null,
    companyId: idOf(companyId),
    userId: idOf(userId),
    granted: [...granted].sort(),
    revoked: [...revoked].sort(),
    sources,
  };
}

/**
 * describeUserPermissions — the administration read model for one user: what they hold, what was
 * taken away, and which level decided each. Includes the legacy layer explicitly so an administrator
 * can SEE that a user's authority currently comes from the compatibility baseline rather than from a
 * populated matrix (which is exactly the signal that tells them to populate it).
 */
async function describeUserPermissions({ user, companyId }) {
  const resolution = await resolveEffectivePermissions({
    companyId,
    userId: user?._id ?? user?.id,
    designation: user?.designation,
  });
  const legacy = Array.isArray(user?.permissions) ? [...user.permissions] : [];
  const revoked = resolution ? resolution.revoked : [];
  return {
    userId: idOf(user?._id ?? user?.id),
    designation: user?.designation ?? null,
    dynamic: resolution ? { granted: resolution.granted, revoked, sources: resolution.sources } : null,
    legacyCompatibilityGrants: legacy,
    // The final answer a request would get, legacy layer included, minus anything revoked.
    effective: [...new Set([...(resolution?.granted || []), ...legacy])]
      .filter((code) => !revoked.includes(code))
      .sort(),
  };
}

module.exports = {
  resolveEffectivePermissions,
  describeUserPermissions,
  PermissionResolutionError,
  SOURCES,
};
