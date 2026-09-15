// Phase 4 — API-level security tests for global record ownership (V3 PHASE 4 spec §20–§24).
//
// Everything here runs through a REAL Express app and the REAL middleware chain
// (middleware/chain.js buildProtectedRoute), so every assertion proves server-side enforcement —
// "UI button visibility is not a security mechanism" (DATABASE_ARCHITECTURE.md rev 12).
//
// Phase 4 explicitly does NOT build Sales/Finance/Inventory/Service/Projects modules, so the
// protected endpoints below are representative fixtures standing in for them (§23: "The feature
// modules do not need to exist yet; use test fixtures/mocks for the authorization layer"). The
// authorization layer under test is the real, shared one those modules will consume unchanged.
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({ _id: 'a1' }) }));
jest.mock('../src/models/RecordCorrection', () => ({
  create: jest.fn().mockResolvedValue({ _id: 'corr-1' }),
  deleteOne: jest.fn().mockResolvedValue({}),
  find: jest.fn(),
  findById: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const RecordCorrection = require('../src/models/RecordCorrection');
const { app: realApp } = require('../src/app/app');
const { buildProtectedRoute } = require('../src/middleware/chain');
const { errorHandler, notFound } = require('../src/middleware/errorHandler');
const { PERMISSIONS, RECORD_STATES } = require('../src/config/constants');

const CO_A = 'co-a';
const CO_B = 'co-b';
const OWNER = 'u-owner';

// ---------------------------------------------------------------------------------------------
// Representative records standing in for future feature-module collections.
// ---------------------------------------------------------------------------------------------
const RECORDS = {
  draft: { _id: 'rec-1', co: CO_A, createdByUserId: OWNER, status: RECORD_STATES.DRAFT, amount: 100 },
  submitted: { _id: 'rec-2', co: CO_A, createdByUserId: OWNER, status: RECORD_STATES.SUBMITTED },
  finalized: { _id: 'rec-3', co: CO_A, createdByUserId: OWNER, status: RECORD_STATES.FINALIZED },
  otherCompany: { _id: 'rec-b', co: CO_B, createdByUserId: 'u-b-owner', status: RECORD_STATES.DRAFT },
  hvac: { _id: 'rec-hvac', co: CO_A, createdByUserId: OWNER, status: RECORD_STATES.DRAFT, division: 'HVAC' },
  mep: { _id: 'rec-mep', co: CO_A, createdByUserId: OWNER, status: RECORD_STATES.DRAFT, division: 'MEP' },
};

// Project A / Package A1 list only the A1 technician. An engineer/technician's project scope comes
// from the PROJECT's own assignment list (middleware/projectScope.js), and the package adds a
// finer per-user access list on top — so u-tech-b1, assigned to project B instead, is on neither.
const PROJECT_A = { _id: 'proj-a', co: CO_A, division: 'SOLAR', accessList: ['u-tech-a1'] };
const PACKAGE_A1 = { _id: 'pkg-a1', co: CO_A, projectId: 'proj-a', accessList: ['u-tech-a1'] };

function ok(req, res) {
  res.json({ ok: true, requiresCorrection: !!req.ownershipDecision?.requiresCorrection });
}

function buildApp() {
  const app = express();
  app.use(express.json());

  const record = (key) => () => Promise.resolve(RECORDS[key]);

  // §20 — EDIT / DELETE on a creator-owned record.
  app.put('/quotations/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.EDIT, loadRecord: record('draft'),
  }), ok);

  app.delete('/quotations/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.DELETE, loadRecord: record('draft'), ownershipAction: 'delete',
  }), ok);

  // §11 — delete is stricter than edit: the same record in SUBMITTED state.
  app.put('/quotations-submitted/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.EDIT, loadRecord: record('submitted'),
  }), ok);

  app.delete('/quotations-submitted/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.DELETE, loadRecord: record('submitted'), ownershipAction: 'delete',
  }), ok);

  // §9 — a finalized record is locked to everyone, creator included.
  app.put('/quotations-finalized/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.EDIT, loadRecord: record('finalized'),
  }), ok);

  // §21 — a record belonging to another company.
  app.put('/cross-company/:id', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.EDIT, loadRecord: record('otherCompany'),
  }), ok);

  // §22 — division-restricted records. The requester is made the owner so the DIVISION layer is
  // what is actually under test, not ownership.
  app.put('/hvac-record/:id', ...buildProtectedRoute({
    resource: 'HvacRecord', permission: PERMISSIONS.EDIT, division: () => 'HVAC',
    loadRecord: (req) => Promise.resolve({ ...RECORDS.hvac, createdByUserId: req.user._id }),
  }), ok);

  app.put('/mep-record/:id', ...buildProtectedRoute({
    resource: 'MepRecord', permission: PERMISSIONS.EDIT, division: () => 'MEP',
    loadRecord: (req) => Promise.resolve({ ...RECORDS.mep, createdByUserId: req.user._id }),
  }), ok);

  // §23 — project / package scope.
  app.put('/packages/a1', ...buildProtectedRoute({
    resource: 'ProjectPackage', permission: PERMISSIONS.EDIT,
    pkg: { loadPackage: () => Promise.resolve(PACKAGE_A1), loadProject: () => Promise.resolve(PROJECT_A) },
    loadRecord: (req) => Promise.resolve({ _id: 'pkgrec-1', co: CO_A, createdByUserId: req.user._id, status: RECORD_STATES.DRAFT }),
  }), ok);

  // §5 / §24 — a BUSINESS action route. Authorized by its own business permission; it deliberately
  // does NOT run the ownership gate, and holding it must not confer edit rights anywhere.
  app.post('/quotations/:id/approve', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.APPROVE,
  }), (req, res) => res.json({ ok: true, approved: true }));

  app.post('/quotations/:id/submit', ...buildProtectedRoute({
    resource: 'Quotation', permission: PERMISSIONS.SUBMIT,
  }), (req, res) => res.json({ ok: true, submitted: true }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function tokenFor(userId) { return jwt.sign({ id: userId }, env.JWT_SECRET); }

function mockUser(id, overrides = {}) {
  User.findById.mockReturnValueOnce({
    select: () => ({ lean: () => Promise.resolve({ _id: id, co: CO_A, disabled: false, ...overrides }) }),
  });
}

function mockCompany() {
  Company.findById.mockReturnValue({
    lean: () => Promise.resolve({ _id: CO_A, entitlements: { modules: '*', divisions: '*', enforceEntitlements: true } }),
  });
}

let app;
beforeEach(() => { app = buildApp(); mockCompany(); });
afterEach(() => jest.clearAllMocks());

const auth = (id) => ({ Authorization: `Bearer ${tokenFor(id)}` });

// =============================================================================================
describe('§20 — REST API protection on a creator-owned record', () => {
  test('User A (creator) UPDATE own record -> allowed', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth(OWNER)).send({ amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body.requiresCorrection).toBe(false);
  });

  test('User B UPDATE = 403', async () => {
    mockUser('u-b', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-b')).send({ amount: 200 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('User B DELETE = 403', async () => {
    mockUser('u-b', { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/quotations/rec-1').set(auth('u-b')).send({});
    expect(res.status).toBe(403);
  });

  test('Manager UPDATE = 403 — a manager title is not edit authority (§4)', async () => {
    mockUser('u-mgr', { role: 'hvac_dm', designation: 'hvac_manager', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-mgr')).send({ amount: 200 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not the record owner/i);
  });

  test('Company Admin UPDATE = 403 — no generic admin editing bypass (§4)', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-admin')).send({ amount: 200 });
    expect(res.status).toBe(403);
  });

  test('Company Admin DELETE = 403 as well', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/quotations/rec-1').set(auth('u-admin')).send({});
    expect(res.status).toBe(403);
  });

  test('an unauthenticated request is 401, never 403', async () => {
    const res = await request(app).put('/quotations/rec-1').send({});
    expect(res.status).toBe(401);
  });

  test('the creator still needs the underlying permission — ownership alone is not enough', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [] });
    const res = await request(app).put('/quotations/rec-1').set(auth(OWNER)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/missing permission/i);
  });
});

describe('§6 — a Manager with an EXPLICIT override grant goes through the correction path', () => {
  test('an explicitly granted Quotation.override allows the edit and flags it as a correction', async () => {
    mockUser('u-mgr', {
      role: 'hvac_dm', designation: 'hvac_manager',
      permissions: [PERMISSIONS.EDIT, 'Quotation.override'],
    });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-mgr')).send({ amount: 200 });
    expect(res.status).toBe(200);
    // Never a silent field write — the route is told this must be recorded as a RecordCorrection.
    expect(res.body.requiresCorrection).toBe(true);
  });

  test('an override grant for a DIFFERENT resource does not transfer', async () => {
    mockUser('u-mgr', { role: 'hvac_dm', permissions: [PERMISSIONS.EDIT, 'Payment.override'] });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-mgr')).send({});
    expect(res.status).toBe(403);
  });

  test('an override never unlocks a FINALIZED record — only reversal can (§9)', async () => {
    mockUser('u-mgr', { role: 'hvac_dm', permissions: [PERMISSIONS.EDIT, 'Quotation.override'] });
    const res = await request(app).put('/quotations-finalized/rec-3').set(auth('u-mgr')).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/locked/i);
  });
});

