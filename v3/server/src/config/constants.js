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

module.exports = {
  PERMISSIONS,
  DIVISIONS,
  DIVISION_VALUES,
  RECORD_STATES,
  IMMUTABLE_STATES,
  AUDIT_ACTIONS,
  ENTITLEMENT_SOURCES,
};
