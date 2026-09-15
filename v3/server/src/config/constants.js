// Frozen terminology — do not rename, replace, or extend without updating v3/docs/ first
// (ROLE_HIERARCHY.md, ACCESS_MATRIX.md, DOCUMENT_AUTHORITY.md).

const PERMISSIONS = Object.freeze({
  VIEW: 'VIEW',
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  DELETE: 'DELETE',
  ASSIGN: 'ASSIGN',
  CLOSE: 'CLOSE',
  EXPORT: 'EXPORT',
});

const DIVISIONS = Object.freeze({ SOLAR: 'SOLAR', MEP: 'MEP', HVAC: 'HVAC' });
const DIVISION_VALUES = Object.freeze(Object.values(DIVISIONS));

const RECORD_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  POSTED: 'POSTED',
  FINALIZED: 'FINALIZED',
  CLOSED: 'CLOSED',
  LOCKED: 'LOCKED',
});

// States in which a normal creator Edit/Delete is blocked — correction/reversal only.
const IMMUTABLE_STATES = new Set([
  RECORD_STATES.APPROVED,
  RECORD_STATES.POSTED,
  RECORD_STATES.FINALIZED,
  RECORD_STATES.CLOSED,
  RECORD_STATES.LOCKED,
]);

// Minimum set per the platform-wide ownership/audit requirement; OVERRIDE included in addition to
// the requested minimum because the Super Admin Support-Access Rule (DOCUMENT_AUTHORITY.md) and the
// ownership correction path both need a distinct action label from CORRECT (CORRECT = a Manager/Admin
// RecordCorrection on an in-company record; OVERRIDE = a Super Admin support-op crossing company scope).
const AUDIT_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  ASSIGN: 'ASSIGN',
  CLOSE: 'CLOSE',
  REOPEN: 'REOPEN',
  CORRECT: 'CORRECT',
  REVERSE: 'REVERSE',
  OVERRIDE: 'OVERRIDE',
  // Phase 3 — commercial/entitlement actions (V3 PHASE 3 spec §19). Reuses the same immutable
  // AuditLog foundation — no separate audit system.
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_UPDATED: 'PLAN_UPDATED',
  PLAN_ACTIVATED: 'PLAN_ACTIVATED',
  PLAN_DEACTIVATED: 'PLAN_DEACTIVATED',
  SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
  DIVISION_ENABLED: 'DIVISION_ENABLED',
  DIVISION_DISABLED: 'DIVISION_DISABLED',
  FEATURE_ENABLED: 'FEATURE_ENABLED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  ADDON_ASSIGNED: 'ADDON_ASSIGNED',
  ADDON_REMOVED: 'ADDON_REMOVED',
  MANUAL_ENTITLEMENT_GRANTED: 'MANUAL_ENTITLEMENT_GRANTED',
  MANUAL_ENTITLEMENT_DISABLED: 'MANUAL_ENTITLEMENT_DISABLED',
});

// Entitlement source enum — exact frozen values only. Never 'LEGACY_FULL' (see DOCUMENT_AUTHORITY.md
// Canonical Effective-Entitlement Precedence — a legacy company with missing/invalid division
// metadata gets migrationReviewRequired=true, never an automatic full grant).
const ENTITLEMENT_SOURCES = Object.freeze(['plan', 'addon', 'manual', 'migration']);

// Frozen designation enum — ROLE_HIERARCHY.md §2 (organizational tree) / §4 (validity matrix).
const DESIGNATIONS = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  COMPANY_ADMIN: 'company_admin',
  SALES_MANAGER: 'sales_manager',
  SALES_EXECUTIVE: 'sales_executive',
  PROJECT_MANAGER: 'project_manager',
  SOLAR_MANAGER: 'solar_manager',
  MEP_MANAGER: 'mep_manager',
  HVAC_MANAGER: 'hvac_manager',
  INVENTORY_MANAGER: 'inventory_manager',
  SERVICE_MANAGER: 'service_manager',
  ENGINEER: 'engineer',
  TECHNICIAN: 'technician',
  EXECUTIVE: 'executive',
  VIEWER: 'viewer',
});
const DESIGNATION_VALUES = Object.freeze(Object.values(DESIGNATIONS));

// Frozen department enum — ROLE_HIERARCHY.md §2. NOTE: this is the authoritative enum; it does NOT
// include 'STORE' or 'ACCOUNTS' — those are stale/legacy labels seen in LEGACY_ROLE_COMPATIBILITY.md
// (store) and ROLE_HIERARCHY.md's own §4 validity-matrix row for `executive|ACCOUNTS`, and are
// normalized to INVENTORY and FINANCE respectively by services/roleResolver.js. See that file's
// header comment for the full disclosed reasoning.
const DEPARTMENTS = Object.freeze({
  ADMIN: 'ADMIN',
  PROJECTS: 'PROJECTS',
  SALES: 'SALES',
  SOLAR: 'SOLAR',
  MEP: 'MEP',
  HVAC: 'HVAC',
  SERVICE: 'SERVICE',
  INVENTORY: 'INVENTORY',
  FINANCE: 'FINANCE',
});
const DEPARTMENT_VALUES = Object.freeze(Object.values(DEPARTMENTS));

// Divisional manager designations — used by division/department scope + legacy scopeFilterV3().
const DIVISIONAL_MANAGER_DESIGNATIONS = Object.freeze([
  DESIGNATIONS.SOLAR_MANAGER,
  DESIGNATIONS.MEP_MANAGER,
  DESIGNATIONS.HVAC_MANAGER,
]);

