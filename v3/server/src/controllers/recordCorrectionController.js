// RecordCorrection — READ ONLY (API_ARCHITECTURE.md §2: "creation happens as a side-effect of an
// authorized override write, never posted directly by an arbitrary client").
//
// A correction row is the audit trail of a Manager/Admin touching an employee's record, so it is
// tenant-scoped exactly like the record it describes: a user may only ever read corrections
// belonging to their own company, and only Super Admin may target another company explicitly.
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const RecordCorrection = require('../models/RecordCorrection');
const { buildCorrectionQuery } = require('../services/recordHistoryService');

function scopeCompany(req) {
  // Super Admin may target a company through the dedicated, permission-gated param that
  // middleware/tenant.js sets; everyone else is pinned to their own company and cannot widen it,
  // because enforceTenantScope() has already stripped any client-supplied companyId/co keys.
  return req.tenantCompanyId || req.user.co;
}

const listCorrections = asyncHandler(async (req, res) => {
  const companyId = scopeCompany(req);
  if (!companyId) return sendError(res, 400, 'No company scope for this request');

  const filter = buildCorrectionQuery({
    companyId,
    resource: req.query.resource,
    recordId: req.query.recordId,
    overrideBy: req.query.overrideBy,
    originalOwner: req.query.originalOwner,
    supportOp: req.query.supportOp === undefined ? undefined : req.query.supportOp === 'true',
    from: req.query.from,
    to: req.query.to,
  });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const corrections = await RecordCorrection.find(filter).sort({ overrideAt: -1 }).limit(limit).lean();
  res.json({ corrections, count: corrections.length });
});

const getCorrection = asyncHandler(async (req, res) => {
  const correction = await RecordCorrection.findById(req.params.id).lean();
  if (!correction) return sendError(res, 404, 'RecordCorrection not found');
  // Tenant isolation on a record fetched BY ID — the id alone is not authority to read it.
  if (req.user.role !== 'super' && String(correction.co) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  res.json({ correction });
});

// Explicit, documented refusal rather than a 404-by-omission, so the "never posted directly" rule
// is visible in the API surface and directly testable.
const rejectDirectWrite = (req, res) => sendError(
  res, 405,
  'RecordCorrection rows are created only as a side-effect of an authorized override write — they cannot be posted directly',
  { code: 'METHOD_NOT_ALLOWED' },
);

module.exports = { listCorrections, getCorrection, rejectDirectWrite };
