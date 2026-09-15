// Reusable, module-agnostic record policy — the single place that answers, for ANY v3 business
// record in ANY future module (Sales, Finance, Inventory, Service, Projects, ProjectPackage,
// Checklist, BOQ, Payment, ...):
//
//   * is this action a record mutation (EDIT/DELETE) or a business action (APPROVE/ASSIGN/...)?
//   * does this record's state still permit a normal edit?
//   * does this record's state still permit a normal delete?  (stricter than edit — spec §11)
//   * which fields may an ordinary update never touch?        (spec §12/§16)
//
// V3 PHASE 4 spec §5 / §9 / §11 / §12 / §15 / §16; DATABASE_ARCHITECTURE.md rev 12 addendum
// ("State governs eligibility"); API_ARCHITECTURE.md §4 (destructive action guard) and §7
// (`requireOwnership()`).
//
// Feature modules NEVER re-implement any of this — they call defineResourcePolicy() once to declare
// their own additional immutable fields / narrower state sets, and the shared ownership middleware,
// record service, and authorization engine read the policy back out.
const { RECORD_STATES, IMMUTABLE_STATES } = require('./constants');

// ---------------------------------------------------------------------------------------------
// §5 — BUSINESS ACTION ≠ RECORD EDIT.
// Holding a business permission (APPROVE, ASSIGN, VERIFY, CLOSE, ...) must NEVER imply Edit/Delete
// authority over another employee's record. These two sets are kept explicitly disjoint so that no
// future module can accidentally route an approval permission through the ownership Edit gate.
// ---------------------------------------------------------------------------------------------
const RECORD_MUTATION_ACTIONS = Object.freeze(['edit', 'update', 'delete', 'correct', 'restore']);

const BUSINESS_ACTIONS = Object.freeze([
  'SUBMIT', 'APPROVE', 'REJECT', 'ASSIGN', 'VERIFY', 'CLOSE', 'REOPEN', 'RAISE_TO_FINANCE', 'REVERSE',
]);

function normalizeAction(action) {
  return String(action || '').trim();
}

function isRecordMutationAction(action) {
  return RECORD_MUTATION_ACTIONS.includes(normalizeAction(action).toLowerCase());
}

function isBusinessAction(action) {
  return BUSINESS_ACTIONS.includes(normalizeAction(action).toUpperCase());
}

// ---------------------------------------------------------------------------------------------
// §9 / §11 — reusable state policy.
//
// EDIT eligibility keeps using the existing frozen IMMUTABLE_STATES set (middleware/recordState.js's
// isStateEditable(), unchanged from Phase 1) so that DRAFT / SUBMITTED / REJECTED remain the generic
// editable window and APPROVED / POSTED / FINALIZED / CLOSED / LOCKED stay locked platform-wide.
// A module that needs a NARROWER edit window ("SUBMITTED → edit only where the workflow explicitly
// permits", DATABASE_ARCHITECTURE.md rev 12) declares it via defineResourcePolicy({editableStates}).
//
// DELETE eligibility is deliberately STRICTER than edit and is NOT derived from IMMUTABLE_STATES:
// per spec §11 only DRAFT carries a normal creator delete; SUBMITTED/APPROVED are restricted (an
// explicit per-resource opt-in or an override is required), and POSTED/FINALIZED/CLOSED/LOCKED have
// no normal delete at all — reversal only.
// ---------------------------------------------------------------------------------------------
const DELETE_POLICY = Object.freeze({
  [RECORD_STATES.DRAFT]: 'CREATOR',       // creator may delete (subject to permission + scope)
  [RECORD_STATES.SUBMITTED]: 'RESTRICTED', // only with an explicit resource-policy opt-in or override
  [RECORD_STATES.REJECTED]: 'RESTRICTED',  // rework loop — not an automatic delete window
  [RECORD_STATES.APPROVED]: 'RESTRICTED',
  [RECORD_STATES.POSTED]: 'NONE',          // no normal delete — reversal only
  [RECORD_STATES.FINALIZED]: 'NONE',
  [RECORD_STATES.CLOSED]: 'NONE',
  [RECORD_STATES.LOCKED]: 'NONE',
});

