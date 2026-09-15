// requireOwnership() — API_ARCHITECTURE.md §7 / STEP 8-9-14, platform-wide, every module.
// Split into a pure decision function (checkOwnership) and a thin Express wrapper (requireOwnership)
// so the authorization logic itself is unit-testable without spinning up Express or Mongo — see
// v3/server/tests/ownership.test.js for the acceptance-test scenarios this implements
// (ACCESS_MATRIX.md §13.4).
//
// PHASE 4 HARDENING (spec §3/§4/§5/§11):
//   * EDIT and DELETE no longer share one state rule. Delete eligibility now goes through
//     config/recordPolicy.js's stricter DELETE_POLICY (DRAFT → creator; SUBMITTED/APPROVED →
//     restricted; POSTED/FINALIZED/CLOSED/LOCKED → reversal only; financial resources → never).
//   * A BUSINESS action (APPROVE/ASSIGN/VERIFY/CLOSE/SUBMIT/REVERSE/...) can no longer be routed
//     through this gate at all. Business authority and record-edit authority are separate axes;
//     holding one must never confer the other (spec §5).
const { sendError } = require('../utils/ApiError');
const {
  canMutateInState, isBusinessAction, isRecordMutationAction, getResourcePolicy,
} = require('../config/recordPolicy');

/**
 * action: 'edit' | 'update' | 'delete' | 'correct' | 'restore'
 * record: { co, createdByUserId, status }
 * user:   { id, co, role, permissions }
 * options.supportOp / options.supportReason: ONLY meaningful for role === 'super' — see STEP 14.
 * Returns { allowed, requiresCorrection, supportOp, reason }
 */
function checkOwnership({ record, user, action = 'edit', resource, overridePermissionCode, supportOp, supportReason }) {
  if (!record) return { allowed: false, reason: 'Record not found' };
  if (!user) return { allowed: false, reason: 'Auth required' };

  // §5 — this gate governs record mutation only. Routing APPROVE/ASSIGN/VERIFY/CLOSE/SUBMIT through
  // it would make a business permission look like edit authority, which is exactly the conflation
  // the spec forbids ("BUSINESS ACTION ≠ RECORD EDIT").
  if (isBusinessAction(action)) {
    return {
      allowed: false,
      reason: `${String(action).toUpperCase()} is a business action, not a record mutation — authorize it with its own business permission, never through ownership`,
    };
  }
  const effectiveAction = isRecordMutationAction(action) ? String(action).toLowerCase() : 'edit';

  const crossCompany = String(record.co) !== String(user.co);

  // STEP 14 — Super Admin is NOT a blanket business-record editor. Cross-company access is only
  // possible for super at all (a normal user is denied outright below), and even for super it is
  // NEVER automatic: it requires an explicit, reasoned Support Op, and is always routed through
  // RecordCorrection + a `supportOp: true` AuditLog entry — never a silent edit.
  if (user.role === 'super') {
    if (!supportOp) {
      return { allowed: false, reason: 'Super Admin business-record edit requires an explicit Support Op — see DOCUMENT_AUTHORITY.md Super Admin Support-Access Rule' };
    }
    if (!supportReason || !supportReason.trim()) {
      return { allowed: false, reason: 'Support Op requires a reason' };
    }
    return { allowed: true, requiresCorrection: true, supportOp: true, reason: 'Super Admin Support Op' };
  }

  // Company isolation — always checked before ownership, never bypassed by ownership or override,
  // for any non-super user.
  if (crossCompany) {
    return { allowed: false, reason: 'Cross-company access denied' };
  }

  const isOwner = record.createdByUserId != null && String(record.createdByUserId) === String(user.id);
  const permissions = user.permissions || [];
  // NOTE: this is an explicit, per-user, per-resource-type GRANT (e.g. 'quotation.override') that a
  // Company Admin assigns deliberately through the permission system — it is never implied by role,
  // job title, or "being a Manager/Admin" alone (STEP 8 hard rule: no generic Manager/Admin bypass).
  const permCode = overridePermissionCode || getResourcePolicy(resource).overridePermission;
  const hasOverride = permissions.includes(permCode) || permissions.includes('*');

  if (!isOwner && !hasOverride) {
    return { allowed: false, reason: 'Not the record owner and no override authority' };
  }

  // Record state — now action-aware, so DELETE is genuinely stricter than EDIT (spec §11) rather
  // than both sharing the single IMMUTABLE_STATES test.
  const stateDecision = canMutateInState(record.status, effectiveAction, resource);

  if (hasOverride && !isOwner) {
    // Manager/Admin touching someone else's record via an explicit granted override — NEVER a
    // silent write, always RecordCorrection. Locked/restricted states still block this the same as
    // an owner edit would — a correction is not a bypass of business-state immutability, only
    // reversal is.
    if (!stateDecision.allowed) return { allowed: false, reason: stateDecision.reason };
    return { allowed: true, requiresCorrection: true, reason: 'Override — must go through RecordCorrection' };
  }

  // Plain creator edit/delete (isOwner true, with or without an unrelated override permission) —
  // governed purely by record state.
  if (!stateDecision.allowed) return { allowed: false, reason: stateDecision.reason };
  return { allowed: true, requiresCorrection: false };
}

// Express middleware wrapper. `loadRecord(req)` must return the record (or null) with at least
// { co, createdByUserId, status }. `overridePermissionCode` defaults to `${resource}.override`.
function requireOwnership({ resource, loadRecord, action = 'edit', overridePermissionCode }) {
  const permCode = overridePermissionCode || `${resource}.override`;
  return async (req, res, next) => {
    try {
      const record = req.record || await loadRecord(req);
      const decision = checkOwnership({
        record,
        user: req.user && { id: req.user._id, co: req.user.co, role: req.user.role, permissions: req.user.permissions },
        action,
        resource,
        overridePermissionCode: permCode,
        supportOp: req.body?._supportOp,
        supportReason: req.body?._supportReason,
      });
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.ownershipDecision = { ...decision, resource, action };
      req.record = record;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { checkOwnership, requireOwnership };
