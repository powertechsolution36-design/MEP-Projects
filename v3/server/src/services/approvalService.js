// Real approval engine — ApprovalRule / ApprovalRequest / ApprovalStep (DATABASE_ARCHITECTURE.md).
// This is the ONLY sanctioned way a protected mutation moves from "requested" to "executed" —
// route handlers for an approval-gated resource call submit()/decide() here rather than writing the
// target resource's state directly, so the decision can never be bypassed by a direct API call that
// skips this module. Approval UI is explicitly NOT built in this pass (Phase 2 scope) — this is the
// engine only.
const mongoose = require('mongoose');
const ApprovalRequest = require('../models/ApprovalRequest');
const ApprovalStep = require('../models/ApprovalStep');
const ApprovalRule = require('../models/ApprovalRule');
const { audit } = require('./auditService');
const { hasPermission } = require('./permissionService');

class ApprovalError extends Error {
  constructor(message, code = 'APPROVAL_ERROR') {
    super(message);
    this.code = code;
  }
}

/**
 * submit() — creates a new ApprovalRequest, or returns the existing pending one for the exact same
 * (co, resource, resourceId, action) unchanged — idempotent, so a retried submit never creates a
 * second competing request (STEP 20 "duplicate-approve/duplicate-reject" tests exercise this at the
 * decide() layer; this is the equivalent guard at submit()).
 */
async function submit({ req, resource, resourceId, action, payload, ruleIds = [], idempotencyKey }) {
  if (!req?.user) throw new ApprovalError('Auth required', 'UNAUTHENTICATED');
  const co = req.user.co;

  if (idempotencyKey) {
    const existingByKey = await ApprovalRequest.findOne({ idempotencyKey }).lean();
    if (existingByKey) return existingByKey;
  }

  const existingPending = await ApprovalRequest.findOne({
    co, resource, resourceId, action, status: 'pending',
  }).lean();
  if (existingPending) return existingPending;

  const request = await ApprovalRequest.create({
    co,
    requesterId: req.user._id,
    resource,
    resourceId,
    action,
    payload,
    ruleIds,
    status: 'pending',
    idempotencyKey,
  });

  await audit({
    req, action: 'SUBMIT', resource, resourceId,
    after: { approvalRequestId: request._id, status: 'pending' },
  });

  return request;
}

/**
 * A user may decide an ApprovalRequest only if they hold approval authority for it — a permission
 * grant (APPROVE/REJECT), never merely because they own the underlying record. Ownership and
 * approval authority are deliberately separate axes (STEP requirement: "approver permissions
 * separate from ownership").
 */
function canDecide(user, rule) {
  if (!user) return false;
  if (user.role === 'super') return true;
  if (rule && Array.isArray(rule.approvers) && rule.approvers.length) {
    return rule.approvers.some((a) => (a.userId && String(a.userId) === String(user._id)) || (a.role && a.role === user.role) || (a.role && a.role === user.designation));
  }
  return hasPermission(user, 'APPROVE') || hasPermission(user, 'REJECT');
}

/**
 * decide() — record one ApprovalStep and, once quorum is met (or on the first reject — rejection is
 * never quorum-gated, a single authorized rejector can stop the request), transition the
 * ApprovalRequest's status. Never allows a second decision on an already-decided request (duplicate-
 * approve / duplicate-reject both rejected here) and never lets a rejected/expired/executed request
 * be decided again.
 */
