// Legacy migration tests — PLAN_ENTITLEMENTS.md §11 "safe rule": missing/invalid legacy
// company.divs[] never silently grants anything; only migrationReviewRequired. Exercised at both the
// Phase 1 foundation level (services/entitlementService.js, unchanged) and the Phase 3 authoritative
// resolver (services/commercialEntitlementService.js / entitlementResolutionService.js), since a
// legacy company with no Subscription row at all is exactly the "no sub" case §7's formula defines.
const { computeLegacyFallback } = require('../src/services/entitlementService');
const { resolveEffectiveEntitlements } = require('../src/services/commercialEntitlementService');

describe('Phase 1 foundation — computeLegacyFallback (unchanged, still passing)', () => {
  test('legacy divs present and valid -> still requires review, never auto-granted', () => {
    const result = computeLegacyFallback({ companyDivsField: ['SOLAR', 'MEP'] });
    expect(result.migrationReviewRequired).toBe(true);
    expect(result.divisions).toEqual([]);
  });

  test('legacy divs missing -> review required, no grant', () => {
    const result = computeLegacyFallback({ companyDivsField: undefined });
    expect(result.migrationReviewRequired).toBe(true);
    expect(result.divisions).toEqual([]);
  });

  test('legacy divs invalid (empty array) -> review required, no grant', () => {
    const result = computeLegacyFallback({ companyDivsField: [] });
    expect(result.migrationReviewRequired).toBe(true);
    expect(result.divisions).toEqual([]);
  });

  test('never uses `company.divs || [SOLAR, MEP, HVAC]` as a fallback grant', () => {
    const result = computeLegacyFallback({ companyDivsField: null });
    expect(result.divisions).not.toEqual(['SOLAR', 'MEP', 'HVAC']);
    expect(result.divisions).toEqual([]);
  });
});

describe('Phase 3 authoritative resolver — no Subscription at all (legacy pre-migration state)', () => {
  test('a company with no active/trial Subscription row -> migration_review_required, zero grant', () => {
    const result = resolveEffectiveEntitlements({ subscription: null });
    expect(result.status).toBe('migration_review_required');
    expect(result.divisions).toEqual([]);
    expect(result.features).toEqual({});
    expect(result.limits).toEqual({});
  });

  test('once migrated via a LEGACY_UNLIMITED Subscription (source: migration), the company retains EXACTLY its verified pre-V3 divisions — no auto-expansion', () => {
    // PLAN_ENTITLEMENTS.md §11: "create Subscription { plan: LEGACY_UNLIMITED, planSnapshot,
    // source: 'migration', purchasedDivisions: company.divs }" + a DivisionEntitlement per division,
    // source: 'migration' — migration rows are informational only in the formula (step 5), so the
    // actual grant here comes from the Subscription's own purchasedDivisions/planSnapshot layer
    // (step 1), matching ACCESS_MATRIX.md's "exactly its verified pre-V3 division access".
    const subscription = {
      _id: 'sub-legacy', co: 'co-legacy', status: 'active', source: 'migration',
      planSnapshot: { code: 'LEGACY_UNLIMITED', availableDivisions: ['SOLAR', 'MEP', 'HVAC'], defaultFeatures: {}, defaultLimits: {} },
      purchasedDivisions: ['SOLAR', 'MEP'], // this company was only ever entitled to these two, pre-V3
      addOns: [],
    };
    const divisionEntitlements = [
      { division: 'SOLAR', enabled: true, source: 'migration', setAt: '2026-01-01' },
      { division: 'MEP', enabled: true, source: 'migration', setAt: '2026-01-01' },
    ];
    const result = resolveEffectiveEntitlements({ subscription, divisionEntitlements });
    expect(result.divisions.sort()).toEqual(['MEP', 'SOLAR']);
    expect(result.divisions).not.toContain('HVAC'); // never auto-expanded to all three
    expect(result.status).toBe('ok');
  });

  test('migration rows alone (no corresponding Subscription.purchasedDivisions) never grant a division — informational only', () => {
    const subscription = {
      _id: 'sub-1', co: 'co-a', status: 'active',
      planSnapshot: { code: 'SOME_PLAN', availableDivisions: ['HVAC'], defaultFeatures: {}, defaultLimits: {} },
      purchasedDivisions: [], // company purchased nothing
      addOns: [],
    };
    const divisionEntitlements = [{ division: 'HVAC', enabled: true, source: 'migration', setAt: '2026-01-01' }];
    const result = resolveEffectiveEntitlements({ subscription, divisionEntitlements });
    expect(result.divisions).not.toContain('HVAC');
  });
});
