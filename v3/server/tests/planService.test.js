// Tests for services/planService.js — create/update/activate/deactivate with safe versioning.
jest.mock('../src/models/Plan', () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock('../src/models/Subscription', () => ({ countDocuments: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));

const Plan = require('../src/models/Plan');
const Subscription = require('../src/models/Subscription');
const { audit } = require('../src/services/auditService');
const planService = require('../src/services/planService');

function mockReq() {
  return { user: { _id: 'super-1', role: 'super' } };
}

function fakePlanDoc(overrides = {}) {
  const doc = {
    _id: 'plan-1', code: 'SOLAR_STARTER', name: 'Solar Starter', version: 1, status: 'draft',
    editable: true, availableDivisions: ['SOLAR'], ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  doc.toObject = () => ({ ...doc });
  return doc;
}

describe('createPlan', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates a version-1 plan and audits PLAN_CREATED', async () => {
    Plan.create.mockResolvedValue(fakePlanDoc());
    const req = mockReq();
    const plan = await planService.createPlan({ req, data: { code: 'SOLAR_STARTER', name: 'Solar Starter' } });
    expect(Plan.create).toHaveBeenCalledWith(expect.objectContaining({ version: 1, createdBy: 'super-1' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_CREATED' }));
    expect(plan.code).toBe('SOLAR_STARTER');
  });
});

describe('updatePlan — safe versioning', () => {
  afterEach(() => jest.clearAllMocks());

  test('a plan with ZERO subscriptions is edited in place, version unchanged', async () => {
    const plan = fakePlanDoc();
    Plan.findById.mockResolvedValue(plan);
    Subscription.countDocuments.mockResolvedValue(0);

    const result = await planService.updatePlan({ req: mockReq(), planId: 'plan-1', changes: { name: 'Solar Starter v1 renamed' } });

    expect(result.name).toBe('Solar Starter v1 renamed');
    expect(result.version).toBe(1);
    expect(Plan.create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_UPDATED', after: expect.objectContaining({ inPlace: true }) }));
  });

  test('a plan WITH existing subscriptions is never mutated in place — a new version is created and the old one archived', async () => {
    const plan = fakePlanDoc({ status: 'active' });
    Plan.findById.mockResolvedValue(plan);
    Subscription.countDocuments.mockResolvedValue(3);
    const newPlanDoc = fakePlanDoc({ _id: 'plan-2', version: 2 });
    Plan.create.mockResolvedValue(newPlanDoc);

    const result = await planService.updatePlan({ req: mockReq(), planId: 'plan-1', changes: { basePrice: 999 } });

    expect(Plan.create).toHaveBeenCalledWith(expect.objectContaining({ version: 2, supersedes: 'plan-1', basePrice: 999 }));
    expect(plan.status).toBe('archived'); // old version archived, never deleted
    expect(plan.save).toHaveBeenCalled();
    expect(result._id).toBe('plan-2');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_UPDATED', after: expect.objectContaining({ inPlace: false, supersedes: 'plan-1' }) }));
  });

  test('LEGACY_UNLIMITED (editable:false) can never be edited', async () => {
    Plan.findById.mockResolvedValue(fakePlanDoc({ code: 'LEGACY_UNLIMITED', editable: false }));
    await expect(planService.updatePlan({ req: mockReq(), planId: 'plan-legacy', changes: { basePrice: 1 } }))
      .rejects.toMatchObject({ code: 'NOT_EDITABLE' });
    expect(Plan.create).not.toHaveBeenCalled();
  });

  test('plan not found -> NOT_FOUND', async () => {
    Plan.findById.mockResolvedValue(null);
    await expect(planService.updatePlan({ req: mockReq(), planId: 'ghost', changes: {} }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('activatePlan / deactivatePlan', () => {
  afterEach(() => jest.clearAllMocks());

  test('activatePlan sets status active and audits PLAN_ACTIVATED', async () => {
    const plan = fakePlanDoc({ status: 'draft' });
    Plan.findById.mockResolvedValue(plan);
    const result = await planService.activatePlan({ req: mockReq(), planId: 'plan-1' });
    expect(result.status).toBe('active');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_ACTIVATED' }));
  });

  test('deactivatePlan sets status inactive and audits PLAN_DEACTIVATED', async () => {
    const plan = fakePlanDoc({ status: 'active' });
    Plan.findById.mockResolvedValue(plan);
    const result = await planService.deactivatePlan({ req: mockReq(), planId: 'plan-1' });
    expect(result.status).toBe('inactive');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_DEACTIVATED' }));
  });

  test('LEGACY_UNLIMITED cannot be deactivated', async () => {
    Plan.findById.mockResolvedValue(fakePlanDoc({ code: 'LEGACY_UNLIMITED' }));
    await expect(planService.deactivatePlan({ req: mockReq(), planId: 'plan-legacy' }))
      .rejects.toMatchObject({ code: 'NOT_EDITABLE' });
  });
});
