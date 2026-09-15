// bulkAuthorize() — ensures a future bulk endpoint (e.g. "approve these 20 items") authorizes every
// item exactly as an individual request would, never a batch-level shortcut ("company_admin so all
// items in this batch pass"). Each item runs through the SAME authorize() decision function
// (services/authorizationEngine.js) individually; a bulk operation is never granted merely because
// the caller holds a role that would pass most items.
const { authorize } = require('../services/authorizationEngine');

/**
 * @param {Object} user
 * @param {string} permission
 * @param {Array<{id:*, context:Object}>} items - one entry per bulk item, each with its own
 *   authorization context (its own record/division/department/project/etc.) — never a single shared
 *   context applied to the whole batch.
 * @returns {{allowedItems:Array, deniedItems:Array<{id:*, reason:string}>, allAllowed:boolean}}
 */
function bulkAuthorize(user, permission, items) {
  const allowedItems = [];
  const deniedItems = [];
  for (const item of items) {
    const decision = authorize(user, permission, item.context || {});
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
function requireAllOrNothing(user, permission, items) {
  const result = bulkAuthorize(user, permission, items);
  if (!result.allAllowed) {
    const err = new Error(`Bulk authorization failed for ${result.deniedItems.length} of ${items.length} item(s)`);
    err.code = 'BULK_FORBIDDEN';
    err.deniedItems = result.deniedItems;
    throw err;
  }
  return result.allowedItems;
}

module.exports = { bulkAuthorize, requireAllOrNothing };
