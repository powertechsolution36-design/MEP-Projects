// Phase 2 — cross-module protection + direct API-boundary tests, exercised through a REAL Express
// app wired with middleware/chain.js's buildProtectedRoute(), via supertest — proving these are
// enforced by the API itself, never merely by a UI button being hidden (same principle as
// tests/app.test.js's STEP 18 coverage).
//
// No concrete Payment/SalesOrder/Checklist/Inventory business modules exist yet (they are future
// feature-module work — V3_MIGRATION_MAP.md); this file demonstrates the REUSABLE engine
// (department/division/ownership/record-state scope, composed by middleware/chain.js) already
// enforces the requested cross-module boundaries using department scope as the module boundary —
// e.g. a Payment-shaped record is department:FINANCE, a Sales-Order-shaped record is
// department:SALES — exactly the reusable layer STEP 13 requires future modules to plug their real
// resources into without re-deriving this logic.
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const { buildProtectedRoute } = require('../src/middleware/chain');
const { errorHandler, notFound } = require('../src/middleware/errorHandler');
const { PERMISSIONS } = require('../src/config/constants');

// In-memory "records" standing in for the not-yet-built business modules — keyed by module name.
const RECORDS = {
  payment: { _id: 'pay-1', co: 'co-a', createdByUserId: 'u-finance', status: 'FINALIZED', department: 'FINANCE' },
  salesOrder: { _id: 'so-1', co: 'co-a', createdByUserId: 'u-sales', status: 'DRAFT', department: 'SALES' },
  checklist: { _id: 'chk-1', co: 'co-a', createdByUserId: 'u-finance', status: 'DRAFT', department: 'FINANCE' },
  projectRecordA: { _id: 'prec-a', co: 'co-a', createdByUserId: 'u-a', status: 'DRAFT' },
};

function buildApp() {
  const app = express();
  app.use(express.json());

  app.put('/records/:id', ...buildProtectedRoute({
    resource: 'record', permission: PERMISSIONS.EDIT,
    loadRecord: () => Promise.resolve(RECORDS.projectRecordA), checkState: true,
  }), (req, res) => res.json({ ok: true }));

  app.delete('/records/:id', ...buildProtectedRoute({
    resource: 'record', permission: PERMISSIONS.DELETE,
    loadRecord: () => Promise.resolve(RECORDS.projectRecordA), ownershipAction: 'delete', checkState: true,
  }), (req, res) => res.json({ ok: true }));

  // Cross-module: Engineer -> Payment (department FINANCE) = 403
  app.put('/payment', ...buildProtectedRoute({
    resource: 'payment', permission: PERMISSIONS.EDIT, department: () => 'FINANCE',
    loadRecord: () => Promise.resolve(RECORDS.payment), checkState: true,
  }), (req, res) => res.json({ ok: true }));

  // Cross-module: Inventory Manager -> Sales Order (department SALES) = 403
  app.put('/sales-order', ...buildProtectedRoute({
    resource: 'salesOrder', permission: PERMISSIONS.EDIT, department: () => 'SALES',
    loadRecord: () => Promise.resolve(RECORDS.salesOrder), checkState: false,
  }), (req, res) => res.json({ ok: true }));

  // Cross-module: Finance -> Checklist ownership = 403 (Finance dept matches, but not the owner)
  app.put('/checklist', ...buildProtectedRoute({
    resource: 'checklist', permission: PERMISSIONS.EDIT, department: () => 'FINANCE',
    loadRecord: () => Promise.resolve(RECORDS.checklist),
  }), (req, res) => res.json({ ok: true }));

  // Cross-module: (non-Finance) Checklist-side user -> Payment write = 403 (department mismatch)
  app.put('/payment-from-checklist', ...buildProtectedRoute({
    resource: 'payment', permission: PERMISSIONS.EDIT, department: () => 'FINANCE',
    loadRecord: () => Promise.resolve(RECORDS.payment), checkState: false,
  }), (req, res) => res.json({ ok: true }));

  // Division-scoped route for cross-division tests. loadRecord makes the requester the owner so
  // this route isolates the division check specifically, without the ownership layer also denying.
  app.put('/division-record', ...buildProtectedRoute({
    resource: 'divisionRecord', permission: PERMISSIONS.EDIT, division: () => 'SOLAR',
    loadRecord: (req) => Promise.resolve({ _id: 'dr-1', co: 'co-a', createdByUserId: req.user._id, status: 'DRAFT' }),
  }), (req, res) => res.json({ ok: true }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function tokenFor(userId) {
  return jwt.sign({ id: userId }, env.JWT_SECRET);
}

function mockUser(id, overrides) {
  User.findById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ _id: id, co: 'co-a', disabled: false, ...overrides }) }) });
}

function mockCompanyAllEntitled() {
  Company.findById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'co-a', entitlements: { modules: '*', divisions: '*', enforceEntitlements: true } }) });
}

