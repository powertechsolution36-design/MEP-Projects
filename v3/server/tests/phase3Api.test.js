// Phase 3 — real Express API-boundary tests for the commercial entitlement routes (V3 PHASE 3
// spec §26). Models mocked so this suite never needs a live DB connection.
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock('../src/models/Plan', () => ({ find: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/Subscription', () => ({
  find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock('../src/models/AddOn', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/DivisionEntitlement', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/FeatureEntitlement', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({}) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const { app } = require('../src/app/app');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Plan = require('../src/models/Plan');
const Subscription = require('../src/models/Subscription');
const DivisionEntitlement = require('../src/models/DivisionEntitlement');
const FeatureEntitlement = require('../src/models/FeatureEntitlement');

function lean(value) { return { lean: () => Promise.resolve(value) }; }
// Some real code paths call `await Model.findOne(...)` directly (subscriptionService.js) while
// others chain `.lean()` (entitlementResolutionService.js) — a real Mongoose Query supports both.
// This mock return value replicates that: it is both directly awaitable and `.lean()`-chainable.
function query(value) {
  return { lean: () => Promise.resolve(value), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
}
function tokenFor(userId) { return jwt.sign({ id: userId }, env.JWT_SECRET); }
function mockUser(id, overrides) {
  User.findById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ _id: id, co: 'co-a', disabled: false, ...overrides }) }) });
}
function mockCompany(entitlementsOverrides = {}) {
  Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { divisions: [], modules: [], features: {}, limits: {}, computedAt: new Date(), ...entitlementsOverrides } }));
}

beforeEach(() => {
  // Default no-history/no-rows answers for the entitlement-recompute path
  // (services/entitlementResolutionService.js) that most write endpoints trigger as a side effect —
  // individual tests override with a more specific mock where the row content actually matters.
  Subscription.findOne.mockReturnValue(query(null));
  DivisionEntitlement.find.mockReturnValue(lean([]));
  FeatureEntitlement.find.mockReturnValue(lean([]));
  Company.findByIdAndUpdate.mockResolvedValue({});
});

afterEach(() => jest.clearAllMocks());

describe('Plan routes — platform-admin gating', () => {
  test('GET /plans requires auth (401 with no token)', async () => {
    const res = await request(app).get('/api/v3/plans');
    expect(res.status).toBe(401);
  });

  test('Company Admin cannot POST a platform Plan -> 403', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin' });
    mockCompany();
    const res = await request(app).post('/api/v3/plans').set('Authorization', `Bearer ${tokenFor('u-admin')}`)
      .send({ code: 'NEW_PLAN', name: 'New Plan' });
    expect(res.status).toBe(403);
    expect(Plan.create).not.toHaveBeenCalled();
  });

  test('an ordinary employee cannot POST a platform Plan -> 403', async () => {
    mockUser('u-eng', { role: 'engineer', designation: 'engineer' });
    mockCompany();
    const res = await request(app).post('/api/v3/plans').set('Authorization', `Bearer ${tokenFor('u-eng')}`)
      .send({ code: 'NEW_PLAN', name: 'New Plan' });
    expect(res.status).toBe(403);
  });

  test('Super Admin CAN create a Plan -> 201', async () => {
    mockUser('u-super', { role: 'super' });
    Plan.create.mockResolvedValue({ _id: 'plan-1', code: 'NEW_PLAN', name: 'New Plan', version: 1 });
    const res = await request(app).post('/api/v3/plans').set('Authorization', `Bearer ${tokenFor('u-super')}`)
      .send({ code: 'NEW_PLAN', name: 'New Plan' });
    expect(res.status).toBe(201);
    expect(res.body.plan.code).toBe('NEW_PLAN');
  });

  test('Company Admin cannot activate/deactivate a Plan -> 403', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin' });
    mockCompany();
    const res = await request(app).post('/api/v3/plans/plan-1/activate').set('Authorization', `Bearer ${tokenFor('u-admin')}`).send({});
    expect(res.status).toBe(403);
  });

  test('any authenticated user can list plans (read-only, filtered to sellable for non-admins)', async () => {
    mockUser('u-eng', { role: 'engineer' });
    mockCompany();
    Plan.find.mockReturnValue({ sort: () => lean([{ code: 'SOLAR_STARTER', status: 'active' }]) });
    const res = await request(app).get('/api/v3/plans').set('Authorization', `Bearer ${tokenFor('u-eng')}`);
    expect(res.status).toBe(200);
    expect(Plan.find).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', sellable: true }));
  });
});

