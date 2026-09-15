// Tests for services/subscriptionService.js — create/change-plan/cancel/add-addon/remove-addon.
jest.mock('../src/models/Subscription', () => ({ create: jest.fn(), findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../src/models/Plan', () => ({ findById: jest.fn() }));
jest.mock('../src/models/AddOn', () => ({ findOne: jest.fn() }));
jest.mock('../src/models/DivisionEntitlement', () => ({ find: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/entitlementResolutionService', () => ({ computeAndCacheEntitlements: jest.fn().mockResolvedValue({}) }));

const Subscription = require('../src/models/Subscription');
const Plan = require('../src/models/Plan');
const AddOn = require('../src/models/AddOn');
const DivisionEntitlement = require('../src/models/DivisionEntitlement');
const { audit } = require('../src/services/auditService');
const { computeAndCacheEntitlements } = require('../src/services/entitlementResolutionService');
const subscriptionService = require('../src/services/subscriptionService');

function mockReq() {
  return { user: { _id: 'super-1', role: 'super' } };
}

function fakePlan(overrides = {}) {
  return {
    _id: 'plan-1', code: 'SOLAR_STARTER', name: 'Solar Starter', version: 1, status: 'active',
    editable: true, billingCycle: 'monthly', basePrice: 100, currency: 'INR',
    availableDivisions: ['SOLAR'], forbiddenDivisions: [], includedModules: [], defaultFeatures: {},
    defaultLimits: {}, trial: { enabled: false, days: 0 }, ...overrides,
  };
}

function lean(value) { return { lean: () => Promise.resolve(value) }; }

function fakeSubDoc(overrides = {}) {
  const doc = {
    _id: 'sub-1', co: 'co-a', status: 'active', planId: 'plan-1',
    planSnapshot: { code: 'SOLAR_STARTER', availableDivisions: ['SOLAR'], forbiddenDivisions: [] },
    purchasedDivisions: ['SOLAR'], addOns: [], ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

describe('createSubscription', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates a fresh subscription when none exists — status active, no supersession', async () => {
    Plan.findById.mockResolvedValue(fakePlan());
    Subscription.findOne.mockResolvedValue(null);
    Subscription.create.mockResolvedValue(fakeSubDoc());

    const req = mockReq();
    const sub = await subscriptionService.createSubscription({ req, companyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });

    expect(sub.status).toBe('active');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CREATED' }));
    expect(computeAndCacheEntitlements).toHaveBeenCalledWith('co-a');
  });

  test('a trial plan creates a subscription in status "trial" with trialEndsAt set', async () => {
    Plan.findById.mockResolvedValue(fakePlan({ trial: { enabled: true, days: 14 } }));
    Subscription.findOne.mockResolvedValue(null);
    Subscription.create.mockImplementation((data) => Promise.resolve(fakeSubDoc(data)));

    const sub = await subscriptionService.createSubscription({ req: mockReq(), companyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });
    expect(sub.status).toBe('trial');
    expect(sub.trialEndsAt).toBeInstanceOf(Date);
  });

  test('requesting a division not on the plan is rejected', async () => {
    Plan.findById.mockResolvedValue(fakePlan({ availableDivisions: ['SOLAR'] }));
    Subscription.findOne.mockResolvedValue(null);
    await expect(subscriptionService.createSubscription({ req: mockReq(), companyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['HVAC'] }))
      .rejects.toMatchObject({ code: 'INVALID_DIVISION' });
  });

  test('an inactive/non-sellable plan cannot be subscribed to', async () => {
    Plan.findById.mockResolvedValue(fakePlan({ status: 'draft', editable: true }));
    await expect(subscriptionService.createSubscription({ req: mockReq(), companyId: 'co-a', planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'PLAN_NOT_SELLABLE' });
  });

  test('plan switch: an existing active subscription is marked replaced, never mutated in place, and a new row is created', async () => {
    const existing = fakeSubDoc({ _id: 'sub-old' });
    Plan.findById.mockResolvedValue(fakePlan());
    Subscription.findOne.mockResolvedValue(existing);
    Subscription.create.mockResolvedValue(fakeSubDoc({ _id: 'sub-new' }));

    const sub = await subscriptionService.createSubscription({ req: mockReq(), companyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });

    expect(existing.status).toBe('replaced');
    expect(existing.endDate).toBeInstanceOf(Date);
    expect(existing.supersededBy).toBe('sub-new');
    expect(existing.save).toHaveBeenCalled();
    expect(sub._id).toBe('sub-new');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CHANGED' }));
  });

  test('planSnapshot is frozen at creation time — later changes to the live Plan document never retroactively alter it', async () => {
    const plan = fakePlan({ basePrice: 100 });
    Plan.findById.mockResolvedValue(plan);
    Subscription.findOne.mockResolvedValue(null);
    let capturedSnapshot;
    Subscription.create.mockImplementation((data) => { capturedSnapshot = data.planSnapshot; return Promise.resolve(fakeSubDoc(data)); });

    await subscriptionService.createSubscription({ req: mockReq(), companyId: 'co-a', planId: 'plan-1', purchasedDivisions: ['SOLAR'] });
    plan.basePrice = 999; // simulate a later live-plan edit
    expect(capturedSnapshot.basePrice).toBe(100); // snapshot already taken, unaffected
  });
});

describe('cancelSubscription', () => {
  afterEach(() => jest.clearAllMocks());

  test('an active subscription can be cancelled', async () => {
    const sub = fakeSubDoc({ status: 'active' });
    Subscription.findById.mockResolvedValue(sub);
    const result = await subscriptionService.cancelSubscription({ req: mockReq(), subscriptionId: 'sub-1', reason: 'Customer churned' });
    expect(result.status).toBe('cancelled');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CANCELLED' }));
  });

  test('an already-cancelled subscription cannot be cancelled again', async () => {
    Subscription.findById.mockResolvedValue(fakeSubDoc({ status: 'cancelled' }));
    await expect(subscriptionService.cancelSubscription({ req: mockReq(), subscriptionId: 'sub-1' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('addAddOn / removeAddOn', () => {
  afterEach(() => jest.clearAllMocks());

  test('a valid, compatible add-on is appended to Subscription.addOns[] — purchasedDivisions/planSnapshot untouched', async () => {
    const sub = fakeSubDoc();
    const originalDivisions = [...sub.purchasedDivisions];
    Subscription.findOne.mockResolvedValue(sub);
    AddOn.findOne.mockResolvedValue({ code: 'DIVISION_MEP', active: true, compatiblePlans: [], divisionsGranted: ['MEP'] });
    DivisionEntitlement.find.mockReturnValue(lean([]));

    const result = await subscriptionService.addAddOn({ req: mockReq(), companyId: 'co-a', addOnCode: 'DIVISION_MEP' });

    expect(result.addOns).toEqual([expect.objectContaining({ addOnCode: 'DIVISION_MEP', active: true })]);
    expect(result.purchasedDivisions).toEqual(originalDivisions); // never rewritten directly
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADDON_ASSIGNED' }));
  });

  test('an incompatible add-on is rejected before it touches the subscription', async () => {
    const sub = fakeSubDoc({ planSnapshot: { code: 'SOLAR_STARTER', forbiddenDivisions: ['MEP'] } });
    Subscription.findOne.mockResolvedValue(sub);
    AddOn.findOne.mockResolvedValue({ code: 'DIVISION_MEP', active: true, compatiblePlans: [], divisionsGranted: ['MEP'] });
    DivisionEntitlement.find.mockReturnValue(lean([]));

    await expect(subscriptionService.addAddOn({ req: mockReq(), companyId: 'co-a', addOnCode: 'DIVISION_MEP' }))
      .rejects.toMatchObject({ code: 'ADDON_INVALID' });
    expect(sub.save).not.toHaveBeenCalled();
  });

  test('no active subscription for the company -> NOT_FOUND', async () => {
    Subscription.findOne.mockResolvedValue(null);
    await expect(subscriptionService.addAddOn({ req: mockReq(), companyId: 'co-a', addOnCode: 'DIVISION_MEP' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('removeAddOn deactivates an active entry, never deletes the assignment history', async () => {
    const sub = fakeSubDoc({ addOns: [{ addOnCode: 'DIVISION_MEP', active: true }] });
    Subscription.findOne.mockResolvedValue(sub);

    const result = await subscriptionService.removeAddOn({ req: mockReq(), companyId: 'co-a', addOnCode: 'DIVISION_MEP' });

    expect(result.addOns[0].active).toBe(false);
    expect(result.addOns[0].deactivatedAt).toBeInstanceOf(Date);
    expect(result.addOns).toHaveLength(1); // record kept, not removed from the array
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADDON_REMOVED' }));
  });

  test('removing an add-on that is not currently active -> NOT_FOUND', async () => {
    const sub = fakeSubDoc({ addOns: [{ addOnCode: 'DIVISION_MEP', active: false }] });
    Subscription.findOne.mockResolvedValue(sub);
    await expect(subscriptionService.removeAddOn({ req: mockReq(), companyId: 'co-a', addOnCode: 'DIVISION_MEP' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