describe('§9 / §11 — state governs eligibility, and delete is stricter than edit', () => {
  test('the creator may still EDIT their SUBMITTED record', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations-submitted/rec-2').set(auth(OWNER)).send({});
    expect(res.status).toBe(200);
  });

  test('but the creator may NOT DELETE the same SUBMITTED record', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/quotations-submitted/rec-2').set(auth(OWNER)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/restricted/i);
  });

  test('creator ownership never bypasses immutability on a FINALIZED record', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations-finalized/rec-3').set(auth(OWNER)).send({});
    expect(res.status).toBe(403);
  });
});

describe('§12 / §16 — immutable fields are protected at the API boundary', () => {
  test('a payload trying to reassign createdByUserId is stripped before the handler runs', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth(OWNER))
      .send({ amount: 200, createdByUserId: 'u-attacker', createdAt: '2000-01-01' });
    expect(res.status).toBe(200);
    // The record's owner is unchanged — the fixture record is the source of truth.
    expect(RECORDS.draft.createdByUserId).toBe(OWNER);
  });

  test('a client-supplied companyId can never widen tenant scope (STEP 6, still enforced)', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth(OWNER)).send({ companyId: CO_B, co: CO_B });
    expect(res.status).toBe(200);
    expect(RECORDS.draft.co).toBe(CO_A);
  });
});

