// Tests for services/authorizationEngine.js — can()/authorize()/requirePermission(), the centralized
// composition of permission/tenant/entitlement/division/department/project/package/ownership/state.
const { can, authorize, requirePermission } = require('../src/services/authorizationEngine');

function superUser() { return { _id: 'u-super', co: 'co-a', role: 'super' }; }
function engineer(overrides = {}) {
  return { _id: 'u-eng', co: 'co-a', role: 'engineer', designation: 'engineer', division: 'SOLAR', permissions: [], ...overrides };
}
function companyAdmin(overrides = {}) {
  return { _id: 'u-admin', co: 'co-a', role: 'admin', designation: 'company_admin', permissions: ['*'], ...overrides };
}

describe('authorize() — permission layer', () => {
  test('missing permission -> denied', () => {
    const d = authorize(engineer(), 'APPROVE', {});
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/missing permission/i);
  });

  test('super has every permission implicitly', () => {
    expect(authorize(superUser(), 'APPROVE', {}).allowed).toBe(true);
  });

  test('no permission requested -> permission layer skipped, other layers still apply', () => {
    expect(authorize(engineer(), null, {}).allowed).toBe(true);
  });
});

describe('authorize() — tenant layer', () => {
  test('cross-company record access denied for a non-super user', () => {
    const d = authorize(engineer(), null, { record: { co: 'co-b', createdByUserId: 'u-eng', status: 'DRAFT' } });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/cross-company/i);
  });

  test('super may cross company scope at the tenant layer (ownership Support-Op still gates the actual edit separately)', () => {
    const d = authorize(superUser(), null, { record: { co: 'co-b', createdByUserId: 'x', status: 'DRAFT' } });
    expect(d.allowed).toBe(true);
  });
});

describe('authorize() — division/department/project/package composition', () => {
  test('division mismatch denies before ownership is even evaluated', () => {
    const d = authorize(engineer({ division: 'SOLAR' }), null, { division: 'MEP' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/cross-division/i);
  });

  test('department mismatch denies', () => {
    const d = authorize(engineer({ department: 'SERVICE' }), null, { department: 'FINANCE' });
    expect(d.allowed).toBe(false);
  });

  test('project scope denies an unassigned engineer', () => {
    const d = authorize(engineer(), null, { project: { co: 'co-a', division: 'SOLAR', assignedUserId: 'someone-else', accessList: [] } });
    expect(d.allowed).toBe(false);
  });

  test('all layers passing together -> allowed', () => {
    const user = engineer({ division: 'SOLAR', department: 'SOLAR' });
    const d = authorize(user, null, {
      division: 'SOLAR',
      department: 'SOLAR',
      project: { co: 'co-a', division: 'SOLAR', assignedUserId: 'u-eng', accessList: [] },
    });
    expect(d.allowed).toBe(true);
  });
});

describe('authorize() — ownership + record state composition', () => {
  test('creator editing own DRAFT record -> allowed', () => {
    const user = engineer();
    const record = { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' };
    expect(authorize(user, null, { record, action: 'edit' }).allowed).toBe(true);
  });

  test('another engineer (not owner, no override) editing someone else\'s record -> 403', () => {
    const user = engineer({ _id: 'u-eng-2' });
    const record = { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' };
    expect(authorize(user, null, { record, action: 'edit', overridePermissionCode: 'x.override' }).allowed).toBe(false);
  });

  test('company_admin editing another user\'s record without an explicit override permission -> 403 (no generic bypass)', () => {
    const admin = companyAdmin({ permissions: [] });
    const record = { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' };
    const d = authorize(admin, null, { record, action: 'edit', overridePermissionCode: 'x.override' });
    expect(d.allowed).toBe(false);
  });

  test('creator editing a FINALIZED (locked) record -> 403, ownership never bypasses record-state locking', () => {
    const user = engineer();
    const record = { co: 'co-a', createdByUserId: 'u-eng', status: 'FINALIZED' };
    const d = authorize(user, null, { record, action: 'edit' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/locked/i);
  });

  test('locked-state check is skipped when checkState:false is explicitly passed (e.g. a read-only view)', () => {
    const user = { _id: 'someone-else', co: 'co-a', role: 'engineer' };
    const record = { co: 'co-a', createdByUserId: 'other-user', status: 'FINALIZED' };
    // No `action` -> ownership layer is skipped entirely; only tenant + explicit checkState:false matter.
    const d = authorize(user, null, { record, checkState: false });
    expect(d.allowed).toBe(true);
  });
});

describe('can() — boolean convenience wrapper', () => {
  test('returns true/false matching authorize().allowed', () => {
    expect(can(engineer(), 'APPROVE', {})).toBe(false);
    expect(can(superUser(), 'APPROVE', {})).toBe(true);
  });
});

describe('requirePermission() middleware', () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  test('403 when the composed decision denies', async () => {
    const req = { user: engineer(), entitlements: {} };
    const res = mockRes();
    const next = jest.fn();
    const mw = requirePermission('APPROVE');
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('next() called and req.authorizationDecision set when allowed', async () => {
    const req = { user: superUser() };
    const res = mockRes();
    const next = jest.fn();
    const mw = requirePermission('APPROVE', () => ({}));
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.authorizationDecision.allowed).toBe(true);
  });
});
