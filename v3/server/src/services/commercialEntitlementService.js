// Phase 3 authoritative effective-entitlement formula — PLAN_ENTITLEMENTS.md §4/§5/§7, implemented
// EXACTLY as specified there. This is a pure function: it never touches the database itself — see
// services/entitlementResolutionService.js for the async orchestrator that loads real Subscription/
// DivisionEntitlement/FeatureEntitlement/AddOn rows and calls this.
//
// This supersedes services/entitlementService.js's `computeEffectiveEntitlements()` as the
// authoritative formula for real commercial data going forward — that Phase 1 foundation function is
// left completely unchanged (including its exact parameter shapes) because its own Phase 1 tests
// call it directly; nothing here modifies or removes it. No individual feature module should
// re-derive entitlement math itself — everything routes through resolveEffectiveEntitlements() /
// services/entitlementResolutionService.js's companyHasFeature()-style helpers.
const { DIVISION_VALUES, UNLIMITED, LIMIT_KEYS } = require('../config/constants');

function toSet(arr) {
  return new Set(Array.isArray(arr) ? arr : []);
}

// Most-recent-row-per-key helper — PLAN_ENTITLEMENTS.md §4: "Precedence uses the most recent row
// per (co, division) for the manual/addon/migration layers."
function latestByKey(rows, keyField) {
  const latest = new Map();
  for (const row of rows || []) {
    const key = row[keyField];
    const existing = latest.get(key);
    const rowTime = new Date(row.setAt || row.updatedAt || 0).getTime();
    const existingTime = existing ? new Date(existing.setAt || existing.updatedAt || 0).getTime() : -Infinity;
    if (!existing || rowTime >= existingTime) latest.set(key, row);
  }
  return latest;
}

// Limit merge — "addon" layer ADDS to the plan's limit (never overrides it outright); a manual row
// REPLACES the effective limit outright. UNLIMITED is a sentinel string that beats any finite
// number in either direction (an unlimited base stays unlimited after an add-on adds a finite
// amount; an add-on that itself grants UNLIMITED makes the result unlimited).
function mergeAddLimit(base, addition) {
  if (base === UNLIMITED || addition === UNLIMITED) return UNLIMITED;
  const b = typeof base === 'number' ? base : 0;
  const a = typeof addition === 'number' ? addition : 0;
  if (base == null && addition == null) return null;
  return b + a;
}

/**
 * validateAddOnAttach() — PLAN_ENTITLEMENTS.md §5. Pure — the caller (services/subscriptionService.js)
 * is responsible for loading the AddOn/Plan/DivisionEntitlement rows and passing them in.
 * @param {Object} args
 * @param {Object} args.addOn - AddOn catalog doc {code, divisionsGranted, compatiblePlans}
 * @param {Object} args.planSnapshot - the company's current Subscription.planSnapshot
 * @param {Object[]} [args.recentManualDivisionEntitlements] - most-recent manual DivisionEntitlement rows relevant to the granted divisions
 * @returns {{valid:boolean, reason?:string}}
 */
function validateAddOnAttach({ addOn, planSnapshot, recentManualDivisionEntitlements = [] }) {
  if (!addOn) return { valid: false, reason: 'Add-on not found' };
  if (!addOn.active) return { valid: false, reason: 'Add-on is not currently active in the catalog' };
  if (!planSnapshot) return { valid: false, reason: 'No active subscription / plan snapshot' };

  const compatible = !Array.isArray(addOn.compatiblePlans) || addOn.compatiblePlans.length === 0
    || addOn.compatiblePlans.includes(planSnapshot.code);
  if (!compatible) {
    return { valid: false, reason: `Add-on ${addOn.code} is not compatible with plan ${planSnapshot.code}` };
  }

  const forbidden = new Set(planSnapshot.forbiddenDivisions || []);
  for (const division of addOn.divisionsGranted || []) {
    if (forbidden.has(division)) {
      return { valid: false, reason: `Plan ${planSnapshot.code} explicitly forbids division ${division}` };
    }
  }

  // No more-recent manual disable on any division this add-on would grant.
  const latestManual = latestByKey(recentManualDivisionEntitlements, 'division');
  for (const division of addOn.divisionsGranted || []) {
    const manualRow = latestManual.get(division);
    if (manualRow && manualRow.source === 'manual' && manualRow.enabled === false) {
      return { valid: false, reason: `Division ${division} was manually disabled and takes precedence over this add-on` };
    }
  }

  return { valid: true };
}

