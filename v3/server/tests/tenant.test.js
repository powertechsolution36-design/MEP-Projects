// Unit test for enforceTenantScope() — STEP 6 hard rule: a client-supplied company id must never
// override the authenticated scope. Mocks models/Company so this file never needs a live DB
// connection (loadEntitlements/requireEntitlement, defined in the same module, are exercised
// separately in app.test.js's integration-style checks).
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));

const { enforceTenantScope } = require('../src/middleware/tenant');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('enforceTenantScope', () => {
  test('401 when unauthenticated', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();
    enforceTenantScope(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('strips a client-supplied companyId from body/query/params and uses the authenticated company instead', () => {
    const req = {
      user: { role: 'project_manager', co: 'real-company' },
      body: { companyId: 'attacker-company', co: 'attacker-company', title: 'Quotation A' },
      query: { companyId: 'attacker-company' },
      params: { companyId: 'attacker-company' },
    };
    const res = mockRes();
    const next = jest.fn();
    enforceTenantScope(req, res, next);
    expect(req.body.companyId).toBeUndefined();
    expect(req.body.co).toBeUndefined();
    expect(req.query.companyId).toBeUndefined();
    expect(req.params.companyId).toBeUndefined();
    expect(req.tenantCompanyId).toBe('real-company');
    expect(req.body.title).toBe('Quotation A'); // unrelated fields survive
    expect(next).toHaveBeenCalled();
  });

  test('a normal (non-super) user can never set tenantCompanyId via targetCompanyId either', () => {
    const req = { user: { role: 'project_manager', co: 'real-company' }, body: {}, query: { targetCompanyId: 'other-co' }, params: {} };
    const res = mockRes();
    const next = jest.fn();
    enforceTenantScope(req, res, next);
    expect(req.tenantCompanyId).toBe('real-company');
  });

  test('super with no explicit targetCompanyId gets null tenant scope, not an implicit default', () => {
    const req = { user: { role: 'super' }, body: {}, query: {}, params: {} };
    const res = mockRes();
    const next = jest.fn();
    enforceTenantScope(req, res, next);
    expect(req.tenantCompanyId).toBeNull();
  });
});
