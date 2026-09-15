// Unit tests for checkOwnership() — the pure decision function behind requireOwnership()
// (src/middleware/ownership.js). Covers the STEP 17 minimum test list and the ACCESS_MATRIX.md
// §13.4 acceptance tests, at the pure-function level (no Express/Mongo needed).
const { checkOwnership } = require('../src/middleware/ownership');

const CO_A = 'company-a';
const CO_B = 'company-b';
const USER_A = 'user-a';
const USER_B = 'user-b';
const MANAGER = 'manager-1';
const OVERRIDE_CODE = 'quotation.override';

function record(overrides = {}) {
  return { co: CO_A, createdByUserId: USER_A, status: 'DRAFT', ...overrides };
}
function user(id, overrides = {}) {
  return { id, co: CO_A, role: 'engineer', permissions: [], ...overrides };
}

describe('Ownership — User B (same role) editing User A\'s record', () => {
  test('denied — no ownership, no override', () => {
    const decision = checkOwnership({ record: record(), user: user(USER_B), action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('DELETE by User B is also denied', () => {
    const decision = checkOwnership({ record: record(), user: user(USER_B), action: 'delete', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });
});

describe('Ownership — Manager EDIT User A record', () => {
  test('denied without the explicit override permission (STEP 8: no generic Manager/Admin bypass)', () => {
    const mgr = user(MANAGER, { role: 'company_admin', permissions: [] });
    const decision = checkOwnership({ record: record(), user: mgr, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('Admin EDIT User A record — denied without override, same as Manager', () => {
    const admin = user('admin-1', { role: 'company_admin', permissions: [] });
    const decision = checkOwnership({ record: record(), user: admin, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('WITH an explicitly granted override permission — allowed, but flagged as requiring a RecordCorrection (never silent)', () => {
    const mgr = user(MANAGER, { role: 'company_admin', permissions: [OVERRIDE_CODE] });
    const decision = checkOwnership({ record: record(), user: mgr, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresCorrection).toBe(true);
  });
});

describe('Ownership — creator on own DRAFT', () => {
  test('allowed, no correction required', () => {
    const decision = checkOwnership({ record: record({ status: 'DRAFT' }), user: user(USER_A), action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresCorrection).toBe(false);
  });
});

describe('State — LOCKED / FINALIZED', () => {
  test('LOCKED record blocks a normal creator edit', () => {
    const decision = checkOwnership({ record: record({ status: 'LOCKED' }), user: user(USER_A), action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('FINALIZED record denies delete even for the creator', () => {
    const decision = checkOwnership({ record: record({ status: 'FINALIZED' }), user: user(USER_A), action: 'delete', overridePermissionCode: 'payment.override' });
    expect(decision.allowed).toBe(false);
  });
});

describe('Division — MEP-only scope vs. an HVAC-restricted record', () => {
  // Division scoping itself lives in scopeFilterV3 (authorization.test.js) — this test only proves
  // that ownership does not accidentally grant cross-division access on its own; the record here
  // simulates one already excluded by scopeFilterV3's query (so it would never reach requireOwnership
  // in the real chain), confirming ownership doesn't independently re-open that door.
  test('a division mismatch alone is not something checkOwnership overrides — company match is required, division is scopeFilterV3\'s job', () => {
    const mepManager = user('mep-mgr', { role: 'x', designation: 'mep_manager', division: 'MEP', permissions: [] });
    const hvacRecord = record({ createdByUserId: 'someone-else' });
    const decision = checkOwnership({ record: hvacRecord, user: mepManager, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false); // not the owner, no override — denied regardless of division
  });
});

describe('Cross-company', () => {
  test('a Company B user can never touch a Company A record, even with permissions=[\'*\']', () => {
    const outsider = user(USER_B, { co: CO_B, permissions: ['*'] });
    const decision = checkOwnership({ record: record(), user: outsider, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cross-company/i);
  });
});

describe('Super Admin — STEP 14: not a blanket business-record editor', () => {
  test('super WITHOUT an explicit Support Op is denied, exactly like anyone else with no ownership', () => {
    const superUser = user('super-1', { role: 'super' });
    const decision = checkOwnership({ record: record(), user: superUser, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('super WITH supportOp but no reason is still denied', () => {
    const superUser = user('super-1', { role: 'super' });
    const decision = checkOwnership({ record: record(), user: superUser, action: 'edit', overridePermissionCode: OVERRIDE_CODE, supportOp: true, supportReason: '  ' });
    expect(decision.allowed).toBe(false);
  });

  test('super WITH supportOp + reason is allowed, but always flagged as requiring correction (never silent)', () => {
    const superUser = user('super-1', { role: 'super' });
    const decision = checkOwnership({
      record: record(),
      user: superUser,
      action: 'edit',
      overridePermissionCode: OVERRIDE_CODE,
      supportOp: true,
      supportReason: 'Customer-reported data error, verified with company admin',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresCorrection).toBe(true);
    expect(decision.supportOp).toBe(true);
  });
});

describe('Direct API probing', () => {
  test('a missing record is denied, not a crash', () => {
    const decision = checkOwnership({ record: null, user: user(USER_A), action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });

  test('a missing user is denied', () => {
    const decision = checkOwnership({ record: record(), user: null, action: 'edit', overridePermissionCode: OVERRIDE_CODE });
    expect(decision.allowed).toBe(false);
  });
});
