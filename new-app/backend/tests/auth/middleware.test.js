'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware } = require('../../src/middleware/authMiddleware');
const { requireRole } = require('../../src/middleware/roleMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../../src/middleware/tenantGuard');
const authService = require('../../src/auth/authService');
const { hashPassword } = require('../../src/auth/passwordHasher');
const { createInMemoryStore } = require('./fakes');

const CONFIG = { authTokenSecret: 'test-secret', authTokenExpiry: '15m' };

function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function seedAndLogin() {
  const passwordHash = await hashPassword('pw');
  const store = createInMemoryStore(
    [{ id: 'u1', companyId: 'company_a', name: 'Alice', username: 'alice', role: 'admin', passwordHash, active: true }],
    [{ id: 'company_a', name: 'Company A', divisions: ['HVAC'] }]
  );
  const deps = { userRepo: store.userRepo, sessionRepo: store.sessionRepo, config: CONFIG };
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'pw' }, {
    ...deps,
    passwordHasher: { verifyPassword: require('../../src/auth/passwordHasher').verifyPassword },
  });
  return { store, deps, token: result.token };
}

test('authMiddleware rejects a request with no Authorization header', async () => {
  const { deps } = await seedAndLogin();
  const middleware = createAuthMiddleware(deps);
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('authMiddleware attaches req.auth for a valid token', async () => {
  const { deps, token } = await seedAndLogin();
  const middleware = createAuthMiddleware(deps);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.auth.role, 'admin');
  assert.equal(req.auth.companyId, 'company_a');
});

test('authMiddleware rejects a malformed/garbage token with a generic 401', async () => {
  const { deps } = await seedAndLogin();
  const middleware = createAuthMiddleware(deps);
  const req = { headers: { authorization: 'Bearer not-a-real-token' } };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireRole allows a matching role and blocks a non-matching one', () => {
  const mw = requireRole('admin', 'finance');
  const res1 = mockRes();
  let called1 = false;
  mw({ auth: { role: 'admin' } }, res1, () => { called1 = true; });
  assert.equal(called1, true);

  const res2 = mockRes();
  let called2 = false;
  mw({ auth: { role: 'engineer' } }, res2, () => { called2 = true; });
  assert.equal(called2, false);
  assert.equal(res2.statusCode, 403);
});

test('requireRole rejects when unauthenticated (no req.auth)', () => {
  const mw = requireRole('admin');
  const res = mockRes();
  let called = false;
  mw({}, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('requireCompanyContext passes for a non-super user with a companyId, and fails without one', () => {
  const res1 = mockRes();
  let called1 = false;
  requireCompanyContext({ auth: { role: 'admin', companyId: 'company_a' } }, res1, () => { called1 = true; });
  assert.equal(called1, true);

  const res2 = mockRes();
  let called2 = false;
  requireCompanyContext({ auth: { role: 'admin', companyId: null } }, res2, () => { called2 = true; });
  assert.equal(called2, false);
  assert.equal(res2.statusCode, 403);
});

test('cross-company attack: a Company A user cannot operate as Company B by changing request companyId', () => {
  const req = {
    auth: { role: 'admin', companyId: 'company_a' },
    body: { companyId: 'company_b', someField: 'x' },
  };
  const res = mockRes();
  let called = false;
  rejectClientSuppliedCompanyId(req, res, () => { called = true; });
  assert.equal(called, false, 'the request must be blocked, not passed through');
  assert.equal(res.statusCode, 403);
});

test('a request that does not try to override companyId (or matches its own) passes through', () => {
  const req1 = { auth: { role: 'admin', companyId: 'company_a' }, body: {} };
  const res1 = mockRes();
  let called1 = false;
  rejectClientSuppliedCompanyId(req1, res1, () => { called1 = true; });
  assert.equal(called1, true);

  const req2 = { auth: { role: 'admin', companyId: 'company_a' }, body: { companyId: 'company_a' } };
  const res2 = mockRes();
  let called2 = false;
  rejectClientSuppliedCompanyId(req2, res2, () => { called2 = true; });
  assert.equal(called2, true);
});

test('super is exempt from the client-supplied-companyId guard (future cross-company Super Admin ops)', () => {
  const req = { auth: { role: 'super', companyId: null }, body: { companyId: 'company_b' } };
  const res = mockRes();
  let called = false;
  rejectClientSuppliedCompanyId(req, res, () => { called = true; });
  assert.equal(called, true);
});
