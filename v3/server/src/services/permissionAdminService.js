// Phase 6.0 — permission ADMINISTRATION writes (the only sanctioned path that changes who holds
// what). Reads live in services/permissionResolutionService.js.
//
// Every write here is: company-scoped, validated against the catalog, explicit about grant vs
// revoke, idempotent, and audited through the Phase 4 infrastructure (services/auditService.js
// runAudited) — never a second audit mechanism (spec §F).
const Permission = require('../models/Permission');
const RolePermission = require('../models/RolePermission');
const UserPermissionOverride = require('../models/UserPermissionOverride');
const User = require('../models/User');
const { AUDIT_ACTIONS, DESIGNATION_VALUES } = require('../config/constants');
const { DEFAULT_ROLE_PERMISSIONS } = require('../config/permissionCatalog');
const { LEGACY_ROLE_MAP } = require('./roleResolver');
const { runAudited } = require('./auditService');
const {
  ROLE_PERMISSION_RESOURCE, USER_PERMISSION_OVERRIDE_RESOURCE,
} = require('../config/permissionPolicy');   // registers the resource policies on import

class PermissionAdminError extends Error {
  constructor(message, code = 'PERMISSION_ADMIN_ERROR', status = 422, details) {
    super(message);
    this.name = 'PermissionAdminError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function resolveQuery(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function toArray(query) {
  const result = await resolveQuery(query);
  return Array.isArray(result) ? result : [];
}

// ---------------------------------------------------------------------------------------------
// Company scope — never derived from a client-supplied `companyId`/`co` (enforceTenantScope strips
// those). A Super Admin operating across companies must name the target EXPLICITLY, using the
// `targetCompanyId` convention Phase 3 established for exactly this situation.
// ---------------------------------------------------------------------------------------------
function companyScopeFor(req) {
  if (req.user?.role === 'super') {
    const target = req.body?.targetCompanyId || req.query?.targetCompanyId || req.tenantCompanyId;
    if (!target) {
      throw new PermissionAdminError(
        'A Super Admin permission-administration call must name an explicit targetCompanyId',
        'TARGET_COMPANY_REQUIRED', 422,
      );
    }
    return target;
  }
  return req.user?.co;
}

/**
 * normalizeDesignation — the `:role` path parameter accepts EITHER a frozen designation or a legacy
 * v2 role, per the disclosed decision in models/RolePermission.js. Legacy roles resolve through the
 * existing LEGACY_ROLE_MAP; nothing here rewrites any stored `role` value.
 */
function normalizeDesignation(role) {
  if (!role) throw new PermissionAdminError('A role or designation is required', 'ROLE_REQUIRED');
  if (DESIGNATION_VALUES.includes(role)) return role;
  const mapped = LEGACY_ROLE_MAP[role];
  if (mapped?.designation) return mapped.designation;
  throw new PermissionAdminError(`Unknown role or designation: ${role}`, 'UNKNOWN_ROLE', 422);
}

/**
 * assertNoConflicts — "Do NOT silently merge conflicting grants/revokes" (spec §B). The same code
 * appearing twice with opposite intent is an ambiguous request, not something to resolve by
 * last-one-wins.
 */
function normalizeEntries(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new PermissionAdminError(
      'permissions[] must be a non-empty array of { code, granted }', 'PERMISSIONS_REQUIRED',
    );
  }
  const byCode = new Map();
  for (const entry of permissions) {
    const code = entry?.code;
    if (!code || typeof code !== 'string') {
      throw new PermissionAdminError('Every permissions[] entry needs a string code', 'INVALID_PERMISSION_ENTRY');
    }
    if (typeof entry.granted !== 'boolean') {
      throw new PermissionAdminError(
        `permissions[${code}].granted must be an explicit boolean — grant and revoke are never inferred`,
        'GRANTED_REQUIRED',
      );
    }
    if (byCode.has(code) && byCode.get(code) !== entry.granted) {
      throw new PermissionAdminError(
        `Conflicting grant and revoke for the same permission in one request: ${code}`,
        'CONFLICTING_PERMISSION_ENTRIES', 422,
      );
    }
    byCode.set(code, entry.granted);
  }
  return [...byCode.entries()].map(([code, granted]) => ({ code, granted }));
}