describe('Phase 2 — direct API-boundary tests (User B editing/deleting User A\'s record)', () => {
  let app;
  beforeEach(() => { app = buildApp(); mockCompanyAllEntitled(); });
  afterEach(() => jest.clearAllMocks());

  test('User B PUT User A\'s record -> 403', async () => {
    mockUser('u-b', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/records/prec-a').set('Authorization', `Bearer ${tokenFor('u-b')}`).send({});
    expect(res.status).toBe(403);
  });

  test('User B DELETE User A\'s record -> 403', async () => {
    mockUser('u-b', { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/records/prec-a').set('Authorization', `Bearer ${tokenFor('u-b')}`).send({});
    expect(res.status).toBe(403);
  });

  test('User A (owner) PUT own record -> 200', async () => {
    mockUser('u-a', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/records/prec-a').set('Authorization', `Bearer ${tokenFor('u-a')}`).send({});
    expect(res.status).toBe(200);
  });

  test('a client-supplied companyId in the body never overrides the authenticated scope (STEP 6, exercised at the API boundary)', async () => {
    mockUser('u-a', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/records/prec-a').set('Authorization', `Bearer ${tokenFor('u-a')}`).send({ companyId: 'attacker-co', co: 'attacker-co' });
    expect(res.status).toBe(200); // still allowed as the real owner — proves the spoofed id was simply ignored, not honored
  });
});

describe('Phase 2 — cross-module protection (explicit STEP-required scenarios)', () => {
  let app;
  beforeEach(() => { app = buildApp(); mockCompanyAllEntitled(); });
  afterEach(() => jest.clearAllMocks());

  test('Engineer -> Payment (FINANCE dept) = 403', async () => {
    mockUser('u-eng', { role: 'engineer', designation: 'engineer', department: 'SOLAR', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/payment').set('Authorization', `Bearer ${tokenFor('u-eng')}`).send({});
    expect(res.status).toBe(403);
  });

  test('Sales -> a FINALIZED Payment = 403 (even a Finance-department user cannot edit a locked Payment)', async () => {
    mockUser('u-finance', { role: 'accounts', designation: 'executive', department: 'FINANCE', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/payment').set('Authorization', `Bearer ${tokenFor('u-finance')}`).send({});
    // Owner (u-finance created it) but FINALIZED -> locked, edit denied regardless of ownership.
    expect(res.status).toBe(403);
  });

  test('Inventory Manager -> Sales Order (SALES dept) = 403', async () => {
    mockUser('u-inv', { role: 'store', designation: 'inventory_manager', department: 'INVENTORY', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/sales-order').set('Authorization', `Bearer ${tokenFor('u-inv')}`).send({});
    expect(res.status).toBe(403);
  });

  test('Finance -> Checklist ownership = 403 (department matches FINANCE, but not the creator)', async () => {
    mockUser('u-finance-2', { role: 'accounts', designation: 'executive', department: 'FINANCE', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/checklist').set('Authorization', `Bearer ${tokenFor('u-finance-2')}`).send({});
    expect(res.status).toBe(403);
  });

  test('Checklist-side (non-Finance department) user -> Payment write = 403', async () => {
    mockUser('u-checklist', { role: 'engineer', designation: 'engineer', department: 'SERVICE', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/payment-from-checklist').set('Authorization', `Bearer ${tokenFor('u-checklist')}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('Phase 2 — division-scope API-boundary tests', () => {
  let app;
  beforeEach(() => { app = buildApp(); mockCompanyAllEntitled(); });
  afterEach(() => jest.clearAllMocks());

  test('cross-division access = 403', async () => {
    mockUser('u-mep', { role: 'mep_dm', designation: 'mep_manager', division: 'MEP', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/division-record').set('Authorization', `Bearer ${tokenFor('u-mep')}`).send({});
    expect(res.status).toBe(403);
  });

  // Unknown-division-value handling is exercised directly at the unit level in
  // tests/division.test.js ("unknown division value -> denied") — not repeated here as an API test
  // since this route's target division is fixed per-route, not client-suppliable.

  test('matching division = 200', async () => {
    mockUser('u-solar-2', { role: 'solar_dm', designation: 'solar_manager', division: 'SOLAR', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/division-record').set('Authorization', `Bearer ${tokenFor('u-solar-2')}`).send({});
    expect(res.status).toBe(200);
  });
});

describe('Phase 2 — approval-bypass fails at the API boundary', () => {
  // No approval-gated resource exists as a real route in this foundation (approval UI/routes are
  // explicitly out of scope for Phase 2 — the engine is unit-tested directly in
  // tests/approvalService.test.js). This suite instead proves the structural guarantee: a record in
  // an approval-relevant locked state (APPROVED) cannot be edited directly through the ownership/
  // record-state layer, which is the mechanism that would back an approval-gated route.
  let app;
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.put('/approved-record', ...buildProtectedRoute({
      resource: 'approvedRecord', permission: PERMISSIONS.EDIT,
      loadRecord: () => Promise.resolve({ _id: 'ar-1', co: 'co-a', createdByUserId: 'u-owner', status: 'APPROVED' }),
      checkState: true,
    }), (req, res) => res.json({ ok: true }));
    app.use(notFound);
    app.use(errorHandler);
    mockCompanyAllEntitled();
  });
  afterEach(() => jest.clearAllMocks());

  test('creator cannot edit their own APPROVED record via a direct PUT — no bypass of the approval-relevant lock', async () => {
    mockUser('u-owner', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/approved-record').set('Authorization', `Bearer ${tokenFor('u-owner')}`).send({});
    expect(res.status).toBe(403);
  });
});
