// GET /api/v3/entitlements/:companyId (read-only view, API_ARCHITECTURE.md §3) + the manual
// division/feature override endpoints (platform-admin only, V3 PHASE 3 spec §14/§16).
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const { getEffectiveEntitlements } = require('../services/entitlementResolutionService');
const manualEntitlementService = require('../services/manualEntitlementService');

// Tenant isolation for a read-only view keyed by :targetCompanyId in the URL — never trust the param
// alone; a non-platform-admin caller may only ever read their OWN company's entitlements.
const getEntitlements = asyncHandler(async (req, res) => {
  const { targetCompanyId } = req.params;
  if (req.user.role !== 'super' && String(targetCompanyId) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  const entitlements = await getEffectiveEntitlements(targetCompanyId, { forceRecompute: req.query.forceRecompute === 'true' });
  res.json({ companyId: targetCompanyId, entitlements });
});

function handleManualError(res, err) {
  const statusByCode = { INVALID_DIVISION: 422, INVALID_FEATURE: 422, REASON_REQUIRED: 422 };
  const status = statusByCode[err.code];
  if (status) return sendError(res, status, err.message, { code: err.code });
  throw err;
}

const setDivisionEntitlement = asyncHandler(async (req, res) => {
  try {
    const row = await manualEntitlementService.setManualDivisionEntitlement({
      req, companyId: req.body.targetCompanyId, division: req.body.division,
      enabled: req.body.enabled, reason: req.body.reason, historicalData: req.body.historicalData,
    });
    res.status(201).json({ divisionEntitlement: row });
  } catch (err) { handleManualError(res, err); }
});

const setFeatureEntitlement = asyncHandler(async (req, res) => {
  try {
    const row = await manualEntitlementService.setManualFeatureEntitlement({
      req, companyId: req.body.targetCompanyId, feature: req.body.feature,
      enabled: req.body.enabled, limit: req.body.limit, reason: req.body.reason,
    });
    res.status(201).json({ featureEntitlement: row });
  } catch (err) { handleManualError(res, err); }
});

module.exports = { getEntitlements, setDivisionEntitlement, setFeatureEntitlement };