/**
 * resolveEffectiveEntitlements() — PLAN_ENTITLEMENTS.md §7 formula, verbatim.
 * @param {Object} args
 * @param {Object|null} args.subscription - the company's current active/trial Subscription doc (or null)
 * @param {Object[]} [args.activeAddOnCatalogByCode] - Map<code, AddOn catalog doc> for every code in subscription.addOns[]
 * @param {Object[]} [args.divisionEntitlements] - ALL DivisionEntitlement rows for the company (any source)
 * @param {Object[]} [args.featureEntitlements] - ALL FeatureEntitlement rows for the company (any source)
 * @returns {{
 *   status: 'ok'|'migration_review_required',
 *   divisions: string[], modules: string[], features: Object, limits: Object,
 *   computedAt: Date,
 *   computedFrom: { subscriptionId, divisionEntitlementIds: string[], featureEntitlementIds: string[], activeAddOnCodes: string[] }
 * }}
 */
function resolveEffectiveEntitlements({ subscription, activeAddOnCatalogByCode = {}, divisionEntitlements = [], featureEntitlements = [] }) {
  if (!subscription) {
    // "if not sub: return LEGACY_REVIEW_REQUIRED" — PLAN_ENTITLEMENTS.md §7.
    return {
      status: 'migration_review_required',
      divisions: [], modules: [], features: {}, limits: {},
      computedAt: new Date(),
      computedFrom: { subscriptionId: null, divisionEntitlementIds: [], featureEntitlementIds: [], activeAddOnCodes: [] },
    };
  }

  const snapshot = subscription.planSnapshot || {};

  // 1. Base from plan snapshot.
  let divisions = new Set(
    (snapshot.availableDivisions || []).filter((d) => (subscription.purchasedDivisions || []).includes(d)),
  );
  let modules = toSet(snapshot.includedModules);
  let features = { ...(snapshot.defaultFeatures || {}) };
  let limits = { ...(snapshot.defaultLimits || {}) };

  // 2. Layer active add-ons.
  const activeAddOnCodes = (subscription.addOns || []).filter((a) => a.active).map((a) => a.addOnCode);
  for (const code of activeAddOnCodes) {
    const addOn = activeAddOnCatalogByCode[code];
    if (!addOn) continue; // unknown/removed-from-catalog code — ignore rather than crash
    for (const d of addOn.divisionsGranted || []) divisions.add(d);
    for (const [k, v] of Object.entries(addOn.featuresGranted || {})) {
      features[k] = v;
      if (v) modules.add(k.split('.')[0]);
    }
    for (const key of LIMIT_KEYS) {
      if (addOn.limits && addOn.limits[key] != null) {
        limits[key] = mergeAddLimit(limits[key], addOn.limits[key]);
      }
    }
  }

  // 3. Layer manual DivisionEntitlement rows (most-recent per division wins).
  const manualDivisionRows = (divisionEntitlements || []).filter((r) => r.source === 'manual');
  for (const de of latestByKey(manualDivisionRows, 'division').values()) {
    if (de.enabled) divisions.add(de.division);
    else divisions.delete(de.division);
  }

  // 4. Layer manual FeatureEntitlement rows.
  const manualFeatureRows = (featureEntitlements || []).filter((r) => r.source === 'manual');
  for (const fe of latestByKey(manualFeatureRows, 'feature').values()) {
    features[fe.feature] = fe.limit != null ? fe.limit : fe.enabled;
  }

  // 5. Migration rows are informational only — never re-grant (already excluded above since only
  // 'manual' rows are layered at steps 3/4; plan/addon/migration-sourced rows never override here).

  divisions = new Set([...divisions].filter((d) => DIVISION_VALUES.includes(d)));

  return {
    status: 'ok',
    divisions: [...divisions],
    modules: [...modules],
    features,
    limits,
    computedAt: new Date(),
    computedFrom: {
      subscriptionId: subscription._id,
      divisionEntitlementIds: (divisionEntitlements || []).map((r) => r._id),
      featureEntitlementIds: (featureEntitlements || []).map((r) => r._id),
      activeAddOnCodes,
    },
  };
}

/**
 * checkLimit() — distinguishes unlimited / zero (not entitled) / a finite quota, and never confuses
 * "feature enabled" with "unlimited quantity" (V3 PHASE 3 spec §12).
 * @returns {{withinLimit:boolean, unlimited:boolean, remaining:number|null}}
 */
function checkLimit(limits, key, currentUsage = 0) {
  const value = limits ? limits[key] : undefined;
  if (value === UNLIMITED) return { withinLimit: true, unlimited: true, remaining: null };
  if (value == null) return { withinLimit: false, unlimited: false, remaining: 0 }; // not entitled — never silently "everything"
  const numeric = Number(value);
  const remaining = Math.max(0, numeric - currentUsage);
  return { withinLimit: currentUsage < numeric, unlimited: false, remaining };
}

module.exports = { resolveEffectiveEntitlements, validateAddOnAttach, checkLimit, mergeAddLimit, latestByKey };
