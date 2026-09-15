// bulkAuthorize() — ensures a future bulk endpoint (e.g. "approve these 20 items") authorizes every
// item exactly as an individual request would, never a batch-level shortcut ("company_admin so all
// items in this batch pass"). Each item runs through the SAME authorize() decision function
// (services/authorizationEngine.js) individually; a bulk operation is never granted merely because
// the caller holds a role that would pass most items.
//
// PHASE 4 HARDENING (spec §13): a batch may no longer be submitted with ONE shared context standing
// in for every item. For a record mutation each entry must carry its own `context.record`, so a
// caller cannot authorize item 1 (which they own) and have items 2..N ride along on that decision.
// A malformed batch is refused outright rather than partially authorized.
const { authorize } = require('../services/authorizationEngine');
const { isRecordMutationAction } = require('../config/recordPolicy');

class BulkAuthorizationError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'BulkAuthorizationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Structural guard, run before any item is evaluated: for a record-mutation batch every item must
 * carry its own distinct record. Two entries pointing at the SAME record object are treated as a
 * shared-context batch and refused — that is the mass-assignment shape the spec forbids.
 */
function assertPerItemContext(items, action) {
  if (!Array.isArray(items)) {
    throw new BulkAuthorizationError('Bulk items must be an array', 'BULK_INVALID');
  }
  if (!isRecordMutationAction(action)) return;

  const seen = new Set();
  items.forEach((item, index) => {
    const record = item?.context?.record;
    if (!record) {
      throw new BulkAuthorizationError(
        `Bulk item ${index} has no per-item record context — a shared context may never authorize a batch`,
        'BULK_SHARED_CONTEXT',
        { index },
      );
    }
    if (seen.has(record)) {
      throw new BulkAuthorizationError(
        `Bulk item ${index} reuses another item's record context`,
        'BULK_SHARED_CONTEXT',
        { index },
      );
    }
    seen.add(record);
  });
}

/**
 * @param {Object} user
 * @param {string} permission
 * @param {Array<{id:*, context:Object}>} items - one entry per bulk item, each with its own
 *   authorization context (its own record/division/department/project/etc.) — never a single shared
 *   context applied to the whole batch.
 * @param {{action?:string}} [options] - when the batch performs a record mutation, pass the action
 *   ('edit'|'delete'|...) so the per-item context guard applies.
 * @returns {{allowedItems:Array, deniedItems:Array<{id:*, reason:string}>, allAllowed:boolean}}
 */
function bulkAuthorize(user, permission, items, options = {}) {
  assertPerItemContext(items, options.action);

  const allowedItems = [];
  const deniedItems = [];
  for (const item of items) {
    const context = { ...(item.context || {}) };
    if (options.action && context.action == null) context.action = options.action;
    const decision = authorize(user, permission, context);
    if (decision.allowed) {
      allowedItems.push(item);
    } else {
      deniedItems.push({ id: item.id, reason: decision.reason || 'Forbidden' });
    }
  }
  return { allowedItems, deniedItems, allAllowed: deniedItems.length === 0 };
}

/**
 * requireAllOrNothing — for bulk operations where a partial batch must never partially apply: if any
 * single item fails authorization, the whole batch is rejected before any item is touched.
 */
function requireAllOrNothing(user, permission, items, options = {}) {
  const result = bulkAuthorize(user, permission, items, options);
  if (!result.allAllowed) {
    const err = new Error(`Bulk authorization failed for ${result.deniedItems.length} of ${items.length} item(s)`);
    err.code = 'BULK_FORBIDDEN';
    err.deniedItems = result.deniedItems;
    throw err;
  }
  return result.allowedItems;
}

module.exports = { bulkAuthorize, requireAllOrNothing, assertPerItemContext, BulkAuthorizationError };
