// Record-state protection — STEP 10. Deliberately separate from middleware/ownership.js: state
// locking applies to more than just Edit/Delete (e.g. a FINALIZED record also can't be re-APPROVEd),
// and future feature modules need to reuse the same state machine for non-ownership decisions too.
const { IMMUTABLE_STATES } = require('../config/constants');
const { sendError } = require('../utils/ApiError');

// Pure — directly unit-testable.
function isStateEditable(state) {
  return !IMMUTABLE_STATES.has(state);
}

// Express wrapper. `loadRecord(req)` must return a record with at least `{ status }`.
function requireEditableState({ resource, loadRecord }) {
  return async (req, res, next) => {
    try {
      const record = req.record || await loadRecord(req);
      if (!record) return sendError(res, 404, `${resource} not found`);
      if (!isStateEditable(record.status)) {
        return sendError(res, 403, `${resource} is ${record.status} — locked, use correction/reversal`);
      }
      req.record = record;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { isStateEditable, requireEditableState };
