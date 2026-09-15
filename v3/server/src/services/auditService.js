// Every v3 mutation writes an AuditLog entry through this single function — no route writes
// AuditLog directly, so the shape stays uniform (API_ARCHITECTURE.md §9). Audit records are never
// editable through normal CRUD (see models/AuditLog.js's immutability guards) and there is no
// audit-delete endpoint anywhere in v3.
//
// PHASE 4 HARDENING (spec §18/§19):
//   * Redaction now goes through the shared utils/redact.js so AuditLog and RecordCorrection can
//     never diverge on what counts as a secret, and so a Date inside a before/after snapshot is no
//     longer flattened to `{}` by the old object walk.
//   * Audit-failure policy is now explicit and per-call rather than "always swallow". An ordinary
//     operational mutation still must not be crashed by a logging outage (unchanged default), but a
//     financially/operationally critical mutation must NOT silently succeed while its audit write
//     fails — `critical: true` surfaces the failure so the caller aborts, and `runAudited()` gives
//     that caller real atomicity (a Mongo transaction) wherever the deployment's persistence
//     architecture supports one.
const AuditLog = require('../models/AuditLog');
const { redact } = require('../utils/redact');
const { logger } = require('../utils/logger');

class AuditFailureError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AuditFailureError';
    this.code = 'AUDIT_WRITE_FAILED';
    this.cause = cause;
  }
}

function buildEntry({ req, action, resource, resourceId, before, after, reason, status, correctionId, supportOp }) {
  return {
    co: req.user?.co,
    user: req.user?._id,
    userName: req.user?.name,
    action,
    resource,
    resourceId,
    method: req.method,
    path: req.originalUrl || req.path,
    status,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
    before: redact(before),
    after: redact(after),
    reason,
    correctionId,
    supportOp: !!supportOp,
  };
}

/**
 * @param {Object}  params
 * @param {boolean} [params.critical]  when true, a failed audit write REJECTS instead of being
 *                                     swallowed — the caller is then responsible for aborting or
 *                                     compensating its mutation (spec §18).
 * @param {Object}  [params.session]   Mongoose session, when the caller runs inside a transaction.
 */
async function audit({
  req, action, resource, resourceId, before, after, reason, status, correctionId, supportOp,
  critical = false, session,
}) {
  const entry = buildEntry({ req, action, resource, resourceId, before, after, reason, status, correctionId, supportOp });
  try {
    if (session) await AuditLog.create([entry], { session });
    else await AuditLog.create(entry);
  } catch (err) {
    if (critical) {
      // Loud, and fatal to the caller's mutation — never a silent success on an unaudited write.
      logger.error('audit_write_failed_critical', { action, resource, message: err.message });
      throw new AuditFailureError(`Audit write failed for ${action} ${resource}: ${err.message}`, err);
    }
    // Non-critical operational mutation: the request still succeeds, but the failure is loud.
    console.error('[v3/audit] failed to write AuditLog:', err.message);
  }
}

/** Convenience wrapper — identical to audit({ ..., critical: true }). */
function auditCritical(params) {
  return audit({ ...params, critical: true });
}

// Transactions need a replica set; a standalone mongod (and every unit test in this suite) has none.
// Probing here rather than at import time keeps this module usable with mocked models.
async function startSessionIfSupported() {
  try {
    const { isConnected, getV3Connection } = require('../db/connection');
    if (!isConnected()) return null;
    const connection = getV3Connection();
    if (typeof connection.startSession !== 'function') return null;
    return await connection.startSession();
  } catch (err) {
    logger.warn('audit_session_unavailable', { message: err.message });
    return null;
  }
}

/**
 * runAudited — the atomic path for a mutation that MUST NOT exist without its audit entry
 * (§18: payments, postings, reversals, entitlement changes, corrections).
 *
 * When the connection supports transactions (replica set / Atlas), the mutation and the AuditLog
 * write commit or abort together. When it does not (standalone mongod, or a unit test with mocked
 * models), it degrades to sequential execution with a CRITICAL audit write: if the audit fails the
 * caller's `compensate` hook runs and the error is rethrown, so the request still fails loudly
 * instead of returning success on an unaudited mutation.
 *
 * @param {Object}   params
 * @param {Function} params.mutate       async (session|null) => result — performs the actual write
 * @param {Function} [params.compensate] async (result) => void — undo hook for the non-transactional
 *                                       fallback when the audit write fails
 * @param {Function} [params.buildAudit] (result) => extra audit params merged over the base ones,
 *                                       for when resourceId/after are only known post-mutation
 */
async function runAudited({ mutate, compensate, buildAudit, ...auditParams }) {
  const session = await startSessionIfSupported();

  if (session) {
    try {
      let result;
      await session.withTransaction(async () => {
        result = await mutate(session);
        await audit({ ...auditParams, ...(buildAudit ? buildAudit(result) : {}), critical: true, session });
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  const result = await mutate(null);
  try {
    await audit({ ...auditParams, ...(buildAudit ? buildAudit(result) : {}), critical: true });
  } catch (err) {
    if (compensate) {
      try {
        await compensate(result);
      } catch (compErr) {
        logger.error('audit_compensation_failed', { message: compErr.message });
      }
    }
    throw err;
  }
  return result;
}

module.exports = { audit, auditCritical, runAudited, redact, AuditFailureError };
