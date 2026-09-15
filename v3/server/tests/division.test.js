// Tests for checkDivision() (src/middleware/division.js).
const { checkDivision } = require('../src/middleware/division');

function user(overrides = {}) {
  return { role: 'engineer', designation: 'engineer', division: 'SOLAR', ...overrides };
}

describe('checkDivision', () => {
  test('super bypasses division scope entirely', () => {
    expect(checkDivision({ user: { role: 'super' }, targetDivision: 'MEP' }).allowed).toBe(true);
  });

  test('company_admin bypasses division scope (company-wide, not division-scoped)', () => {
    expect(checkDivision({ user: user({ role: 'admin', designation: 'company_admin', division: null }), targetDivision: 'HVAC' }).allowed).toBe(true);
  });

  test('matching division -> allowed', () => {
    expect(checkDivision({ user: user({ division: 'MEP' }), targetDivision: 'MEP' }).allowed).toBe(true);
  });

  test('cross-division (SOLAR user on MEP resource) -> 403 denied', () => {
    const d = checkDivision({ user: user({ division: 'SOLAR' }), targetDivision: 'MEP' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/cross-division/i);
  });

  test('MEP and HVAC are never merged/interchangeable', () => {
    expect(checkDivision({ user: user({ division: 'MEP' }), targetDivision: 'HVAC' }).allowed).toBe(false);
    expect(checkDivision({ user: user({ division: 'HVAC' }), targetDivision: 'MEP' }).allowed).toBe(false);
  });

  test('unknown division value -> denied, never allowed by accident', () => {
    const d = checkDivision({ user: user({ division: 'SOLAR' }), targetDivision: 'NOT_A_DIVISION' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/unknown division/i);
  });

  test('user with no division assigned -> denied', () => {
    const d = checkDivision({ user: user({ division: null }), targetDivision: 'SOLAR' });
    expect(d.allowed).toBe(false);
  });

  test('company not entitled to the division -> denied even if user.division matches', () => {
    const d = checkDivision({
      user: user({ division: 'SOLAR' }),
      targetDivision: 'SOLAR',
      entitlements: { divisions: ['MEP', 'HVAC'], enforceEntitlements: true },
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/not entitled/i);
  });

  test('entitlements enforceEntitlements:false -> entitlement gate skipped (legacy log-only mode)', () => {
    const d = checkDivision({
      user: user({ division: 'SOLAR' }),
      targetDivision: 'SOLAR',
      entitlements: { divisions: [], enforceEntitlements: false },
    });
    expect(d.allowed).toBe(true);
  });

  test('entitlements.divisions === "*" -> always entitled', () => {
    const d = checkDivision({
      user: user({ division: 'SOLAR' }),
      targetDivision: 'SOLAR',
      entitlements: { divisions: '*', enforceEntitlements: true },
    });
    expect(d.allowed).toBe(true);
  });

  test('no user -> 401-style denial', () => {
    expect(checkDivision({ user: null, targetDivision: 'SOLAR' }).allowed).toBe(false);
  });

  test('no target division -> denied (misconfiguration, never silently allowed)', () => {
    expect(checkDivision({ user: user(), targetDivision: null }).allowed).toBe(false);
  });
});
