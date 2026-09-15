// Unit tests for scopeFilterV3() and requirePermission() (src/middleware/authorization.js).
const { scopeFilterV3, requirePermission } = require('../src/middleware/authorization');
const { PERMISSIONS } = require('../src/config/constants');

describe('scopeFilterV3', () => {
  test('super admin gets no company filter', () => {
    const f = scopeFilterV3({ role: 'super', _id: 'u1' }, 'projects');
    expect(f.co).toBeUndefined();
  });

  test('a normal user is always scoped to their own company', () => {
    const f = scopeFilterV3({ role: 'project_manager', co: 'co-1', _id: 'u1' }, 'projects');
    expect(f.co).toBe('co-1');
  });

  test('an MEP manager is scoped to MEP — never sees HVAC by this filter', () => {
    const f = scopeFilterV3({ role: 'x', co: 'co-1', designation: 'mep_manager', division: 'MEP', _id: 'u1' }, 'projects');
    expect(f.division).toBe('MEP');
    expect(f.division).not.toBe('HVAC');
  });

  test('an engineer with no projectAccess is scoped to assignedTo=self', () => {
    const f = scopeFilterV3({ role: 'x', co: 'co-1', designation: 'engineer', _id: 'u1' }, 'checklistItems');
    expect(f.assignedTo).toBe('u1');
  });

  test('an engineer WITH projectAccess is scoped by project list instead of assignedTo', () => {
    const f = scopeFilterV3({ role: 'x', co: 'co-1', designation: 'engineer', projectAccess: ['p1', 'p2'], _id: 'u1' }, 'checklistItems');
    expect(f._project_in).toEqual(['p1', 'p2']);
    expect(f.assignedTo).toBeUndefined();
  });

  test('an inventory manager gets a division-in filter including COMMON', () => {
    const f = scopeFilterV3({ role: 'x', co: 'co-1', designation: 'inventory_manager', _id: 'u1', _entitledDivisions: ['MEP'] }, 'inventory');
    expect(f._division_in).toEqual(['MEP', 'COMMON']);
  });
});

describe('requirePermission middleware', () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  test('401 when no user on request', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();
    requirePermission(PERMISSIONS.EDIT)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('super always passes', () => {
    const req = { user: { role: 'super' } };
    const res = mockRes();
    const next = jest.fn();
    requirePermission(PERMISSIONS.DELETE)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('403 when permission missing', () => {
    const req = { user: { role: 'engineer', permissions: ['other.perm'] } };
    const res = mockRes();
    const next = jest.fn();
    requirePermission(PERMISSIONS.EDIT)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('passes when permission present', () => {
    const req = { user: { role: 'engineer', permissions: [PERMISSIONS.EDIT] } };
    const res = mockRes();
    const next = jest.fn();
    requirePermission(PERMISSIONS.EDIT)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('wildcard permission passes anything', () => {
    const req = { user: { role: 'engineer', permissions: ['*'] } };
    const res = mockRes();
    const next = jest.fn();
    requirePermission('anything.at.all')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
