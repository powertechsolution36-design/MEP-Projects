'use strict';

const { ServiceError } = require('../errors');
const { ROLES } = require('../models/shared/enums');
const { assertRoleAllowedForCompany } = require('../auth/roleDivision');
const { toSafeUser } = require('../auth/authService');

/**
 * User Management (FIX-3.8-01, P0).
 *
 * Source of truth: MEP_PROJECTS_PWA/index.html "ADMIN: USERS" section
 * (`vUsers`, `mUser`, `saveUser`, `delUser` — lines ~1819-1850), reachable
 * only via the `admin` role's own MENUS entry (`["users","👥 Users"]`; no
 * other role's MENUS array contains "users"). See
 * new-app/docs/E2E_PASS_3_8_MASTER_RECONCILIATION.md for the gap this
 * closes and new-app/docs/API_CONTRACT.md for the mounted routes.
 *
 * PWA FACTS reproduced exactly:
 *  - List (`vUsers`) is every user of the admin's own company
 *    (`mine(DB.users)`), searchable by name/username/role client-side — no
 *    further server-side filter existed to reproduce beyond company scope.
 *  - Create/Edit (`mUser`/`saveUser`) fields: name, role, username,
 *    password. The role `<select>` explicitly skips `"super"`
 *    (`if(r==="super")return`) and skips any PM role (hvac_pm/solar_pm/
 *    mep_pm) whose division the company doesn't subscribe to (`hasDiv`,
 *    `ROLE_DIV`) — reproduced here via `assertRoleAllowedForCompany`, the
 *    SAME helper `companyService.createCompanyWithAdmin` already uses for
 *    the bootstrap admin.
 *  - `saveUser` requires only name + username to be non-blank
 *    (`if(!gv("u_n")||!gv("u_u"))`); it has NO duplicate-username check on
 *    this path (only the separate company-bootstrap path checks that,
 *    `index.html:1789`). This backend already enforces company-scoped
 *    username uniqueness as a pre-existing NEW BACKEND DESIGN DECISION
 *    (`User.js`'s `{companyId,username}` unique index, OPEN_DECISIONS.md
 *    #12) — applied here too, for the same reason
 *    `companyService.createCompanyWithAdmin` already applies it: not a new
 *    decision introduced by this fix, just applied consistently.
 *  - Delete (`delUser`) is a HARD delete with NO cascade — the PWA leaves
 *    every other module's copied name (or, in NEW APP, ObjectId reference)
 *    untouched after a user is removed; matched exactly here, no cascade
 *    added.
 *  - `delUser`'s only restriction in the PWA is a UI-level one (the
 *    "Remove" button is not rendered for the caller's own row,
 *    `u.id!==U.id` in `vUsers`) — the `delUser()` function itself has no
 *    such guard. This is enforced HERE, server-side, as an approved
 *    "server-side authorization matching PWA-visible intent" exception —
 *    an admin locking themselves out by deleting their own login is never
 *    a PWA-*intended* action, only a client-side omission of a guard the
 *    UI clearly means to enforce (same category of exception already
 *    applied elsewhere in this codebase, e.g. ServiceCall/Inventory tenant
 *    scoping).
 *  - PASSWORD ADAPTATION (the one approved security exception for this
 *    task): the PWA stores AND DISPLAYS the plaintext password (`u.pw`) in
 *    the clear, including in the Users list table itself. NEW APP never
 *    accepts, stores, logs, or returns a plaintext password beyond the
 *    single hashing call in `src/auth/passwordHasher.js`. Create requires
 *    a password (hashed immediately, never persisted in the clear). Edit's
 *    password field is OPTIONAL (omit it to keep the existing hash) —
 *    unlike the PWA, the client can never read back the current password
 *    to "leave it as-is" by resubmitting the same value, so omission is
 *    the correct analog of "didn't touch the password field".
 *  - No notification of any kind fires for create/edit/delete of a User —
 *    confirmed by grep of the PWA's entire "ADMIN: USERS" block: zero
 *    `notify()` call sites (unlike Enquiry/SalesOrder/Payment/Checklist/
 *    Project/Contract/ServiceCall/Inventory, which together account for
 *    all 25 documented notification triggers).
 *  - PWA has NO deactivate/disable state for a User (only the hard delete
 *    above) — `User.js`'s `active` boolean is a pre-existing, separate NEW
 *    BACKEND DESIGN field (already load-bearing for `authService.login`,
 *    which rejects `active:false`), not a PWA-observed feature. Per this
 *    task's explicit instruction not to invent CRUD the PWA doesn't
 *    demonstrate, this module does NOT expose a way to flip `active`
 *    through the User-management API — the PWA never demonstrates a
 *    deactivate workflow, only delete, so only delete is implemented here.
 */

const ADMIN_ONLY = Object.freeze(['admin']);

function assertCompanyContext(actorAuth) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
}

// PWA FACT: only `admin`'s MENUS array contains "users" — no other role has
// any menu path to vUsers/mUser/saveUser/delUser. Enforced HERE,
// server-side; the PWA only ever hid the menu item.
function assertIsAdmin(actorAuth, actionDescription) {
  if (!ADMIN_ONLY.includes(actorAuth.role)) {
    throw new ServiceError(
      `Role "${actorAuth.role}" is not permitted to ${actionDescription} (must be admin).`,
      'FORBIDDEN',
      403
    );
  }
}