/** Every code must exist in the platform catalog and be active — no free-text permission strings. */
async function assertCodesInCatalog(codes) {
  const rows = await toArray(Permission.find({ code: { $in: codes }, active: true }));
  const known = new Set(rows.map((r) => r.code));
  const unknown = codes.filter((c) => !known.has(c));
  if (unknown.length) {
    throw new PermissionAdminError(
      `Unknown or inactive permission code(s): ${unknown.join(', ')}`, 'UNKNOWN_PERMISSION', 422,
      { unknown },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Shared upsert — one row, audited atomically, idempotent.
// ---------------------------------------------------------------------------------------------
async function applyAssignment({ req, Model, resource, filter, granted, reason, source, auditAfter }) {
  const existing = await resolveQuery(Model.findOne(filter));

  // Idempotent: an assignment already in the requested state is not rewritten and not re-audited.
  if (existing && existing.granted === granted) {
    return { row: existing, changed: false };
  }

  const action = granted ? AUDIT_ACTIONS.PERMISSION_GRANTED : AUDIT_ACTIONS.PERMISSION_REVOKED;
  const before = existing ? { granted: existing.granted } : null;

  const row = await runAudited({
    req,
    action,
    resource,
    reason,
    before,
    after: { ...auditAfter, granted },
    mutate: async () => {
      if (existing) {
        return resolveQuery(Model.findOneAndUpdate(
          filter,
          { $set: { granted, reason: reason ?? null, updatedByUserId: req.user?._id ?? null } },
          { new: true },
        ));
      }
      return Model.create({
        ...filter,
        granted,
        source,
        reason: reason ?? null,
        createdByUserId: req.user?._id ?? null,
        createdByName: req.user?.name ?? null,
        updatedByUserId: req.user?._id ?? null,
      });
    },
    // Non-transactional deployments: if the audit write fails, the assignment is rolled back rather
    // than left in force unaudited (spec §F — permission changes must create audit records).
    compensate: async (created) => {
      if (existing) {
        await Model.findOneAndUpdate(filter, { $set: { granted: existing.granted } });
      } else if (created?._id) {
        await Model.deleteOne({ _id: created._id });
      }
    },
    buildAudit: (result) => ({ resourceId: result?._id }),
  });

  return { row, changed: true };
}

// ---------------------------------------------------------------------------------------------
// Role-level administration
// ---------------------------------------------------------------------------------------------

async function getRolePermissions({ req, role }) {
  const designation = normalizeDesignation(role);
  const co = companyScopeFor(req);
  const rows = await toArray(RolePermission.find({ co, designation }));
  return {
    designation,
    companyId: co ? String(co) : null,
    // What this company has actually configured. An EMPTY list is meaningful: it means this company
    // has not populated its matrix, so its users still authorize through the legacy compatibility
    // layer (services/permissionResolutionService.js level 5).
    permissions: rows
      .map((r) => ({ code: r.permissionCode, granted: r.granted, source: r.source }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    templateDefaults: DEFAULT_ROLE_PERMISSIONS[designation] || [],
    configured: rows.length > 0,
  };
}

/**
 * setRolePermissions — writes explicit grant/revoke rows for ONE designation in ONE company.
 *
 * `applyDefaults: true` writes the frozen ACCESS_MATRIX.md template
 * (config/permissionCatalog.js DEFAULT_ROLE_PERMISSIONS) as real rows. That template is NEVER an
 * implicit grant — this explicit, audited, per-company action is the only way it takes effect.
 */
async function setRolePermissions({ req, role, permissions, applyDefaults = false, reason }) {
  const designation = normalizeDesignation(role);
  const co = companyScopeFor(req);

  const entries = applyDefaults
    ? (DEFAULT_ROLE_PERMISSIONS[designation] || []).map((code) => ({ code, granted: true }))
    : normalizeEntries(permissions);

  if (!entries.length) {
    throw new PermissionAdminError(
      `No default permission template exists for designation ${designation}`, 'NO_TEMPLATE', 422,
    );
  }

  await assertCodesInCatalog(entries.map((e) => e.code));

  const results = [];
  for (const entry of entries) {
    const outcome = await applyAssignment({
      req,
      Model: RolePermission,
      resource: ROLE_PERMISSION_RESOURCE,
      filter: { co, designation, permissionCode: entry.code },
      granted: entry.granted,
      reason,
      source: applyDefaults ? 'template' : 'manual',
      auditAfter: { designation, permissionCode: entry.code },
    });
    results.push({ code: entry.code, granted: entry.granted, changed: outcome.changed });
  }

  const changed = results.filter((r) => r.changed);
  if (changed.length) {
    // One summary entry in addition to the per-row entries, so an auditor can see the administrative
    // ACTION (this admin re-configured this role) and not only its individual effects.
    await runAudited({
      req,
      action: AUDIT_ACTIONS.ROLE_PERMISSION_UPDATED,
      resource: ROLE_PERMISSION_RESOURCE,
      reason,
      after: { designation, applyDefaults, changed: changed.map((c) => `${c.granted ? '+' : '-'}${c.code}`) },
      mutate: async () => null,
    });
  }

  return { designation, companyId: co ? String(co) : null, applied: results, changedCount: changed.length };
}

// ---------------------------------------------------------------------------------------------
// User-level administration
// ---------------------------------------------------------------------------------------------

/**
 * setUserPermissions — per-user grant/revoke overrides.
 *
 * The target user must be in the SAME company as the resolved administration scope: a permission
 * granted in company A can never land on a user in company B (spec §H). This is checked against the
 * stored User record, never against anything the client sent.
 */
async function setUserPermissions({ req, userId, permissions, reason }) {
  const co = companyScopeFor(req);
  const entries = normalizeEntries(permissions);
  await assertCodesInCatalog(entries.map((e) => e.code));

  const target = await resolveQuery(User.findById(userId));
  if (!target) throw new PermissionAdminError('User not found', 'USER_NOT_FOUND', 404);
  if (String(target.co) !== String(co)) {
    throw new PermissionAdminError('Cross-company access denied', 'CROSS_COMPANY_DENIED', 403);
  }
  if (!reason || !String(reason).trim()) {
    // A per-person exception always carries a written justification into AuditLog.
    throw new PermissionAdminError(
      'A reason is required when overriding an individual user\'s permissions', 'REASON_REQUIRED', 422,
    );
  }

  const results = [];
  for (const entry of entries) {
    const outcome = await applyAssignment({
      req,
      Model: UserPermissionOverride,
      resource: USER_PERMISSION_OVERRIDE_RESOURCE,
      filter: { co, userId, permissionCode: entry.code },
      granted: entry.granted,
      reason,
      source: 'manual',
      auditAfter: { userId: String(userId), permissionCode: entry.code },
    });
    results.push({ code: entry.code, granted: entry.granted, changed: outcome.changed });
  }

  return {
    userId: String(userId),
    companyId: co ? String(co) : null,
    applied: results,
    changedCount: results.filter((r) => r.changed).length,
  };
}

async function listCatalog({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { active: true };
  const rows = await toArray(Permission.find(filter));
  return rows
    .map((r) => ({
      code: r.code, name: r.name, description: r.description, category: r.category,
      module: r.module, resource: r.resource, action: r.action,
      active: r.active, systemManaged: r.systemManaged,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

module.exports = {
  getRolePermissions,
  setRolePermissions,
  setUserPermissions,
  listCatalog,
  normalizeDesignation,
  normalizeEntries,
  companyScopeFor,
  PermissionAdminError,
};
