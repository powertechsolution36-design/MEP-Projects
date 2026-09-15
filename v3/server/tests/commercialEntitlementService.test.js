// Tests for services/commercialEntitlementService.js — PLAN_ENTITLEMENTS.md §4/§5/§7 formula,
// verbatim. Pure functions only — no DB needed.
const { resolveEffectiveEntitlements, validateAddOnAttach, checkLimit, mergeAddLimit } = require('../src/services/commercialEntitlementService');

function snapshot(overrides = {}) {
  return {
    code: 'SOLAR_STARTER', version: 1, availableDivisions: ['SOLAR'], forbiddenDivisions: [],
    includedModules: [], defaultFeatures: { 'auth.login': true, 'solar.projects': true },
    defaultLimits: { users: 5, projects: 10, storageGB: 10, apiCallsPerHour: 1000 },
    ...overrides,
  };
}

function subscription(overrides = {}) {
  return {
    _id: 'sub-1', co: 'co-a', status: 'active', planSnapshot: snapshot(),
    purchasedDivisions: ['SOLAR'], addOns: [], ...overrides,
  };
}

describe('resolveEffectiveEntitlements — no subscription (legacy/migration review)', () => {
  test('null subscription -> migration_review_required, zero grant', () => {
    const result = resolveEffectiveEntitlements({ subscription: null });
    expect(result.status).toBe('migration_review_required');
    expect(result.divisions).toEqual([]);
    expect(result.features).toEqual({});
  });
});

describe('resolveEffectiveEntitlements — base plan snapshot', () => {
  test('divisions = availableDivisions ∩ purchasedDivisions', () => {
    const sub = subscription({ planSnapshot: snapshot({ availableDivisions: ['SOLAR', 'MEP'] }), purchasedDivisions: ['SOLAR'] });
    const result = resolveEffectiveEntitlements({ subscription: sub });
    expect(result.divisions).toEqual(['SOLAR']);
  });

  test('a division in availableDivisions but NOT purchased is excluded', () => {
    const sub = subscription({ planSnapshot: snapshot({ availableDivisions: ['SOLAR', 'MEP', 'HVAC'] }), purchasedDivisions: ['SOLAR'] });
    const result = resolveEffectiveEntitlements({ subscription: sub });
    expect(result.divisions).not.toContain('MEP');
    expect(result.divisions).not.toContain('HVAC');
  });

  test('default features and limits carry through from the snapshot', () => {
    const result = resolveEffectiveEntitlements({ subscription: subscription() });
    expect(result.features['auth.login']).toBe(true);
    expect(result.limits.users).toBe(5);
  });
});

describe('resolveEffectiveEntitlements — add-on layering', () => {
  test('an active add-on grants an additional division', () => {
    const sub = subscription({ addOns: [{ addOnCode: 'DIVISION_MEP', active: true }] });
    const catalog = { DIVISION_MEP: { code: 'DIVISION_MEP', divisionsGranted: ['MEP'], featuresGranted: {}, limits: {} } };
    const result = resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: catalog });
    expect(result.divisions.sort()).toEqual(['MEP', 'SOLAR']);
    expect(result.computedFrom.activeAddOnCodes).toEqual(['DIVISION_MEP']);
  });

  test('an INACTIVE add-on assignment grants nothing', () => {
    const sub = subscription({ addOns: [{ addOnCode: 'DIVISION_MEP', active: false }] });
    const catalog = { DIVISION_MEP: { code: 'DIVISION_MEP', divisionsGranted: ['MEP'] } };
    const result = resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: catalog });
    expect(result.divisions).not.toContain('MEP');
  });

  test('an add-on grants a feature and adds to a limit', () => {
    const sub = subscription({ addOns: [{ addOnCode: 'extra_users_pack_10', active: true }] });
    const catalog = { extra_users_pack_10: { code: 'extra_users_pack_10', featuresGranted: { extra_users_pack_10: true }, limits: { users: 10 } } };
    const result = resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: catalog });
    expect(result.features.extra_users_pack_10).toBe(true);
    expect(result.limits.users).toBe(15); // 5 (plan) + 10 (addon) — additive, never a plain override
  });

  test('an unknown add-on code (removed from catalog) is ignored, never crashes', () => {
    const sub = subscription({ addOns: [{ addOnCode: 'GHOST_ADDON', active: true }] });
    expect(() => resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: {} })).not.toThrow();
  });
});