async function decide({ req, requestId, decision, note, rule, execute }) {
  if (!req?.user) throw new ApprovalError('Auth required', 'UNAUTHENTICATED');
  if (!['approve', 'reject'].includes(decision)) throw new ApprovalError('decision must be "approve" or "reject"', 'INVALID_DECISION');

  const request = await ApprovalRequest.findById(requestId);
  if (!request) throw new ApprovalError('Approval request not found', 'NOT_FOUND');
  if (String(request.co) !== String(req.user.co) && req.user.role !== 'super') {
    throw new ApprovalError('Cross-company access denied', 'FORBIDDEN');
  }
  if (request.status !== 'pending') {
    throw new ApprovalError(`Approval request is already ${request.status} — cannot decide again`, 'ALREADY_DECIDED');
  }
  if (!canDecide(req.user, rule)) {
    throw new ApprovalError('No approval authority for this request', 'FORBIDDEN');
  }

  const priorSteps = await ApprovalStep.find({ requestId: request._id }).lean();
  const alreadyDecidedByThisUser = priorSteps.some((s) => String(s.approverId) === String(req.user._id));
  if (alreadyDecidedByThisUser) {
    throw new ApprovalError('This approver has already decided on this request', 'ALREADY_DECIDED');
  }

  await ApprovalStep.create({
    requestId: request._id,
    approverId: req.user._id,
    stepIndex: priorSteps.length,
    decision,
    note,
  });

  if (decision === 'reject') {
    request.status = 'rejected';
    request.decidedAt = new Date();
    await request.save();
    await audit({ req, action: 'REJECT', resource: request.resource, resourceId: request.resourceId, reason: note, after: { status: 'rejected' } });
    return request;
  }

  const quorum = (rule?.approvers || []).reduce((max, a) => Math.max(max, a.quorum || 1), 1);
  const approveCount = priorSteps.filter((s) => s.decision === 'approve').length + 1;

  if (approveCount < quorum) {
    // Quorum not yet met — request stays pending, additional approvers still need to decide.
    await audit({ req, action: 'APPROVE', resource: request.resource, resourceId: request.resourceId, reason: note, after: { status: 'pending', approveCount, quorum } });
    return request;
  }

  request.status = 'approved';
  request.decidedAt = new Date();
  await request.save();
  await audit({ req, action: 'APPROVE', resource: request.resource, resourceId: request.resourceId, reason: note, after: { status: 'approved' } });

  return executeApproved({ req, request, execute });
}

/**
 * executeApproved() — server-authoritative execution, idempotent via idempotencyKey/executionStatus:
 * a retried execute() call on a request that is already 'succeeded' is a no-op returning the same
 * result, never a second execution. `execute(request)` is an injected function (no concrete
 * resource module exists yet in this foundation) that performs the actual state transition on the
 * target resource and returns its result.
 */
async function executeApproved({ req, request, execute }) {
  if (request.executionStatus === 'succeeded') return request; // idempotent no-op on retry
  request.executionStatus = 'running';
  await request.save();
  try {
    if (typeof execute === 'function') await execute(request);
    request.status = 'executed';
    request.executionStatus = 'succeeded';
    request.executedAt = new Date();
    await request.save();
    await audit({ req, action: 'APPROVE', resource: request.resource, resourceId: request.resourceId, after: { status: 'executed', executionStatus: 'succeeded' } });
  } catch (err) {
    request.executionStatus = 'failed';
    await request.save();
    await audit({ req, action: 'APPROVE', resource: request.resource, resourceId: request.resourceId, after: { status: request.status, executionStatus: 'failed', error: err.message } });
    throw err;
  }
  return request;
}

/**
 * invalidatePending() — an approval-relevant edit to the underlying record must invalidate/restart
 * approval (STEP requirement), never leave a stale pending request that gets approved against
 * since-changed data. Marks the request 'expired', never silently deletes it (audit trail stays
 * intact).
 */
async function invalidatePending({ req, resource, resourceId, reason }) {
  const pending = await ApprovalRequest.find({
    co: req.user.co, resource, resourceId, status: 'pending',
  });
  for (const request of pending) {
    request.status = 'expired';
    request.decidedAt = new Date();
    await request.save();
    await audit({ req, action: 'REJECT', resource, resourceId, reason: reason || 'Invalidated by a subsequent edit', after: { status: 'expired' } });
  }
  return pending.length;
}

module.exports = { submit, decide, canDecide, invalidatePending, executeApproved, ApprovalError };
