// Phase 6.0 — the frozen PERMISSION CATALOG definition and the per-designation DEFAULT template.
//
// AUTHORITY: ACCESS_MATRIX.md PART 1 (per-role permission matrix, 12 roles + rev 4 §12A/§12B Sales
// split), ARCHITECTURE.md §P/§R (`/api/v3/permissions`, `/api/v3/roles/:role/permissions`,
// `/api/v3/users/:id/permissions`, `TeamPermissions.jsx` under Company Admin), GAP_ANALYSIS.md §5
// (`Permission { code, label, category }`), DATABASE_ARCHITECTURE.md §Access/Audit.
//
// NOTHING HERE IS INVENTED. Every code in CATALOG is one of:
//   (a) one of the ten frozen PERMISSIONS constants (config/constants.js), or
//   (b) a resource-scoped `${resource}.override` code that config/recordPolicy.js's
//       getResourcePolicy().overridePermission already resolves and middleware/ownership.js already
//       reads today, for a resource that actually has a declared policy, or
//   (c) one of the two administration codes the three documented permission-administration
//       endpoints in (ARCHITECTURE.md §P / API_ARCHITECTURE.md §2) require in order to be
//       "permission-protected" at all.
//
// ---------------------------------------------------------------------------------------------
// CRITICAL — DEFAULT_ROLE_PERMISSIONS IS A TEMPLATE, NOT AN IMPLICIT GRANT.
// ---------------------------------------------------------------------------------------------
// It is NEVER consulted during permission resolution (services/permissionResolutionService.js does
// not import it). It is applied only when an authorized administrator explicitly asks for it
// (`PUT /api/v3/roles/:role/permissions { applyDefaults: true }`), which writes real, audited
// RolePermission rows for that one company.
//
// This is deliberate and load-bearing: if the template were an implicit baseline, every existing
// Phase 1-5 user would silently gain permissions they do not hold today (an `engineer` would gain
// EDIT platform-wide), which would WEAKEN the authorization currently in force. A company that has
// never populated its matrix therefore behaves exactly as it did before Phase 6.0 — the same
// progressive-rollout discipline `Company.settings.enforceEntitlements` uses for entitlements
// (PLAN_ENTITLEMENTS.md §12 / ACCESS_MATRIX.md PART 4 "3-stage enforcement rollout").
const { PERMISSIONS, DESIGNATIONS } = require('./constants');

// The two administration codes. Named `<module>.<action>` to match the resource-scoped convention
// already established by `${resource}.override` (API_ARCHITECTURE.md §7) rather than inventing a
// second naming style.
const PERMISSION_ADMIN = Object.freeze({
  VIEW: 'permissions.view',
  MANAGE: 'permissions.manage',
});

// Categories, per GAP_ANALYSIS.md §5's `{ code, label, category }` shape.
const CATEGORIES = Object.freeze({
  GENERIC: 'generic',     // the ten frozen action verbs, applied per-resource by the route chain
  OVERRIDE: 'override',   // `${resource}.override` — explicit, never implied by role or job title
  ADMIN: 'admin',         // administration of the permission system itself
});

// Human labels for the ten frozen verbs (ACCESS_MATRIX.md PART 1 column headers).
const GENERIC_LABELS = Object.freeze({
  [PERMISSIONS.VIEW]: 'View',
  [PERMISSIONS.CREATE]: 'Create',
  [PERMISSIONS.EDIT]: 'Edit',
  [PERMISSIONS.SUBMIT]: 'Submit',
  [PERMISSIONS.APPROVE]: 'Approve',
  [PERMISSIONS.REJECT]: 'Reject',
  [PERMISSIONS.DELETE]: 'Delete',
  [PERMISSIONS.ASSIGN]: 'Assign',
  [PERMISSIONS.CLOSE]: 'Close',
  [PERMISSIONS.EXPORT]: 'Export',
});

// Resources that carry a declared record policy today (config/projectPolicy.js). Each one's
// override code is exactly what getResourcePolicy(resource).overridePermission already returns —
// the catalog documents them, it does not define a second source of truth. A future module adds
// its resource here in the same phase that calls defineResourcePolicy().
const OVERRIDE_RESOURCES = Object.freeze(['Project', 'ProjectPackage']);

function genericEntries() {
  return Object.values(PERMISSIONS).map((code) => ({
    code,
    name: GENERIC_LABELS[code],
    description: `${GENERIC_LABELS[code]} action, evaluated per resource by the route's authorization chain`,
    category: CATEGORIES.GENERIC,
    module: 'CORE',
    resource: null,
    action: code,
  }));
}

function overrideEntries() {
  return OVERRIDE_RESOURCES.map((resource) => ({
    code: `${resource}.override`,
    name: `${resource} — controlled override`,
    description:
      `Explicit authority to correct another user's ${resource} record through the audited `
      + 'RecordCorrection path. Never implied by role, job title, department or division.',
    category: CATEGORIES.OVERRIDE,
    module: 'PROJECTS',
    resource,
    action: 'override',
  }));
}