describe('resolveEffectiveEntitlements — precedence (PLAN_ENTITLEMENTS.md §4 conflict examples)', () => {
  test('Example A — Plan enabled + Add-on enabled + Manual disabled -> disabled (manual wins)', () => {
    const sub = subscription({
      planSnapshot: snapshot({ availableDivisions: ['SOLAR'] }),
      purchasedDivisions: ['SOLAR'],
      addOns: [{ addOnCode: 'DIVISION_HVAC', active: true }],
    });
    const catalog = { DIVISION_HVAC: { code: 'DIVISION_HVAC', divisionsGranted: ['HVAC'] } };
    const divisionEntitlements = [{ _id: 'de1', co: 'co-a', division: 'HVAC', enabled: false, source: 'manual', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: catalog, divisionEntitlements });
    expect(result.divisions).toEqual(['SOLAR']);
    expect(result.divisions).not.toContain('HVAC');
  });

  test('Example B — Plan enabled + Manual disabled (older) + Manual re-enabled (newer) -> enabled (most recent wins)', () => {
    const sub = subscription({ planSnapshot: snapshot({ availableDivisions: ['MEP', 'HVAC'] }), purchasedDivisions: ['MEP', 'HVAC'] });
    const divisionEntitlements = [
      { _id: 'de1', division: 'HVAC', enabled: false, source: 'manual', setAt: '2026-01-01T00:00:00Z' },
      { _id: 'de2', division: 'HVAC', enabled: true, source: 'manual', setAt: '2026-06-01T00:00:00Z' },
    ];
    const result = resolveEffectiveEntitlements({ subscription: sub, divisionEntitlements });
    expect(result.divisions.sort()).toEqual(['HVAC', 'MEP']);
  });

  test('manual disable > add-on grant, manual enable > plan default disabled, add-on > subscription/plan default alone', () => {
    // manual enable can grant access even when the plan snapshot never included the division at all.
    const sub = subscription({ planSnapshot: snapshot({ availableDivisions: [] }), purchasedDivisions: [] });
    const divisionEntitlements = [{ division: 'SOLAR', enabled: true, source: 'manual', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: sub, divisionEntitlements });
    expect(result.divisions).toEqual(['SOLAR']);
  });

  test('manual feature disable > add-on feature grant', () => {
    const sub = subscription({ addOns: [{ addOnCode: 'ai_estimator', active: true }] });
    const catalog = { ai_estimator: { code: 'ai_estimator', featuresGranted: { ai_estimator: true } } };
    const featureEntitlements = [{ feature: 'ai_estimator', enabled: false, source: 'manual', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: sub, activeAddOnCatalogByCode: catalog, featureEntitlements });
    expect(result.features.ai_estimator).toBe(false);
  });

  test('a manual feature row with a numeric limit overrides the boolean enabled value', () => {
    const featureEntitlements = [{ feature: 'storage_100gb', enabled: true, limit: 500, source: 'manual', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: subscription(), featureEntitlements });
    expect(result.features.storage_100gb).toBe(500);
  });

  test('migration-sourced rows are informational only — never re-grant a division', () => {
    const divisionEntitlements = [{ division: 'HVAC', enabled: true, source: 'migration', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: subscription(), divisionEntitlements });
    expect(result.divisions).not.toContain('HVAC'); // migration row alone never grants — only manual/addon/plan layers do
  });
});

describe('resolveEffectiveEntitlements — never invents a division outside DIVISION_VALUES', () => {
  test('a stray manual row for a bogus division is filtered out of the final result', () => {
    const divisionEntitlements = [{ division: 'NOT_A_REAL_DIVISION', enabled: true, source: 'manual', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription: subscription(), divisionEntitlements });
    expect(result.divisions).not.toContain('NOT_A_REAL_DIVISION');
  });
});