// Default generic edit window — exactly the complement of the frozen IMMUTABLE_STATES set, so this
// default can never drift away from middleware/recordState.js's isStateEditable().
const DEFAULT_EDITABLE_STATES = Object.freeze(
  Object.values(RECORD_STATES).filter((s) => !IMMUTABLE_STATES.has(s)),
);

// States where a normal delete is available by default: DRAFT only (§11).
const DEFAULT_DELETABLE_STATES = Object.freeze([RECORD_STATES.DRAFT]);

// ---------------------------------------------------------------------------------------------
// §12 / §16 — immutable system fields.
// An ordinary update request may never change any of these, on any resource, in any module. Note
// `co`/`companyId` appear here as a SECOND line of defence: middleware/tenant.js already strips
// client-supplied company keys (Phase 1 STEP 6), but a payload assembled server-side must also be
// unable to move a record between tenants.
// ---------------------------------------------------------------------------------------------
const GLOBAL_IMMUTABLE_FIELDS = Object.freeze([
  '_id', 'id',
  'co', 'companyId',
  'createdByUserId', 'createdBy',
  'createdAt',
]);

// Fields that represent history which an ordinary update must never rewrite (§12). A module adds
// its own ledger/posting fields through defineResourcePolicy({immutableFields}).
const HISTORY_IMMUTABLE_FIELDS = Object.freeze([
  'auditTrail', 'auditLogs',
  'approvalHistory', 'approvalSteps', 'approvedAt', 'approvedByUserId',
  'corrections', 'correctionHistory',
  'postedAt', 'postedByUserId', 'ledgerEntries', 'reversalOf', 'reversedAt', 'reversedByUserId',
  'migrationReviewRequired',
]);

// ---------------------------------------------------------------------------------------------
// §15 — resource policy registry. One declarative entry per resource; read back by
// middleware/ownership.js, middleware/immutableFields.js, services/recordService.js and
// services/authorizationEngine.js so ownership logic is written once and reused everywhere.
// ---------------------------------------------------------------------------------------------
const registry = new Map();

/**
 * @param {string} resource                      canonical resource/collection name, e.g. 'Quotation'
 * @param {Object} [policy]
 * @param {string[]} [policy.immutableFields]    ADDITIONAL immutable fields beyond the global set
 * @param {string[]} [policy.editableStates]     narrower edit window (default: every non-locked state)
 * @param {string[]} [policy.deletableStates]    states with a normal creator delete (default: DRAFT)
 * @param {string}   [policy.overridePermission] default `${resource}.override` (API_ARCHITECTURE §7)
 * @param {boolean}  [policy.financial]          true => NO delete in any state; reversal endpoints only
 * @param {boolean}  [policy.softDelete]         false => this resource has no delete path at all
 * @param {string}   [policy.stateField='status'] which field carries the GOVERNANCE state
 *
 * `stateField` exists for one specific, documented situation (added in Phase 5): a collection v2
 * already owns may use `status` for its own operational lifecycle, which v3 must not redefine
 * because the live app writes it. Such a resource keeps `status` as-is and declares a separate
 * governance field (e.g. Project/ProjectPackage's `recordState`). The default is `'status'`, so
 * every resource declared in Phases 1-4 behaves exactly as before.
 */
function defineResourcePolicy(resource, policy = {}) {
  if (!resource || typeof resource !== 'string') {
    throw new Error('[v3/recordPolicy] defineResourcePolicy requires a resource name');
  }
  const financial = policy.financial === true;
  const resolved = Object.freeze({
    resource,
    financial,
    stateField: policy.stateField || 'status',
    softDelete: policy.softDelete !== false,
    overridePermission: policy.overridePermission || `${resource}.override`,
    immutableFields: Object.freeze([
      ...GLOBAL_IMMUTABLE_FIELDS,
      ...HISTORY_IMMUTABLE_FIELDS,
      ...(policy.immutableFields || []),
    ]),
    editableStates: Object.freeze([...(policy.editableStates || DEFAULT_EDITABLE_STATES)]),
    // A financial resource never gets a normal delete window, whatever it declares — the frozen
    // rule is "Financial resources (Invoice, Payment, GRN): NO delete route exists; only reversal
    // endpoints" (API_ARCHITECTURE.md §4).
    deletableStates: Object.freeze(financial ? [] : [...(policy.deletableStates || DEFAULT_DELETABLE_STATES)]),
  });
  registry.set(resource, resolved);
  return resolved;
}

