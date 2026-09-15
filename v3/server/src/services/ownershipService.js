// Glue between requireOwnership()'s decision (middleware/ownership.js) and the two collections a
// correction must touch: RecordCorrection (the sanctioned override record) and AuditLog (the
// platform-wide trail). A route handler calls this AFTER performing the actual field write, once
// it knows the before/after values — this function never decides whether the write was allowed
// (that's requireOwnership()'s job, already run as middleware); it only records what happened.
//
// PHASE 4 HARDENING (spec §7/§18):
//   * RecordCorrection oldValue/newValue are now redacted with the same shared utility AuditLog
//     uses — "Never store secrets/passwords/tokens in correction history." Previously the
//     correction row stored the raw before/after while only AuditLog was scrubbed.
//   * A correction is a controlled override of another user's record, so its audit entry is
//     CRITICAL: the write must not silently succeed unaudited. If the AuditLog write fails, the
//     RecordCorrection row just created is rolled back and the error surfaces to the caller.
const RecordCorrection = require('../models/RecordCorrection');
const { audit } = require('./auditService');
const { redact } = require('../utils/redact');
const { logger } = require('../utils/logger');

/**
 * @param {Object} params
 * @param {Object} params.req         must carry req.ownershipDecision (requireOwnership ran) and req.record
 * @param {string} params.action      an AUDIT_ACTIONS value for the ordinary (non-override) path
 * @param {*}      params.oldValue    before snapshot — redacted before it is persisted
 * @param {*}      params.newValue    after snapshot  — redacted before it is persisted
 * @param {string} [params.reason]    REQUIRED when the decision was an override
 * @param {Object} [params.decision]  explicit decision, for a non-Express caller
 */
async function recordOwnershipAction({ req, resource, resourceId, action, oldValue, newValue, reason, decision }) {
  const resolved = decision || req.ownershipDecision;
  if (!resolved) throw new Error('[v3/ownershipService] requireOwnership() middleware must run first');

  const safeOld = redact(oldValue);
  const safeNew = redact(newValue);

  let correctionId;
  let correctionDoc;
  if (resolved.requiresCorrection) {
    if (!reason || !reason.trim()) throw new Error('A reason is required for a correction to another user\'s record');
    correctionDoc = await RecordCorrection.create({
      co: req.user.co,
      originalRecordId: resourceId,
      originalCollection: resource,
      // The original owner is PRESERVED — a correction never rewrites createdByUserId to the
      // overriding user (DATABASE_ARCHITECTURE.md rev 12).
      originalCreatedByUserId: req.record?.createdByUserId ?? null,
      overrideByUserId: req.user._id,
      reason,
      supportOp: !!resolved.supportOp,
      oldValue: safeOld,
      newValue: safeNew,
    });
    correctionId = correctionDoc._id;
  }

  try {
    await audit({
      req,
      action: correctionId ? (resolved.supportOp ? 'OVERRIDE' : 'CORRECT') : String(action).toUpperCase(),
      resource,
      resourceId,
      before: safeOld,
      after: safeNew,
      reason,
      correctionId,
      supportOp: resolved.supportOp,
      // A controlled override of someone else's record is exactly the "operationally critical
      // mutation" §18 names — it must never exist without its audit entry.
      critical: !!correctionId,
    });
  } catch (err) {
    if (correctionDoc) {
      // Compensate: an un-audited correction row would be worse than none, since it would look
      // like a sanctioned override with no trail of who performed it.
      try {
        await RecordCorrection.deleteOne({ _id: correctionId });
      } catch (cleanupErr) {
        logger.error('correction_rollback_failed', { correctionId: String(correctionId), message: cleanupErr.message });
      }
    }
    throw err;
  }

  return { correctionId };
}

module.exports = { recordOwnershipAction };