describe('§21 — cross-company protection', () => {
  test('a Company A user editing a Company B record -> 403', async () => {
    mockUser('u-a', { role: 'engineer', co: CO_A, permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/cross-company/rec-b').set(auth('u-a')).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cross-company/i);
  });

  test('cross-company is refused even WITH an override grant — isolation outranks override', async () => {
    mockUser('u-a', { role: 'engineer', co: CO_A, permissions: [PERMISSIONS.EDIT, 'Quotation.override'] });
    const res = await request(app).put('/cross-company/rec-b').set(auth('u-a')).send({});
    expect(res.status).toBe(403);
  });

  test('cross-company is refused even for a Company Admin', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', co: CO_A, permissions: ['*'] });
    const res = await request(app).put('/cross-company/rec-b').set(auth('u-admin')).send({});
    expect(res.status).toBe(403);
  });
});

describe('§22 — cross-division protection (MEP and HVAC are never merged)', () => {
  test('an MEP user editing an HVAC-restricted record -> 403', async () => {
    mockUser('u-mep', { role: 'mep_dm', designation: 'mep_manager', division: 'MEP', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/hvac-record/rec-hvac').set(auth('u-mep')).send({});
    expect(res.status).toBe(403);
  });

  test('an HVAC user editing an MEP-restricted record -> 403', async () => {
    mockUser('u-hvac', { role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/mep-record/rec-mep').set(auth('u-hvac')).send({});
    expect(res.status).toBe(403);
  });

  test('an HVAC user editing their OWN division\'s record -> allowed', async () => {
    mockUser('u-hvac', { role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/hvac-record/rec-hvac').set(auth('u-hvac')).send({});
    expect(res.status).toBe(200);
  });
});

describe('§23 — cross-project / package protection', () => {
  test('a technician assigned to package A1 -> allowed', async () => {
    mockUser('u-tech-a1', { role: 'engineer', designation: 'technician', division: 'SOLAR', projectAccess: ['proj-a'], permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/packages/a1').set(auth('u-tech-a1')).send({});
    expect(res.status).toBe(200);
  });

  test('a technician assigned elsewhere (B1) -> A1 access denied', async () => {
    mockUser('u-tech-b1', { role: 'engineer', designation: 'technician', division: 'SOLAR', projectAccess: ['proj-b'], permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/packages/a1').set(auth('u-tech-b1')).send({});
    expect(res.status).toBe(403);
  });
});

describe('§24 — approval and ownership are separate axes', () => {
  test('the creator can SUBMIT their own record', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.SUBMIT] });
    const res = await request(app).post('/quotations/rec-1/submit').set(auth(OWNER)).send({});
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);
  });

  test('an authorized approver can APPROVE', async () => {
    mockUser('u-approver', { role: 'hvac_dm', permissions: [PERMISSIONS.APPROVE] });
    const res = await request(app).post('/quotations/rec-1/approve').set(auth('u-approver')).send({});
    expect(res.status).toBe(200);
  });

  test('an unauthorized user cannot APPROVE -> 403', async () => {
    mockUser('u-b', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).post('/quotations/rec-1/approve').set(auth('u-b')).send({});
    expect(res.status).toBe(403);
  });

  test('holding APPROVE does NOT confer Edit on the creator\'s record (§5)', async () => {
    mockUser('u-approver', { role: 'hvac_dm', permissions: [PERMISSIONS.APPROVE, PERMISSIONS.EDIT] });
    const res = await request(app).put('/quotations/rec-1').set(auth('u-approver')).send({});
    expect(res.status).toBe(403);
  });

  test('holding APPROVE does NOT confer Delete on the creator\'s record', async () => {
    mockUser('u-approver', { role: 'hvac_dm', permissions: [PERMISSIONS.APPROVE, PERMISSIONS.DELETE] });
    const res = await request(app).delete('/quotations/rec-1').set(auth('u-approver')).send({});
    expect(res.status).toBe(403);
  });
});

// =============================================================================================
// The REAL /api/v3/record-corrections routes (API_ARCHITECTURE.md §2 rev 12).
// =============================================================================================
describe('/api/v3/record-corrections — read-only correction history', () => {
  function chain(value) {
    const q = { sort: () => q, limit: () => q, lean: () => Promise.resolve(value) };
    return q;
  }

  test('requires authentication', async () => {
    const res = await request(realApp).get('/api/v3/record-corrections');
    expect(res.status).toBe(401);
  });

  test('a correction can NEVER be posted directly by a client -> 405', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(realApp).post('/api/v3/record-corrections').set(auth('u-admin'))
      .send({ originalRecordId: 'rec-1', reason: 'forged' });
    expect(res.status).toBe(405);
    expect(RecordCorrection.create).not.toHaveBeenCalled();
  });

  test('DELETE on correction history is refused — audit history is never destroyed', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(realApp).delete('/api/v3/record-corrections/corr-1').set(auth('u-admin'));
    expect(res.status).toBe(405);
  });

  test('a list is always scoped to the caller\'s own company', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    RecordCorrection.find.mockReturnValue(chain([{ _id: 'corr-1', co: CO_A }]));
    const res = await request(realApp).get('/api/v3/record-corrections').set(auth('u-admin'));
    expect(res.status).toBe(200);
    expect(RecordCorrection.find).toHaveBeenCalledWith(expect.objectContaining({ co: CO_A }));
  });

  test('a client-supplied companyId cannot widen the correction listing', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    RecordCorrection.find.mockReturnValue(chain([]));
    await request(realApp).get(`/api/v3/record-corrections?companyId=${CO_B}`).set(auth('u-admin'));
    expect(RecordCorrection.find).toHaveBeenCalledWith(expect.objectContaining({ co: CO_A }));
  });

  test('reading another company\'s correction by id -> 403', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    RecordCorrection.findById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'corr-b', co: CO_B }) });
    const res = await request(realApp).get('/api/v3/record-corrections/corr-b').set(auth('u-admin'));
    expect(res.status).toBe(403);
  });

  test('reading an own-company correction by id -> 200', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    RecordCorrection.findById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'corr-1', co: CO_A, reason: 'fix' }) });
    const res = await request(realApp).get('/api/v3/record-corrections/corr-1').set(auth('u-admin'));
    expect(res.status).toBe(200);
    expect(res.body.correction.reason).toBe('fix');
  });

  test('a user without VIEW permission cannot read correction history', async () => {
    mockUser('u-eng', { role: 'engineer', permissions: [] });
    const res = await request(realApp).get('/api/v3/record-corrections').set(auth('u-eng'));
    expect(res.status).toBe(403);
  });
});
