// Every v3 mutation writes an AuditLog entry through this single function — no route writes
// AuditLog directly, so the shape stays uniform (API_ARCHITECTURE.md §9). Audit records are never
// editable through normal CRUD (see models/AuditLog.js's immutability guards) and there is no
// audit-delete endpoint anywhere in v3.
const AuditLog = require('../models/AuditLog');

const SECRET_KEY_PATTERN = /pass(word)?|token|secret|jwt|creditcard|cardnumber/i;

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERN.test(k)) continue; // never store
    out[k] = v && typeof v === 'object' ? redact(v) : v;
  }
  return out;
}

async function audit({ req, action, resource, resourceId, before, after, reason, status, correctionId, supportOp }) {
  try {
    await AuditLog.create({
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
    });
  } catch (err) {
    // Audit failures must never crash the request, but must be loud in logs.
    console.error('[v3/audit] failed to write AuditLog:', err.message);
  }
}

module.exports = { audit, redact };
