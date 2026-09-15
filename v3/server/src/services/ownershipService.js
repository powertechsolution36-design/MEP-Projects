// Glue between requireOwnership()'s decision (middleware/ownership.js) and the two collections a
// correction must touch: RecordCorrection (the sanctioned override record) and AuditLog (the
// platform-wide trail). A route handler calls this AFTER performing the actual field write, once
// it knows the before/after values — this function never decides whether the write was allowed
// (that's requireOwnership()'s job, already run as middleware); it only records what happened.
const RecordCorrection = require('../models/RecordCorrection');
const { audit } = require('./auditService');

async function recordOwnershipAction({ req, resource, resourceId, action, oldValue, newValue, reason }) {
  const decision = req.ownershipDecision;
  if (!decision) throw new Error('[v3/ownershipService] requireOwnership() middleware must run first');

  let correctionId;
  if (decision.requiresCorrection) {
    if (!reason || !reason.trim()) throw new Error('A reason is required for a correction to another user\'s record');
    const correction = await RecordCorrection.create({
      co: req.user.co,
      originalRecordId: resourceId,
      originalCollection: resource,
      originalCreatedByUserId: req.record.createdByUserId,
      overrideByUserId: req.user._id,
      reason,
      supportOp: !!decision.supportOp,
      oldValue,
      newValue,
    });
    correctionId = correction._id;
  }

  await audit({
    req,
    action: correctionId ? (decision.supportOp ? 'OVERRIDE' : 'CORRECT') : action.toUpperCase(),
    resource,
    resourceId,
    before: oldValue,
    after: newValue,
    reason,
    correctionId,
    supportOp: decision.supportOp,
  });

  return { correctionId };
}

module.exports = { recordOwnershipAction };
