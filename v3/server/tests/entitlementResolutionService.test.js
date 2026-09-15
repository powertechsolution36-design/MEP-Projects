// Tests for services/entitlementResolutionService.js — the async orchestrator + cache staleness
// rule (PLAN_ENTITLEMENTS.md §2: 5-minute cache validity). Models mocked so this never needs a live
// DB connection.
jest.mock('../src/models/Company', () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock('../src/models/Subscription', () => ({ findOne: jest.fn() }));
jest.mock('../src/models/DivisionEntitlement', () => ({ find: jest.fn() }));
jest.mock('../src/models/FeatureEntitlement', () => ({ find: jest.fn() }));
jest.mock('../src/models/AddOn', () => ({ find: jest.fn() }));

const Company = require('../src/models/Company');
const Subscription = require('../src/models/Subscription');
const DivisionEntitlement = require('../src/models/DivisionEntitlement');
const FeatureEntitlement = require('../src/models/FeatureEntitlement');
const AddOn = require('../src/models/AddOn');
const svc = require('../src/services/entitlementResolutionService');

function lean(value) {
  return { lean: () => Promise.resolve(value) };
}

function activeSub(overrides = {}) {
  return {
    _id: 'sub-1', co: 'co-a', status: 'active',
    planSnapshot: { code: 'SOLAR_STARTER', availableDivisions: ['SOLAR'], defaultFeatures: { 'auth.login': true }, defaultLimits: { users: 5 } },
    purchasedDivisions: ['SOLAR'], addOns: [],
    ...overrides,
  };
}

describe('computeAndCacheEntitlements', () => {
  afterEach(() => jest.clearAllMocks());

  test('no subscription -> writes a migrationReviewRequired cache, zero grant', async () => {
    Subscription.findOne.mockReturnValue(lean(null));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    const cache = await svc.computeAndCacheEntitlements('co-a');

    expect(cache.migrationReviewRequired).toBe(true);
    expect(cache.divisions).toEqual([]);
    expect(Company.findByIdAndUpdate).toHaveBeenCalledWith('co-a', expect.objectContaining({
      $set: expect.objectContaining({ entitlements: expect.objectContaining({ migrationReviewRequired: true }) }),
    }));
  });

  test('active subscription -> writes a fresh cache with computedAt/computedFrom', async () => {
    Subscription.findOne.mockReturnValue(lean(activeSub()));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    const cache = await svc.computeAndCacheEntitlements('co-a');

    expect(cache.divisions).toEqual(['SOLAR']);
    expect(cache.migrationReviewRequired).toBe(false);
    expect(cache.computedAt).toBeInstanceOf(Date);
    expect(cache.computedFrom.subscriptionId).toBe('sub-1');
  });

  test('active add-ons are resolved from the AddOn catalog by code', async () => {
    Subscription.findOne.mockReturnValue(lean(activeSub({ addOns: [{ addOnCode: 'DIVISION_MEP', active: true }] })));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    AddOn.find.mockReturnValue(lean([{ code: 'DIVISION_MEP', divisionsGranted: ['MEP'] }]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    const cache = await svc.computeAndCacheEntitlements('co-a');

    expect(AddOn.find).toHaveBeenCalledWith({ code: { $in: ['DIVISION_MEP'] } });
    expect(cache.divisions.sort()).toEqual(['MEP', 'SOLAR']);
  });

  test('no active add-ons -> AddOn.find is never called (avoids an unnecessary query)', async () => {
    Subscription.findOne.mockReturnValue(lean(activeSub()));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    await svc.computeAndCacheEntitlements('co-a');
    expect(AddOn.find).not.toHaveBeenCalled();
  });
});

describe('getEffectiveEntitlements — cache staleness (5-minute rule)', () => {
  afterEach(() => jest.clearAllMocks());

  test('a fresh cache (<5 min old) is returned without recomputing', async () => {
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { divisions: ['SOLAR'], computedAt: new Date() } }));

    const result = await svc.getEffectiveEntitlements('co-a');

    expect(result.divisions).toEqual(['SOLAR']);
    expect(Subscription.findOne).not.toHaveBeenCalled();
  });

  test('a stale cache (>5 min old) forces a recompute', async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { divisions: [], computedAt: staleDate } }));
    Subscription.findOne.mockReturnValue(lean(activeSub()));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    const result = await svc.getEffectiveEntitlements('co-a');

    expect(Subscription.findOne).toHaveBeenCalled();
    expect(result.divisions).toEqual(['SOLAR']); // recomputed value, not the stale cached []
  });

  test('a cache with no computedAt at all is treated as stale', async () => {
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: {} }));
    Subscription.findOne.mockReturnValue(lean(null));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    await svc.getEffectiveEntitlements('co-a');
    expect(Subscription.findOne).toHaveBeenCalled();
  });

  test('forceRecompute:true always recomputes even with a fresh cache', async () => {
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { divisions: ['SOLAR'], computedAt: new Date() } }));
    Subscription.findOne.mockReturnValue(lean(null));
    DivisionEntitlement.find.mockReturnValue(lean([]));
    FeatureEntitlement.find.mockReturnValue(lean([]));
    Company.findByIdAndUpdate.mockResolvedValue({});

    await svc.getEffectiveEntitlements('co-a', { forceRecompute: true });
    expect(Subscription.findOne).toHaveBeenCalled();
  });
});

describe('companyHasFeature / checkCompanyLimit', () => {
  afterEach(() => jest.clearAllMocks());

  test('companyHasFeature reads the effective feature map, boolean and numeric-truthy both count', async () => {
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { features: { 'auth.login': true, extra_seats: 5, disabled_feature: false }, computedAt: new Date() } }));
    expect(await svc.companyHasFeature('co-a', 'auth.login')).toBe(true);
    expect(await svc.companyHasFeature('co-a', 'extra_seats')).toBe(true);
    expect(await svc.companyHasFeature('co-a', 'disabled_feature')).toBe(false);
    expect(await svc.companyHasFeature('co-a', 'never_granted')).toBe(false);
  });

  test('checkCompanyLimit delegates to checkLimit() against the cached limits', async () => {
    Company.findById.mockReturnValue(lean({ _id: 'co-a', entitlements: { limits: { users: 5 }, computedAt: new Date() } }));
    const result = await svc.checkCompanyLimit('co-a', 'users', 3);
    expect(result.withinLimit).toBe(true);
    expect(result.remaining).toBe(2);
  });
});