function adminEntries() {
  return [
    {
      code: PERMISSION_ADMIN.VIEW,
      name: 'View permission matrix',
      description: 'Read the permission catalog and this company\'s role/user permission assignments.',
      category: CATEGORIES.ADMIN,
      module: 'ADMIN',
      resource: 'Permission',
      action: 'view',
    },
    {
      code: PERMISSION_ADMIN.MANAGE,
      name: 'Manage permission matrix',
      description:
        'Grant or revoke permissions for a role or an individual user within this company. '
        + 'Company Admin authority (ARCHITECTURE.md §R TeamPermissions.jsx).',
      category: CATEGORIES.ADMIN,
      module: 'ADMIN',
      resource: 'Permission',
      action: 'manage',
    },
  ];
}

/**
 * CATALOG — the complete, deterministic seed set. Order is stable (generic verbs in frozen
 * constant order, then override codes in resource order, then admin codes) so the seed produces
 * identical output on every run.
 */
const CATALOG = Object.freeze([
  ...genericEntries(),
  ...overrideEntries(),
  ...adminEntries(),
].map(Object.freeze));

const CATALOG_CODES = Object.freeze(CATALOG.map((p) => p.code));

// ---------------------------------------------------------------------------------------------
// DEFAULT_ROLE_PERMISSIONS — the per-designation template (ACCESS_MATRIX.md PART 1).
//
// These are the ten generic ACTION verbs only. SCOPE (own-record-only vs team vs division) is NOT
// expressed here and never will be: it is enforced by scopeFilterV3()/ownership/division/department/
// project scope, per the frozen invariant "Ownership ≠ Role ≠ Permission" (DOCUMENT_AUTHORITY.md).
// A `sales_executive` and a `sales_manager` both holding EDIT is not a contradiction — the executive
// may still only edit their OWN records, because ownership is a separate gate.
//
// Derivation, row by row, from ACCESS_MATRIX.md PART 1:
//   * DELETE is withheld from every non-admin designation — the matrix marks business-record delete
//     "⛔ admin" for managers and "❌" for executives/engineers.
//   * §12A Sales Manager holds APPROVE/REJECT (threshold-gated) + ASSIGN + EXPORT.
//   * §12B Sales Executive holds neither APPROVE, REJECT, ASSIGN, DELETE nor EXPORT ("—" in the
//     matrix) — this is the frozen distinction that must never collapse.
// ---------------------------------------------------------------------------------------------
const P = PERMISSIONS;

const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  // Super Admin's authority does not come from this table — role === 'super' bypasses the permission
  // layer entirely (API_ARCHITECTURE.md §7), and its business-record mutations are still gated by
  // the Support-Op path in middleware/ownership.js. Listed for completeness of the matrix UI only.
  [DESIGNATIONS.SUPER_ADMIN]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.DELETE, P.ASSIGN, P.CLOSE, P.EXPORT,
    PERMISSION_ADMIN.VIEW, PERMISSION_ADMIN.MANAGE,
  ]),

  [DESIGNATIONS.COMPANY_ADMIN]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.DELETE, P.ASSIGN, P.CLOSE, P.EXPORT,
    PERMISSION_ADMIN.VIEW, PERMISSION_ADMIN.MANAGE,
  ]),

  // §12A — team pipeline authority.
  [DESIGNATIONS.SALES_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),

  // §12B — own-record authority only. Deliberately WITHOUT APPROVE / REJECT / ASSIGN / DELETE /
  // EXPORT. Do not add them here to "simplify" the two Sales designations into one.
  [DESIGNATIONS.SALES_EXECUTIVE]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.CLOSE,
  ]),

  [DESIGNATIONS.PROJECT_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),

  [DESIGNATIONS.SOLAR_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),
  [DESIGNATIONS.MEP_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),
  [DESIGNATIONS.HVAC_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),

  [DESIGNATIONS.INVENTORY_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),

  [DESIGNATIONS.SERVICE_MANAGER]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.REJECT, P.ASSIGN, P.CLOSE, P.EXPORT,
  ]),

  // §10 — "Everything ⚠️ own-only". No APPROVE (approval is a separate authority), no DELETE
  // (DailyReport "⛔ never deletable"), no ASSIGN, no EXPORT.
  [DESIGNATIONS.ENGINEER]: Object.freeze([P.VIEW, P.CREATE, P.EDIT, P.SUBMIT]),
  [DESIGNATIONS.TECHNICIAN]: Object.freeze([P.VIEW, P.CREATE, P.EDIT, P.SUBMIT]),

  // §11 Accounts/Finance — records payments, never deletes financial history (reversal only).
  [DESIGNATIONS.EXECUTIVE]: Object.freeze([
    P.VIEW, P.CREATE, P.EDIT, P.SUBMIT, P.APPROVE, P.EXPORT,
  ]),

  // §12 — read + export only.
  [DESIGNATIONS.VIEWER]: Object.freeze([P.VIEW, P.EXPORT]),
});

/** Every code referenced by the template must exist in the catalog — asserted by the seed + tests. */
function templateCodes() {
  return [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];
}

module.exports = {
  CATALOG,
  CATALOG_CODES,
  CATEGORIES,
  OVERRIDE_RESOURCES,
  PERMISSION_ADMIN,
  DEFAULT_ROLE_PERMISSIONS,
  templateCodes,
};
