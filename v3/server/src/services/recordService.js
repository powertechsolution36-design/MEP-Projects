// Common record mutation service — V3 PHASE 4 spec §14.
//
// The point of this file is that NO feature module (Sales, Finance, Inventory, Service, Projects,
// ProjectPackage, Checklist, BOQ, Payment, ...) ever writes its own ownership, soft-delete,
// correction, or audit logic again. They call these operations, and the ownership/state/immutable-
// field/audit guarantees come along automatically and identically.
//
// TWO DELIBERATE CONSTRAINTS, both straight from the spec:
//
//  1. "Authorization remains external and explicit." This service NEVER decides whether a caller
//     may mutate a record. It REQUIRES a decision produced upstream by requireOwnership()
//     (middleware/ownership.js, which puts it on req.ownershipDecision) or passed in explicitly.
//     Calling a mutating operation without one is a programming error and throws — it can never
//     silently default to "allowed".
//
//  2. "Do NOT blindly expose all operations to every module." createRecordService() returns ONLY
//     the operations a module opts into. A resource with no delete path simply never receives
//     deleteOwnRecord/softDeleteRecord, so there is nothing to call by mistake.
const { RECORD_STATES, AUDIT_ACTIONS } = require('../config/constants');
const { getResourcePolicy, canEditInState, canDeleteInState, stateOf } = require('../config/recordPolicy');
const { assertNoImmutableFieldChange } = require('../middleware/immutableFields');
const { recordOwnershipAction } = require('./ownershipService');
const { audit } = require('./auditService');
const { MIN_DELETION_REASON_LENGTH } = require('../models/plugins/ownershipPlugin');

