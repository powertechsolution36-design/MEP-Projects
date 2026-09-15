// Manual entitlement overrides — Super Admin only (caller authorizes via middleware/platform.js).
// Every manual change is explicit, company-scoped, audited, and reasoned (V3 PHASE 3 spec §14) — a
// manual row always outranks plan/addon (PLAN_ENTITLEMENTS.md §4), and is created here, never by any
// other code path writing DivisionEntitlement/FeatureEntitlement directly.
const DivisionEntitlement = require('../models/DivisionEntitlement');
const FeatureEntitlement = require('../models/FeatureEntitlement');
const { DIVISION_VALUES, ALL_FEATURE_CODES } = require('../config/constants');
const { audit } = require('./auditService');
const { computeAndCacheEntitlements } = require('./entitlementResolutionService');

class ManualEntitlementError extends Error {
  constructor(message, code = 'MANUAL_ENTITLEMENT_ERROR') {
    super(message);
    this.code = code;
  }
}

/**
 * setManualDivisionEntitlement() — always CREATES a new row (never mutates a prior one) so the
 * "most-recent row per division wins" precedence rule and the full audit history both stay intact.
 */
async function setManualDivisionEntitlement({ req, companyId, division, enabled, reason, historicalData = false }) {
  if (!DIVISION_VALUES.includes(division)) {
    throw new ManualEntitlementError(`Unknown division: ${division}`, 'INVALID_DIVISION');
  }
  if (!reason || !reason.trim()) {
    throw new ManualEntitlementError('A reason is required for a manual entitlement change', 'REASON_REQUIRED');
  }

  const row = await DivisionEntitlement.create({
    co: companyId, division, enabled, source: 'manual', reason, historicalData, setBy: req.user._id, setAt: new Date(),
  });

  await audit({
    req,
    action: enabled ? 'DIVISION_ENABLED' : 'DIVISION_DISABLED',
    resource: 'divisionEntitlement', resourceId: row._id, reason,
    after: { division, enabled, source: 'manual' },
  });
  await audit({
    req, action: enabled ? 'MANUAL_ENTITLEMENT_GRANTED' : 'MANUAL_ENTITLEMENT_DISABLED',
    resource: 'divisionEntitlement', resourceId: row._id, reason, after: { division, enabled },
  });

  await computeAndCacheEntitlements(companyId);
  return row;
}

/**
 * setManualFeatureEntitlement() — same pattern; `limit` (PLAN_ENTITLEMENTS.md §7) lets this override
 * a numeric feature limit directly instead of only toggling on/off.
 */
async function setManualFeatureEntitlement({ req, companyId, feature, enabled, limit = null, reason }) {
  if (!ALL_FEATURE_CODES.includes(feature)) {
    throw new ManualEntitlementError(`Unknown feature code: ${feature}`, 'INVALID_FEATURE');
  }
  if (!reason || !reason.trim()) {
    throw new ManualEntitlementError('A reason is required for a manual entitlement change', 'REASON_REQUIRED');
  }

  const row = await FeatureEntitlement.create({
    co: companyId, feature, enabled, limit, source: 'manual', reason, setBy: req.user._id, setAt: new Date(),
  });

  await audit({
    req, action: enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
    resource: 'featureEntitlement', resourceId: row._id, reason,
    after: { feature, enabled, limit, source: 'manual' },
  });
  await audit({
    req, action: enabled ? 'MANUAL_ENTITLEMENT_GRANTED' : 'MANUAL_ENTITLEMENT_DISABLED',
    resource: 'featureEntitlement', resourceId: row._id, reason, after: { feature, enabled, limit },
  });

  await computeAndCacheEntitlements(companyId);
  return row;
}

module.exports = { setManualDivisionEntitlement, setManualFeatureEntitlement, ManualEntitlementError };
