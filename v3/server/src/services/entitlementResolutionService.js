// Async orchestrator around services/commercialEntitlementService.js's pure formula — loads the real
// Subscription/DivisionEntitlement/FeatureEntitlement/AddOn rows for a company, computes effective
// entitlements, and writes them to Company.entitlements as a CACHE with a validity stamp
// (PLAN_ENTITLEMENTS.md §2: "any middleware that reads Company.entitlements MUST check computedAt <
// 5 minutes old; else force recompute. Any write to Subscription/DivisionEntitlement/
// FeatureEntitlement/AddOn triggers recompute and cache-invalidation broadcast.").
//
// This is the ONLY place that assembles real DB rows for entitlement computation — no controller or
// other service queries Subscription/DivisionEntitlement/FeatureEntitlement/AddOn directly to answer
// "is this company entitled to X" (V3 PHASE 3 spec §11: "Do not let individual modules independently
// calculate entitlement").
const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const DivisionEntitlement = require('../models/DivisionEntitlement');
const FeatureEntitlement = require('../models/FeatureEntitlement');
const AddOn = require('../models/AddOn');
const { resolveEffectiveEntitlements, checkLimit } = require('./commercialEntitlementService');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — PLAN_ENTITLEMENTS.md §2

async function loadCompanyCommercialState(companyId) {
  const [subscription, divisionEntitlements, featureEntitlements] = await Promise.all([
    Subscription.findOne({ co: companyId, status: { $in: ['active', 'trial'] } }).lean(),
    DivisionEntitlement.find({ co: companyId }).lean(),
    FeatureEntitlement.find({ co: companyId }).lean(),
  ]);

  const addOnCodes = subscription ? (subscription.addOns || []).filter((a) => a.active).map((a) => a.addOnCode) : [];
  const addOnDocs = addOnCodes.length ? await AddOn.find({ code: { $in: addOnCodes } }).lean() : [];
  const activeAddOnCatalogByCode = {};
  for (const doc of addOnDocs) activeAddOnCatalogByCode[doc.code] = doc;

  return { subscription, divisionEntitlements, featureEntitlements, activeAddOnCatalogByCode };
}

/**
 * computeAndCacheEntitlements() — recomputes from source rows and writes the Company.entitlements
 * cache. Called after every commercial write (Subscription create/change, DivisionEntitlement/
 * FeatureEntitlement manual set, AddOn assign/remove) — never left stale by a write path.
 */
async function computeAndCacheEntitlements(companyId) {
  const state = await loadCompanyCommercialState(companyId);
  const result = resolveEffectiveEntitlements(state);

  const cache = {
    divisions: result.divisions,
    modules: result.modules,
    features: result.features,
    limits: result.limits,
    migrationReviewRequired: result.status === 'migration_review_required',
    computedAt: result.computedAt,
    computedFrom: result.computedFrom,
  };

  await Company.findByIdAndUpdate(companyId, { $set: { entitlements: cache } });
  return cache;
}

function isCacheStale(entitlementsCache) {
  if (!entitlementsCache || !entitlementsCache.computedAt) return true;
  return Date.now() - new Date(entitlementsCache.computedAt).getTime() > CACHE_TTL_MS;
}

/**
 * getEffectiveEntitlements() — reads the cache if fresh, else forces a recompute. This is the
 * function `req.entitlements` should ultimately be populated from once Phase 3's Subscription/
 * DivisionEntitlement/FeatureEntitlement rows exist for a company (middleware/tenant.js's
 * `loadEntitlements()` still reads the raw Company.entitlements cache directly for Phase 1/2
 * backward compatibility — this is the richer Phase 3 entry point for anything that needs a
 * guaranteed-fresh read, e.g. a limits check before a write).
 */
async function getEffectiveEntitlements(companyId, { forceRecompute = false } = {}) {
  if (!forceRecompute) {
    const company = await Company.findById(companyId).lean();
    if (company && !isCacheStale(company.entitlements)) return company.entitlements;
  }
  return computeAndCacheEntitlements(companyId);
}

/**
 * companyHasFeature() — the single question the authorization layer should ask instead of knowing
 * how the commercial data is stored (V3 PHASE 3 spec §6).
 */
async function companyHasFeature(companyId, featureCode) {
  const entitlements = await getEffectiveEntitlements(companyId);
  const value = entitlements.features ? entitlements.features[featureCode] : undefined;
  return value === true || (typeof value === 'number' && value > 0);
}

/**
 * checkCompanyLimit() — companyId + limit key -> {withinLimit, unlimited, remaining}, using a
 * guaranteed-fresh cache read.
 */
async function checkCompanyLimit(companyId, limitKey, currentUsage = 0) {
  const entitlements = await getEffectiveEntitlements(companyId);
  return checkLimit(entitlements.limits, limitKey, currentUsage);
}

module.exports = {
  loadCompanyCommercialState,
  computeAndCacheEntitlements,
  getEffectiveEntitlements,
  isCacheStale,
  companyHasFeature,
  checkCompanyLimit,
  CACHE_TTL_MS,
};