function assertNonBlank(value, fieldLabel) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServiceError(`${fieldLabel} is required.`, 'VALIDATION_ERROR', 400);
  }
}

// PWA FACT (`mUser`'s role <select>): "super" is never offered as an
// assignable role from the Users screen.
function assertAssignableRole(role) {
  if (!ROLES.includes(role)) {
    throw new ServiceError(`Unknown role "${role}".`, 'VALIDATION_ERROR', 400);
  }
  if (role === 'super') {
    throw new ServiceError('Role "super" cannot be assigned through company User management.', 'VALIDATION_ERROR', 400);
  }
}

async function requireCompany(actorAuth, deps) {
  const company = await deps.companyRepo.findById(actorAuth.companyId);
  if (!company) {
    throw new ServiceError('Company not found.', 'NOT_FOUND', 404);
  }
  return company;
}

/**
 * GET /api/users — PWA: vUsers()'s `mine(DB.users)`. admin-only, company-scoped.
 */
async function listUsers(actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertIsAdmin(actorAuth, 'view Users');
  const users = await deps.userWriteRepo.listByCompany(actorAuth.companyId);
  return users.map(toSafeUser);
}

/**
 * GET /api/users/:id — supports an eventual edit-modal prefill
 * (`mUser(id)`'s `DB.users.find(...)`). admin-only, company-scoped.
 */
async function getUser(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertIsAdmin(actorAuth, 'view a User');
  const user = await deps.userWriteRepo.findByIdAndCompany(actorAuth.companyId, id);
  if (!user) throw new ServiceError('User not found.', 'NOT_FOUND', 404);
  return toSafeUser(user);
}

/**
 * POST /api/users — PWA: `mUser()`/`saveUser()` (create branch, no id).
 */
async function createUser(input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertIsAdmin(actorAuth, 'create a User');
  const src = input || {};
  assertNonBlank(src.name, 'Name');
  assertNonBlank(src.username, 'Username');
  assertNonBlank(src.password, 'Password');
  assertNonBlank(src.role, 'Role');
  assertAssignableRole(src.role);

  const company = await requireCompany(actorAuth, deps);
  assertRoleAllowedForCompany(src.role, company);

  const taken = await deps.userWriteRepo.existsByCompanyAndUsername(actorAuth.companyId, src.username);
  if (taken) {
    throw new ServiceError(`Username "${src.username}" is already taken in this company.`, 'ALREADY_EXISTS', 409);
  }

  const passwordHash = await deps.passwordHasher.hashPassword(src.password);

  const user = await deps.userWriteRepo.create({
    companyId: actorAuth.companyId,
    name: src.name,
    username: src.username,
    role: src.role,
    passwordHash,
    active: true,
  });

  return toSafeUser(user);
}

/**
 * PATCH /api/users/:id — PWA: `mUser(id)`/`saveUser(id)` (edit branch) for
 * name/username/role; also covers "role (re)assignment" and "password
 * change" (both are just fields `saveUser` unconditionally overwrites in
 * the PWA — there is no separate PWA action for either).
 */
async function updateUser(id, input, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertIsAdmin(actorAuth, 'edit a User');
  const existing = await deps.userWriteRepo.findByIdAndCompany(actorAuth.companyId, id);
  if (!existing) throw new ServiceError('User not found.', 'NOT_FOUND', 404);

  const src = input || {};
  const patch = {};

  if (src.name !== undefined) {
    assertNonBlank(src.name, 'Name');
    patch.name = src.name;
  }
  if (src.username !== undefined) {
    assertNonBlank(src.username, 'Username');
    if (src.username !== existing.username) {
      const taken = await deps.userWriteRepo.existsByCompanyAndUsername(actorAuth.companyId, src.username);
      if (taken) {
        throw new ServiceError(`Username "${src.username}" is already taken in this company.`, 'ALREADY_EXISTS', 409);
      }
    }
    patch.username = src.username;
  }
  if (src.role !== undefined) {
    assertAssignableRole(src.role);
    const company = await requireCompany(actorAuth, deps);
    assertRoleAllowedForCompany(src.role, company);
    patch.role = src.role;
  }
  if (src.password !== undefined) {
    assertNonBlank(src.password, 'Password');
    patch.passwordHash = await deps.passwordHasher.hashPassword(src.password);
  }

  if (Object.keys(patch).length === 0) {
    return toSafeUser(existing);
  }

  const updated = await deps.userWriteRepo.updateByIdAndCompany(actorAuth.companyId, id, patch);
  return toSafeUser(updated);
}

/**
 * DELETE /api/users/:id — PWA: `delUser(id)`. Hard delete, no cascade (PWA
 * FACT). Self-delete is blocked server-side — see module doc comment.
 */
async function deleteUser(id, actorAuth, deps) {
  assertCompanyContext(actorAuth);
  assertIsAdmin(actorAuth, 'remove a User');
  const existing = await deps.userWriteRepo.findByIdAndCompany(actorAuth.companyId, id);
  if (!existing) throw new ServiceError('User not found.', 'NOT_FOUND', 404);

  if (String(existing.id) === String(actorAuth.userId)) {
    throw new ServiceError('You cannot remove your own login.', 'FORBIDDEN', 403);
  }

  await deps.userWriteRepo.deleteByIdAndCompany(actorAuth.companyId, id);
  return { deleted: true, id: existing.id };
}

module.exports = {
  ADMIN_ONLY,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
};