class RecordServiceError extends Error {
  constructor(message, code, status = 422, details) {
    super(message);
    this.name = 'RecordServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// --------------------------------------------------------------------------------------------
// internals
// --------------------------------------------------------------------------------------------

// Tolerates both a real Mongoose Query (chainable) and a plain promise-returning mock.
async function resolveQuery(result, { includeDeleted = false } = {}) {
  if (!result) return result;
  let q = result;
  if (includeDeleted && typeof q.setOptions === 'function') q = q.setOptions({ includeDeleted: true });
  if (typeof q.lean === 'function') return q.lean();
  return q;
}

async function loadRecord(Model, id, opts) {
  return resolveQuery(Model.findById(id), opts);
}

/**
 * The decision must come from outside. `req.ownershipDecision` is set by requireOwnership(); a
 * caller invoking this service from a non-Express context passes `decision` explicitly.
 */
function requireDecision(req, decision, operation) {
  const resolved = decision || req?.ownershipDecision;
  if (!resolved) {
    throw new RecordServiceError(
      `[v3/recordService] ${operation} requires an ownership decision — run requireOwnership() first or pass { decision }`,
      'AUTHORIZATION_NOT_EVALUATED', 500,
    );
  }
  if (resolved.allowed === false) {
    throw new RecordServiceError(resolved.reason || 'Forbidden', 'FORBIDDEN', 403);
  }
  return resolved;
}

function userId(req) { return req?.user?._id ?? req?.user?.id ?? null; }

// --------------------------------------------------------------------------------------------
// operations
// --------------------------------------------------------------------------------------------

/**
 * createRecord — the creator becomes the owner (`createdByUserId`), permanently.
 * requireOwnership() is deliberately NOT required here: there is no existing record to own
 * (API_ARCHITECTURE.md §1 — "requireOwnership() is skipped on CREATE").
 */
async function createRecord({ req, Model, resource, payload = {} }) {
  // The governance state lands on whichever field this resource declared (`status` by default;
  // `recordState` for a resource whose `status` belongs to a legacy operational lifecycle).
  const stateField = getResourcePolicy(resource).stateField;
  const doc = {
    ...payload,
    co: req.user?.co,
    createdByUserId: userId(req),
    createdByName: req.user?.name ?? null,   // DISPLAY cache only — never an authorization input
    updatedByUserId: userId(req),
    [stateField]: payload[stateField] || RECORD_STATES.DRAFT,
  };
  const created = await Model.create(doc);
  await audit({
    req, action: AUDIT_ACTIONS.CREATE, resource, resourceId: created?._id, after: created,
  });
  return created;
}

/**
 * updateOwnRecord — a normal field update by the record's creator, OR an explicitly authorized
 * override by a Manager/Admin, which is automatically routed through RecordCorrection (never a
 * silent overwrite) by recordOwnershipAction().
 */
async function updateOwnRecord({ req, Model, resource, id, payload = {}, reason, decision }) {
  const resolved = requireDecision(req, decision, 'updateOwnRecord');
  const before = req.record || await loadRecord(Model, id);
  if (!before) throw new RecordServiceError(`${resource} not found`, 'NOT_FOUND', 404);

  // §12/§16 — an ordinary update can never change companyId, createdByUserId, createdAt, _id, or a
  // module's declared immutable fields, regardless of what the client sent.
  assertNoImmutableFieldChange(payload, before, resource);

  const state = canEditInState(stateOf(before, resource), resource);
  if (!state.allowed) throw new RecordServiceError(state.reason, 'RECORD_LOCKED', 403);

  if (resolved.requiresCorrection && (!reason || !reason.trim())) {
    throw new RecordServiceError(
      'A reason is required when correcting another user\'s record', 'REASON_REQUIRED', 422,
    );
  }

  const update = { ...payload, updatedByUserId: userId(req) };
  const after = await Model.findByIdAndUpdate(id, { $set: update }, { new: true });

  // Records the RecordCorrection row (when the decision was an override) and the AuditLog entry.
  // `req.record` is what recordOwnershipAction reads for originalCreatedByUserId.
  req.record = before;
  await recordOwnershipAction({
    req, resource, resourceId: id, action: AUDIT_ACTIONS.UPDATE,
    oldValue: before, newValue: after ?? update, reason,
  });
  return after;
}

/**
 * softDeleteRecord — the ONLY delete path. Business history is never hard-deleted; the row stays
 * queryable by an administrative/audit view and its AuditLog trail is untouched (§10).
 */
async function softDeleteRecord({ req, Model, resource, id, reason, decision }) {
  const resolved = requireDecision(req, decision, 'softDeleteRecord');
  const before = req.record || await loadRecord(Model, id);
  if (!before) throw new RecordServiceError(`${resource} not found`, 'NOT_FOUND', 404);

  // §11 delete policy — strictly narrower than the edit window, and never available at all on a
  // financial resource (reversal endpoints only).
  const state = canDeleteInState(stateOf(before, resource), resource);
  if (!state.allowed) throw new RecordServiceError(state.reason, 'DELETE_NOT_PERMITTED', 403);

  // API_ARCHITECTURE.md §4 destructive action guard.
  if (!reason || String(reason).trim().length < MIN_DELETION_REASON_LENGTH) {
    throw new RecordServiceError(
      `A deletion reason of at least ${MIN_DELETION_REASON_LENGTH} characters is required`,
      'DELETION_REASON_REQUIRED', 422,
    );
  }

  const update = {
    deleted: true,
    deletedAt: new Date(),
    deletedByUserId: userId(req),
    deletionReason: String(reason).trim(),
    updatedByUserId: userId(req),
  };
  const after = await Model.findByIdAndUpdate(id, { $set: update }, { new: true });

  req.record = before;
  await recordOwnershipAction({
    req, resource, resourceId: id, action: AUDIT_ACTIONS.DELETE,
    oldValue: before, newValue: after ?? update, reason,
  });
  return after;
}

/** deleteOwnRecord — alias kept because the spec names it; a hard delete never exists. */
const deleteOwnRecord = softDeleteRecord;

/**
 * restoreRecord — undo a soft delete. Reads with includeDeleted, since the schema-level filter
 * hides deleted rows from ordinary queries.
 */
async function restoreRecord({ req, Model, resource, id, reason, decision }) {
  requireDecision(req, decision, 'restoreRecord');
  const before = await loadRecord(Model, id, { includeDeleted: true });
  if (!before) throw new RecordServiceError(`${resource} not found`, 'NOT_FOUND', 404);
  if (!before.deleted) throw new RecordServiceError(`${resource} is not deleted`, 'NOT_DELETED', 422);

  const update = {
    deleted: false, deletedAt: null, deletedByUserId: null, deletionReason: null,
    updatedByUserId: userId(req),
  };
  const after = await Model.findByIdAndUpdate(id, { $set: update }, { new: true });

  await audit({
    req, action: AUDIT_ACTIONS.REOPEN, resource, resourceId: id,
    before, after: after ?? update, reason,
  });
  return after;
}

/**
 * submitRecord — a BUSINESS action, not a record edit (§5). It is authorized by the caller's own
 * SUBMIT permission upstream, never by the ownership gate, so no ownership decision is demanded
 * here; the creator submitting their own record is the ordinary case (§24).
 */
async function submitRecord({ req, Model, resource, id, reason }) {
  const before = req.record || await loadRecord(Model, id);
  if (!before) throw new RecordServiceError(`${resource} not found`, 'NOT_FOUND', 404);
  const stateField = getResourcePolicy(resource).stateField;
  const current = stateOf(before, resource);
  if (current !== RECORD_STATES.DRAFT && current !== RECORD_STATES.REJECTED) {
    throw new RecordServiceError(
      `Only a DRAFT or REJECTED ${resource} can be submitted (current: ${current})`,
      'INVALID_STATE', 422,
    );
  }
  const update = { [stateField]: RECORD_STATES.SUBMITTED, updatedByUserId: userId(req) };
  const after = await Model.findByIdAndUpdate(id, { $set: update }, { new: true });
  await audit({
    req, action: AUDIT_ACTIONS.SUBMIT, resource, resourceId: id,
    before: { [stateField]: current }, after: { [stateField]: RECORD_STATES.SUBMITTED }, reason,
  });
  return after;
}

/**
 * lockRecord — moves a record into a terminal, non-editable state so future Payment / Invoice /
 * InvTransaction / StockLedger modules can freeze posted history (§25). Audited as UPDATE: the
 * frozen AuditLog action set is not extended with an invented value (§8).
 */
async function lockRecord({ req, Model, resource, id, state = RECORD_STATES.LOCKED, reason }) {
  const before = req.record || await loadRecord(Model, id);
  if (!before) throw new RecordServiceError(`${resource} not found`, 'NOT_FOUND', 404);
  const lockable = [RECORD_STATES.LOCKED, RECORD_STATES.FINALIZED, RECORD_STATES.POSTED, RECORD_STATES.CLOSED];
  if (!lockable.includes(state)) {
    throw new RecordServiceError(`${state} is not a lockable state`, 'INVALID_STATE', 422);
  }
  const stateField = getResourcePolicy(resource).stateField;
  const update = { [stateField]: state, updatedByUserId: userId(req) };
  const after = await Model.findByIdAndUpdate(id, { $set: update }, { new: true });
  await audit({
    req,
    action: state === RECORD_STATES.CLOSED ? AUDIT_ACTIONS.CLOSE : AUDIT_ACTIONS.UPDATE,
    resource,
    resourceId: id,
    before: { [stateField]: stateOf(before, resource) },
    after: { [stateField]: state },
    reason,
  });
  return after;
}

const ALL_OPERATIONS = Object.freeze([
  'createRecord', 'updateOwnRecord', 'deleteOwnRecord', 'softDeleteRecord',
  'restoreRecord', 'submitRecord', 'lockRecord',
]);

const IMPLEMENTATIONS = {
  createRecord, updateOwnRecord, deleteOwnRecord, softDeleteRecord, restoreRecord, submitRecord, lockRecord,
};

/**
 * createRecordService — binds the shared operations to one resource + model, exposing ONLY the
 * operations that resource opted into (spec §14: "Do NOT blindly expose all operations to every
 * module"). A financial resource, for example, simply never receives a delete operation.
 *
 * @param {Object}   config
 * @param {string}   config.resource
 * @param {Object}   config.Model
 * @param {string[]} [config.operations] defaults to every operation the resource policy permits
 */
function createRecordService({ resource, Model, operations }) {
  if (!resource) throw new Error('[v3/recordService] createRecordService requires a resource name');
  if (!Model) throw new Error('[v3/recordService] createRecordService requires a Model');

  const policy = getResourcePolicy(resource);
  const defaults = ALL_OPERATIONS.filter((op) => {
    const isDelete = op === 'deleteOwnRecord' || op === 'softDeleteRecord' || op === 'restoreRecord';
    // A financial resource, or one that declared softDelete:false, gets no delete path at all.
    return !(isDelete && (policy.financial || policy.softDelete === false));
  });

  const enabled = operations || defaults;
  for (const op of enabled) {
    if (!ALL_OPERATIONS.includes(op)) throw new Error(`[v3/recordService] Unknown operation "${op}"`);
  }

  const api = {};
  for (const op of enabled) {
    api[op] = (params = {}) => IMPLEMENTATIONS[op]({ ...params, Model, resource });
  }
  api.resource = resource;
  api.policy = policy;
  api.operations = Object.freeze([...enabled]);
  return api;
}

module.exports = {
  createRecord,
  updateOwnRecord,
  deleteOwnRecord,
  softDeleteRecord,
  restoreRecord,
  submitRecord,
  lockRecord,
  createRecordService,
  RecordServiceError,
  ALL_OPERATIONS,
};