describe('Subscription routes — tenant isolation + platform-admin gating', () => {
  test('Company A user GET Company B subscription -> 403', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    Subscription.findById.mockReturnValue(lean({ _id: 'sub-b', co: 'co-b', status: 'active' }));
    const res = await request(app).get('/api/v3/subscriptions/sub-b').set('Authorization', `Bearer ${tokenFor('u-a')}`);
    expect(res.status).toBe(403);
  });

  test('Company A user GET their OWN company subscription -> 200', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    Subscription.findById.mockReturnValue(lean({ _id: 'sub-a', co: 'co-a', status: 'active' }));
    const res = await request(app).get('/api/v3/subscriptions/sub-a').set('Authorization', `Bearer ${tokenFor('u-a')}`);
    expect(res.status).toBe(200);
  });

  test('Company A user PUT (add-addon) Company B subscription is blocked — not a platform admin, 403 before it ever reaches the record', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    mockCompany();
    const res = await request(app).post('/api/v3/subscriptions/sub-b/add-addon').set('Authorization', `Bearer ${tokenFor('u-a')}`).send({ addOnCode: 'DIVISION_MEP' });
    expect(res.status).toBe(403);
    expect(Subscription.findById).not.toHaveBeenCalled(); // requirePlatformAdmin denies before the controller even loads the record
  });

  test('a client user cannot self-assign a subscription — non-platform-admin POST /subscriptions -> 403', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    mockCompany();
    const res = await request(app).post('/api/v3/subscriptions').set('Authorization', `Bearer ${tokenFor('u-a')}`)
      .send({ targetCompanyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });
    expect(res.status).toBe(403);
    expect(Subscription.create).not.toHaveBeenCalled();
  });

  test('Super Admin CAN create a subscription for a company -> 201', async () => {
    mockUser('u-super', { role: 'super' });
    Plan.findById.mockResolvedValue({ _id: 'plan-1', code: 'SOLAR_STARTER', status: 'active', editable: true, availableDivisions: ['SOLAR'], defaultFeatures: {}, defaultLimits: {}, trial: { enabled: false } });
    Subscription.findOne.mockReturnValue(query(null));
    Subscription.create.mockResolvedValue({ _id: 'sub-new', co: 'co-a', status: 'active', addOns: [], save: jest.fn() });
    const res = await request(app).post('/api/v3/subscriptions').set('Authorization', `Bearer ${tokenFor('u-super')}`)
      .send({ targetCompanyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });
    expect(res.status).toBe(201);
  });
});

describe('Entitlements read route — tenant isolation', () => {
  test('Company A user GET Company B entitlements -> 403', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    const res = await request(app).get('/api/v3/entitlements/co-b').set('Authorization', `Bearer ${tokenFor('u-a')}`);
    expect(res.status).toBe(403);
  });

  test('Company A user GET their own company entitlements -> 200', async () => {
    mockUser('u-a', { role: 'engineer', co: 'co-a' });
    mockCompany({ divisions: ['SOLAR'] });
    const res = await request(app).get('/api/v3/entitlements/co-a').set('Authorization', `Bearer ${tokenFor('u-a')}`);
    expect(res.status).toBe(200);
    expect(res.body.entitlements.divisions).toEqual(['SOLAR']);
  });

  test('Super Admin can read ANY company entitlements', async () => {
    mockUser('u-super', { role: 'super' });
    mockCompany({ divisions: ['MEP'] });
    const res = await request(app).get('/api/v3/entitlements/co-anything').set('Authorization', `Bearer ${tokenFor('u-super')}`);
    expect(res.status).toBe(200);
  });
});

describe('Manual entitlement override routes — unauthorized self-grant blocked', () => {
  test('an unauthorized employee attempting to grant their OWN company a division -> 403', async () => {
    mockUser('u-eng', { role: 'engineer', co: 'co-a' });
    mockCompany();
    const res = await request(app).post('/api/v3/division-entitlements').set('Authorization', `Bearer ${tokenFor('u-eng')}`)
      .send({ targetCompanyId: 'co-a', division: 'HVAC', enabled: true, reason: 'I want it' });
    expect(res.status).toBe(403);
    expect(DivisionEntitlement.create).not.toHaveBeenCalled();
  });

  test('Company Admin attempting to grant their own company an entitlement -> 403 (§16: cannot grant commercial entitlements to itself)', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', co: 'co-a' });
    mockCompany();
    const res = await request(app).post('/api/v3/division-entitlements').set('Authorization', `Bearer ${tokenFor('u-admin')}`)
      .send({ targetCompanyId: 'co-a', division: 'HVAC', enabled: true, reason: 'Self-serve upgrade' });
    expect(res.status).toBe(403);
  });

  test('Super Admin CAN set a manual division entitlement, with a reason -> 201', async () => {
    mockUser('u-super', { role: 'super' });
    DivisionEntitlement.create.mockResolvedValue({ _id: 'de-1', division: 'HVAC', enabled: true });
    const res = await request(app).post('/api/v3/division-entitlements').set('Authorization', `Bearer ${tokenFor('u-super')}`)
      .send({ targetCompanyId: 'co-a', division: 'HVAC', enabled: true, reason: 'Customer upgraded' });
    expect(res.status).toBe(201);
  });

  test('Super Admin without a reason -> 422, never silently accepted', async () => {
    mockUser('u-super', { role: 'super' });
    const res = await request(app).post('/api/v3/division-entitlements').set('Authorization', `Bearer ${tokenFor('u-super')}`)
      .send({ targetCompanyId: 'co-a', division: 'HVAC', enabled: true });
    expect(res.status).toBe(422);
    expect(DivisionEntitlement.create).not.toHaveBeenCalled();
  });

  test('an unknown division is rejected with 422 at the API boundary', async () => {
    mockUser('u-super', { role: 'super' });
    const res = await request(app).post('/api/v3/division-entitlements').set('Authorization', `Bearer ${tokenFor('u-super')}`)
      .send({ targetCompanyId: 'co-a', division: 'PLUMBING', enabled: true, reason: 'x' });
    expect(res.status).toBe(422);
  });
});

describe('AddOn catalog routes — platform-admin gating', () => {
  test('a non-admin cannot create a catalog AddOn -> 403', async () => {
    mockUser('u-eng', { role: 'engineer' });
    mockCompany();
    const res = await request(app).post('/api/v3/addons').set('Authorization', `Bearer ${tokenFor('u-eng')}`)
      .send({ code: 'DIVISION_HVAC', name: 'HVAC Division Add-on' });
    expect(res.status).toBe(403);
  });
});