describe('validateAddOnAttach — §5', () => {
  test('universal add-on (empty compatiblePlans) is valid for any plan', () => {
    const addOn = { code: 'DIVISION_HVAC', active: true, compatiblePlans: [], divisionsGranted: ['HVAC'] };
    expect(validateAddOnAttach({ addOn, planSnapshot: snapshot() }).valid).toBe(true);
  });

  test('add-on restricted to specific plans rejects a non-matching plan', () => {
    const addOn = { code: 'DIVISION_HVAC', active: true, compatiblePlans: ['ENTERPRISE'], divisionsGranted: ['HVAC'] };
    const result = validateAddOnAttach({ addOn, planSnapshot: snapshot({ code: 'SOLAR_STARTER' }) });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not compatible/i);
  });

  test('plan.forbiddenDivisions rejects the add-on', () => {
    const addOn = { code: 'DIVISION_HVAC', active: true, compatiblePlans: [], divisionsGranted: ['HVAC'] };
    const result = validateAddOnAttach({ addOn, planSnapshot: snapshot({ forbiddenDivisions: ['HVAC'] }) });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/forbids/i);
  });

  test('a more-recent manual disable on the granted division rejects the add-on', () => {
    const addOn = { code: 'DIVISION_HVAC', active: true, compatiblePlans: [], divisionsGranted: ['HVAC'] };
    const recentManualDivisionEntitlements = [{ division: 'HVAC', enabled: false, source: 'manual', setAt: '2026-06-01' }];
    const result = validateAddOnAttach({ addOn, planSnapshot: snapshot(), recentManualDivisionEntitlements });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/manually disabled/i);
  });

  test('an inactive catalog add-on cannot be attached', () => {
    const addOn = { code: 'DIVISION_HVAC', active: false, compatiblePlans: [], divisionsGranted: ['HVAC'] };
    expect(validateAddOnAttach({ addOn, planSnapshot: snapshot() }).valid).toBe(false);
  });

  test('no plan snapshot (no active subscription) -> invalid', () => {
    const addOn = { code: 'DIVISION_HVAC', active: true, compatiblePlans: [], divisionsGranted: ['HVAC'] };
    expect(validateAddOnAttach({ addOn, planSnapshot: null }).valid).toBe(false);
  });
});

describe('checkLimit — unlimited / zero / finite quota', () => {
  test('unlimited sentinel -> always within limit, remaining null', () => {
    const r = checkLimit({ users: 'unlimited' }, 'users', 999999);
    expect(r.unlimited).toBe(true);
    expect(r.withinLimit).toBe(true);
    expect(r.remaining).toBeNull();
  });

  test('missing/null limit -> not entitled (never silently unlimited)', () => {
    const r = checkLimit({}, 'projects', 0);
    expect(r.withinLimit).toBe(false);
    expect(r.unlimited).toBe(false);
    expect(r.remaining).toBe(0);
  });

  test('finite quota -> within limit while usage is below it', () => {
    const r = checkLimit({ users: 5 }, 'users', 3);
    expect(r.withinLimit).toBe(true);
    expect(r.remaining).toBe(2);
  });

  test('finite quota -> not within limit once usage reaches the cap', () => {
    const r = checkLimit({ users: 5 }, 'users', 5);
    expect(r.withinLimit).toBe(false);
    expect(r.remaining).toBe(0);
  });

  test('feature enabled (boolean) is never confused with an unlimited quantity', () => {
    // A feature flag of `true` is not a limits entry at all — checkLimit on a non-existent limit
    // key must not treat a truthy feature flag as "unlimited".
    const r = checkLimit({ users: 5 }, 'someFeatureFlag', 0);
    expect(r.unlimited).toBe(false);
    expect(r.withinLimit).toBe(false);
  });
});

describe('mergeAddLimit', () => {
  test('unlimited beats any finite number in either position', () => {
    expect(mergeAddLimit('unlimited', 10)).toBe('unlimited');
    expect(mergeAddLimit(10, 'unlimited')).toBe('unlimited');
  });

  test('two finite numbers add', () => {
    expect(mergeAddLimit(5, 10)).toBe(15);
  });

  test('null base + finite addition treats null as 0', () => {
    expect(mergeAddLimit(null, 10)).toBe(10);
  });
});
