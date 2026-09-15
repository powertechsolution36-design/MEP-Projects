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
};
