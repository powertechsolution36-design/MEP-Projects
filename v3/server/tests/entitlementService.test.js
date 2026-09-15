// Unit tests for computeEffectiveEntitlements() — DOCUMENT_AUTHORITY.md's frozen precedence:
//   EXPLICIT MANUAL DISABLE > EXPLICIT MANUAL ENABLE > ADD-ON GRANT > SUBSCRIPTION PURCHASE > PLAN DEFAULT
const { computeEffectiveEntitlements, computeLegacyFallback } = require('../src/services/entitlementService');

describe('computeEffectiveEntitlements — worked examples from DOCUMENT_AUTHORITY.md', () => {
  test('Ex 1 — Plan HVAC + Add-on HVAC + Manual disabled -> disabled (manual wins)', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: ['HVAC'] },
      subscriptions: [{ active: true, purchasedDivisions: ['HVAC'] }],
      addOns: [{ active: true, grantsDivisions: ['HVAC'] }],
      divisionEntitlements: [{ division: 'HVAC', enabled: false, source: 'manual', setAt: '2026-01-02' }],
    });
    expect(result.divisions).not.toContain('HVAC');
  });

  test('Ex 2 — Plan MEP + Add-on HVAC + no manual -> MEP + HVAC', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: ['MEP'] },
      subscriptions: [{ active: true, purchasedDivisions: ['MEP'] }],
      addOns: [{ active: true, grantsDivisions: ['HVAC'] }],
    });
    expect(result.divisions.sort()).toEqual(['HVAC', 'MEP']);
  });

  test('Ex 3 — Plan Solar + MEP + Manual disable Solar -> MEP only', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: ['SOLAR', 'MEP'] },
      subscriptions: [{ active: true, purchasedDivisions: ['SOLAR', 'MEP'] }],
      divisionEntitlements: [{ division: 'SOLAR', enabled: false, source: 'manual', setAt: '2026-01-01' }],
    });
    expect(result.divisions).toEqual(['MEP']);
  });

  test('manual enable adds a division the subscription did not purchase', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: [] },
      subscriptions: [{ active: true, purchasedDivisions: [] }],
      divisionEntitlements: [{ division: 'HVAC', enabled: true, source: 'manual', setAt: '2026-01-01' }],
    });
    expect(result.divisions).toEqual(['HVAC']);
  });

  test('the latest manual row wins over an older one for the same division', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: [] },
      subscriptions: [],
      divisionEntitlements: [
        { division: 'MEP', enabled: true, source: 'manual', setAt: '2026-01-01' },
        { division: 'MEP', enabled: false, source: 'manual', setAt: '2026-02-01' },
      ],
    });
    expect(result.divisions).not.toContain('MEP');
  });

  test('never invents a division not in DIVISION_VALUES', () => {
    const result = computeEffectiveEntitlements({
      plan: { defaultDivisions: ['NOT_A_REAL_DIVISION'] },
      subscriptions: [{ active: true, purchasedDivisions: ['NOT_A_REAL_DIVISION'] }],
    });
    expect(result.divisions).toEqual([]);
  });
});

describe('computeLegacyFallback — Ex 4/5: never auto-grant, always review', () => {
  test('Ex 5 — missing/invalid company.divs -> no grant, review required', () => {
    const result = computeLegacyFallback({ companyDivsField: undefined });
    expect(result.divisions).toEqual([]);
    expect(result.migrationReviewRequired).toBe(true);
  });

  test('Ex 4 — company.divs=[MEP] present is still NOT auto-granted (never company.divs || [SOLAR,MEP,HVAC])', () => {
    const result = computeLegacyFallback({ companyDivsField: ['MEP'] });
    expect(result.divisions).toEqual([]);
    expect(result.migrationReviewRequired).toBe(true);
  });
});