// Approval engine — DATABASE_ARCHITECTURE.md ApprovalRequest shape.
const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'executed', 'expired']);
const APPROVAL_EXECUTION_STATUSES = Object.freeze(['queued', 'running', 'succeeded', 'failed']);

// ---------------------------------------------------------------------------------------------
// Phase 3 — SaaS commercial entitlement constants (PLAN_ENTITLEMENTS.md, frozen).
// ---------------------------------------------------------------------------------------------

// Plan.status — draft (not yet sellable) / active (sellable) / inactive (deactivated, not
// versioned out) / archived (superseded by a newer version of the same plan code).
const PLAN_STATUSES = Object.freeze(['draft', 'active', 'inactive', 'archived']);
const PLAN_VISIBILITY = Object.freeze(['public', 'internal']); // 'internal' = hidden from the picker (e.g. LEGACY_UNLIMITED)

// Subscription.status — PLAN_ENTITLEMENTS.md §10: "One Subscription active per company at a time
// ... Historical Subscriptions preserved with status IN ('replaced','expired','cancelled') — NEVER
// deleted." 'trial' added per §13 trial settings.
const SUBSCRIPTION_STATUSES = Object.freeze(['trial', 'active', 'replaced', 'expired', 'cancelled']);

// Billing cycle — not literally enumerated in PLAN_ENTITLEMENTS.md; this is the smallest set that
// covers "billingCycle" as named in the V3 PHASE 3 spec §3/§4. Documented as an interpretation, not
// pulled from a frozen doc list.
const BILLING_CYCLES = Object.freeze(['monthly', 'quarterly', 'annual']);

// Company.settings.enforceEntitlements — PLAN_ENTITLEMENTS.md §12.
const ENFORCEMENT_MODES = Object.freeze([false, 'warn', true]);

// Feature code classification — PLAN_ENTITLEMENTS.md §6, exact literal codes (never invent new
// feature strings outside this list without updating the doc first).
const CORE_FEATURES = Object.freeze([
  'auth.login', 'auth.mfa', 'profile.view', 'notifications.view', 'audit.view.own',
]);
const DIVISION_FEATURES = Object.freeze({
  SOLAR: Object.freeze(['solar.projects', 'solar.boq', 'solar.commissioning', 'solar.warranty']),
  MEP: Object.freeze(['mep.projects', 'mep.electrical', 'mep.plumbing', 'mep.fire', 'mep.commissioning']),
  HVAC: Object.freeze([
    'hvac.projects', 'hvac.vrf', 'hvac.piping', 'hvac.testing.pressure', 'hvac.testing.vacuum',
    'hvac.testing.leak', 'hvac.commissioning',
  ]),
});
const ADDON_FEATURES = Object.freeze([
  'client_portal', 'vendor_portal', 'ai_estimator', 'advanced_bi', 'mobile_app',
  'custom_branding', 'api_access', 'multi_location', 'payroll_integration',
  'extra_users_pack_10', 'storage_100gb',
]);
const ALL_FEATURE_CODES = Object.freeze([
  ...CORE_FEATURES,
  ...Object.values(DIVISION_FEATURES).flat(),
  ...ADDON_FEATURES,
]);

// Limit keys — PLAN_ENTITLEMENTS.md §2 cache shape (`limits: { users, projects, storageGB,
// apiCallsPerHour }`) and §API_ARCHITECTURE.md §9 ("per-plan rate limit from Plan.limits.apiCallsPerHour").
const LIMIT_KEYS = Object.freeze(['users', 'projects', 'storageGB', 'apiCallsPerHour']);
// Sentinel for "no cap" on a limit — distinct from 0 (not entitled / zero quota). Never confuse
// "feature enabled" with "unlimited quantity" (V3 PHASE 3 spec §12).
const UNLIMITED = 'unlimited';

// AddOn division-grant codes — PLAN_ENTITLEMENTS.md §5.
const DIVISION_ADDON_CODES = Object.freeze({
  SOLAR: 'DIVISION_SOLAR',
  MEP: 'DIVISION_MEP',
  HVAC: 'DIVISION_HVAC',
});

// The one system-only plan code that migration uses — PLAN_ENTITLEMENTS.md §9. Never sellable,
// never editable, never shown in the normal Super Admin plan picker.
const LEGACY_UNLIMITED_PLAN_CODE = 'LEGACY_UNLIMITED';

module.exports = {
  PERMISSIONS,
  DIVISIONS,
  DIVISION_VALUES,
  RECORD_STATES,
  IMMUTABLE_STATES,
  AUDIT_ACTIONS,
  ENTITLEMENT_SOURCES,
  DESIGNATIONS,
  DESIGNATION_VALUES,
  DEPARTMENTS,
  DEPARTMENT_VALUES,
  DIVISIONAL_MANAGER_DESIGNATIONS,
  APPROVAL_STATUSES,
  APPROVAL_EXECUTION_STATUSES,
  PLAN_STATUSES,
  PLAN_VISIBILITY,
  SUBSCRIPTION_STATUSES,
  BILLING_CYCLES,
  ENFORCEMENT_MODES,
  CORE_FEATURES,
  DIVISION_FEATURES,
  ADDON_FEATURES,
  ALL_FEATURE_CODES,
  LIMIT_KEYS,
  UNLIMITED,
  DIVISION_ADDON_CODES,
  LEGACY_UNLIMITED_PLAN_CODE,
};
