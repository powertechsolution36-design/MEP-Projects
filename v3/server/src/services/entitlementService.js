// Effective-entitlement computation — DOCUMENT_AUTHORITY.md "Canonical Effective-Entitlement
// Precedence (FINAL, FROZEN)":
//
//   EXPLICIT MANUAL DISABLE  >  EXPLICIT MANUAL ENABLE  >  ADD-ON GRANT  >  SUBSCRIPTION PURCHASE  >  PLAN DEFAULT
//
// This is the FOUNDATION only — it computes correctly against whatever Subscription/
// DivisionEntitlement/FeatureEntitlement/AddOn rows exist, but no admin UI/CRUD for those
// collections is built in this pass (see BUILD_BASELINE.md STEP 19 exclusions). No hard-coded
// "seven plan combinations" list exists anywhere in this function — the result is always derived,
// never enumerated.
const { DIVISION_VALUES, ENTITLEMENT_SOURCES } = require('../config/constants');

/**
 * @param {Object} args
 * @param {Object} args.plan - Plan doc (or null)
 * @param {Object[]} args.subscriptions - active Subscription docs for the company
 * @param {Object[]} args.divisionEntitlements - DivisionEntitlement rows (manual overrides), most-recent-first per division
 * @param {Object[]} args.featureEntitlements - FeatureEntitlement rows (manual overrides), most-recent-first per feature
 * @param {Object[]} args.addOns - active AddOn docs
 * @returns {{ divisions: string[], features: string[], migrationReviewRequired: boolean }}
 */
function computeEffectiveEntitlements({ plan, subscriptions = [], divisionEntitlements = [], featureEntitlements = [], addOns = [] }) {
  // 1. PLAN DEFAULT (baseline)
  let divisions = new Set(plan?.defaultDivisions || []);
  let features = new Set(plan?.defaultFeatures || []);

  // 2. SUBSCRIPTION PURCHASE — intersect with purchasedDivisions across active subscriptions.
  const activeSubs = subscriptions.filter(s => s.active);
  if (activeSubs.length) {
    const purchased = new Set(activeSubs.flatMap(s => s.purchasedDivisions || []));
    divisions = new Set([...divisions].filter(d => purchased.has(d)));
  }

  // 3. ADD-ON GRANTS — add divisions/features on top.
  for (const addOn of addOns.filter(a => a.active)) {
    for (const d of addOn.grantsDivisions || []) divisions.add(d);
    for (const f of addOn.grantsFeatures || []) features.add(f);
  }

  // 4. EXPLICIT MANUAL ENABLE (add) — apply the latest manual row per division/feature.
  const latestByKey = (rows, keyField) => {
    const latest = new Map();
    for (const row of rows) {
      const existing = latest.get(row[keyField]);
      if (!existing || new Date(row.setAt) > new Date(existing.setAt)) latest.set(row[keyField], row);
    }
    return latest;
  };
  const latestDivisionRows = latestByKey(divisionEntitlements, 'division');
  const latestFeatureRows = latestByKey(featureEntitlements, 'feature');

  for (const row of latestDivisionRows.values()) {
    if (row.source === 'manual' && row.enabled) divisions.add(row.division);
  }
  for (const row of latestFeatureRows.values()) {
    if (row.source === 'manual' && row.enabled) features.add(row.feature);
  }

  // 5. EXPLICIT MANUAL DISABLE — always wins, applied last.
  for (const row of latestDivisionRows.values()) {
    if (row.source === 'manual' && row.enabled === false) divisions.delete(row.division);
  }
  for (const row of latestFeatureRows.values()) {
    if (row.source === 'manual' && row.enabled === false) features.delete(row.feature);
  }

  return {
    divisions: [...divisions].filter(d => DIVISION_VALUES.includes(d)),
    features: [...features],
    migrationReviewRequired: false,
  };
}

/**
 * Legacy company path — NEVER `company.divs || [SOLAR, MEP, HVAC]`. A legacy company with no
 * Subscription/DivisionEntitlement rows at all gets zero divisions and a review flag, not a
 * default full grant. `company.divs[]` is read here ONLY to decide whether review is needed,
 * never as the grant itself.
 */
function computeLegacyFallback({ companyDivsField }) {
  const isValid = Array.isArray(companyDivsField) && companyDivsField.length > 0;
  return {
    divisions: [],
    features: [],
    migrationReviewRequired: true,
    note: isValid
      ? 'Legacy company.divs present but not auto-granted — requires explicit Subscription/DivisionEntitlement migration review'
      : 'Legacy company.divs missing or invalid — no division grant, review required',
  };
}

function assertValidSource(source) {
  if (!ENTITLEMENT_SOURCES.includes(source)) {
    throw new Error(`[v3/entitlementService] Invalid entitlement source "${source}" — must be one of ${ENTITLEMENT_SOURCES.join(', ')}`);
  }
}

module.exports = { computeEffectiveEntitlements, computeLegacyFallback, assertValidSource };