/** Returns the declared policy, or a default policy for a resource that has not declared one. */
function getResourcePolicy(resource) {
  return registry.get(resource) || Object.freeze({
    resource,
    financial: false,
    stateField: 'status',
    softDelete: true,
    overridePermission: `${resource}.override`,
    immutableFields: Object.freeze([...GLOBAL_IMMUTABLE_FIELDS, ...HISTORY_IMMUTABLE_FIELDS]),
    editableStates: DEFAULT_EDITABLE_STATES,
    deletableStates: DEFAULT_DELETABLE_STATES,
  });
}

function clearResourcePolicies() { registry.clear(); }   // test helper only

/**
 * canEditInState — normal (non-correction) edit eligibility.
 * @returns {{allowed:boolean, reason?:string}}
 */
function canEditInState(state, resource) {
  const policy = getResourcePolicy(resource);
  if (state == null) return { allowed: true };            // stateless record — nothing to enforce
  if (IMMUTABLE_STATES.has(state)) {
    return { allowed: false, reason: `Record is ${state} — locked, use correction/reversal` };
  }
  if (!policy.editableStates.includes(state)) {
    return { allowed: false, reason: `${resource || 'Record'} is not editable in state ${state}` };
  }
  return { allowed: true };
}

/**
 * canDeleteInState — normal (non-reversal) delete eligibility. Stricter than canEditInState().
 * `RESTRICTED` states are refused for an ordinary creator delete and require either an explicit
 * per-resource opt-in (deletableStates) or the resource's override permission going through the
 * RecordCorrection path.
 * @returns {{allowed:boolean, policy:'CREATOR'|'RESTRICTED'|'NONE', reason?:string}}
 */
function canDeleteInState(state, resource) {
  const resolved = getResourcePolicy(resource);
  const statePolicy = state == null ? 'CREATOR' : (DELETE_POLICY[state] || 'NONE');

  if (resolved.softDelete === false) {
    return { allowed: false, policy: 'NONE', reason: `${resource || 'Record'} has no delete path` };
  }
  if (resolved.financial) {
    return {
      allowed: false,
      policy: 'NONE',
      reason: `${resource || 'Record'} is a financial record — no delete, use a reversal`,
    };
  }
  if (statePolicy === 'NONE') {
    return { allowed: false, policy: 'NONE', reason: `Record is ${state} — no normal delete, use a reversal` };
  }
  if (!resolved.deletableStates.includes(state)) {
    return {
      allowed: false,
      policy: statePolicy,
      reason: `Delete is restricted in state ${state}`,
    };
  }
  return { allowed: true, policy: statePolicy };
}

/**
 * canMutateInState — single entry point used by middleware/ownership.js so that EDIT and DELETE
 * never accidentally share one rule.
 */
function canMutateInState(state, action, resource) {
  const a = normalizeAction(action).toLowerCase();
  if (a === 'delete') return canDeleteInState(state, resource);
  return canEditInState(state, resource);
}

/** Collected immutable field list for a resource (global + history + module-declared). */
function immutableFieldsFor(resource) {
  return getResourcePolicy(resource).immutableFields;
}

/**
 * stateOf — reads a record's GOVERNANCE state through its resource policy, so a resource whose
 * `status` field belongs to a legacy operational lifecycle (Project/ProjectPackage) is still
 * evaluated against the right field. Defaults to `record.status`, which is what every Phase 1-4
 * resource uses.
 */
function stateOf(record, resource) {
  if (!record) return undefined;
  return record[getResourcePolicy(resource).stateField];
}

module.exports = {
  RECORD_MUTATION_ACTIONS,
  BUSINESS_ACTIONS,
  isRecordMutationAction,
  isBusinessAction,
  DELETE_POLICY,
  DEFAULT_EDITABLE_STATES,
  DEFAULT_DELETABLE_STATES,
  GLOBAL_IMMUTABLE_FIELDS,
  HISTORY_IMMUTABLE_FIELDS,
  defineResourcePolicy,
  getResourcePolicy,
  clearResourcePolicies,
  canEditInState,
  canDeleteInState,
  canMutateInState,
  immutableFieldsFor,
  stateOf,
};
