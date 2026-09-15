// Tests for services/manualEntitlementService.js — explicit, company-scoped, authorized, audited,
// reasoned manual overrides (V3 PHASE 3 spec §14).
jest.mock('../src/models/DivisionEntitlement', () => ({ create: jest.fn() }));
jest.mock('../src/models/FeatureEntitlement', () => ({ create: jest.fn() }));
jest.mock('../src/services/auditService', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/entitlementResolutionService', () => ({ computeAndCacheEntitlements: jest.fn().mockResolvedValue({}) }));

const DivisionEntitlement = require('../src/models/DivisionEntitlement');
const FeatureEntitlement = require('../src/models/FeatureEntitlement');
const { audit } = require('../src/services/auditService');
const { computeAndCacheEntitlements } = require('../src/services/entitlementResolutionService');
const manualEntitlementService = require('../src/services/manualEntitlementService');

function mockReq() {
  return { user: { _id: 'super-1', role: 'super' } };
}

describe('setManualDivisionEntitlement', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates a new row (never mutates a prior one) and audits both DIVISION_ENABLED and MANUAL_ENTITLEMENT_GRANTED', async () => {
    DivisionEntitlement.create.mockResolvedValue({ _id: 'de-1', division: 'HVAC', enabled: true });
    await manualEntitlementService.setManualDivisionEntitlement({ req: mockReq(), companyId: 'co-a', division: 'HVAC', enabled: true, reason: 'Customer upgraded' });

    expect(DivisionEntitlement.create).toHaveBeenCalledWith(expect.objectContaining({ co: 'co-a', division: 'HVAC', enabled: true, source: 'manual', reason: 'Customer upgraded' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DIVISION_ENABLED' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MANUAL_ENTITLEMENT_GRANTED' }));
    expect(computeAndCacheEntitlements).toHaveBeenCalledWith('co-a');
  });

  test('a disable audits DIVISION_DISABLED and MANUAL_ENTITLEMENT_DISABLED', async () => {
    DivisionEntitlement.create.mockResolvedValue({ _id: 'de-2', division: 'HVAC', enabled: false });
    await manualEntitlementService.setManualDivisionEntitlement({ req: mockReq(), companyId: 'co-a', division: 'HVAC', enabled: false, reason: 'Downgrade' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DIVISION_DISABLED' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MANUAL_ENTITLEMENT_DISABLED' }));
  });

  test('an unknown division is rejected', async () => {
    await expect(manualEntitlementService.setManualDivisionEntitlement({ req: mockReq(), companyId: 'co-a', division: 'PLUMBING', enabled: true, reason: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_DIVISION' });
    expect(DivisionEntitlement.create).not.toHaveBeenCalled();
  });

  test('a missing/blank reason is rejected — every manual change must be reasoned', async () => {
    await expect(manualEntitlementService.setManualDivisionEntitlement({ req: mockReq(), companyId: 'co-a', division: 'HVAC', enabled: true, reason: '   ' }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(manualEntitlementService.setManualDivisionEntitlement({ req: mockReq(), companyId: 'co-a', division: 'HVAC', enabled: true }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
});

describe('setManualFeatureEntitlement', () => {
  afterEach(() => jest.clearAllMocks());

  test('creates a new row and audits FEATURE_ENABLED + MANUAL_ENTITLEMENT_GRANTED', async () => {
    FeatureEntitlement.create.mockResolvedValue({ _id: 'fe-1', feature: 'ai_estimator', enabled: true });
    await manualEntitlementService.setManualFeatureEntitlement({ req: mockReq(), companyId: 'co-a', feature: 'ai_estimator', enabled: true, reason: 'Pilot program' });
    expect(FeatureEntitlement.create).toHaveBeenCalledWith(expect.objectContaining({ feature: 'ai_estimator', enabled: true, source: 'manual' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEATURE_ENABLED' }));
  });

  test('a numeric limit override is passed through to the created row', async () => {
    FeatureEntitlement.create.mockResolvedValue({ _id: 'fe-2', feature: 'storage_100gb', enabled: true, limit: 500 });
    await manualEntitlementService.setManualFeatureEntitlement({ req: mockReq(), companyId: 'co-a', feature: 'storage_100gb', enabled: true, limit: 500, reason: 'Enterprise deal' });
    expect(FeatureEntitlement.create).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });

  test('an unknown feature code is rejected — never a random string', async () => {
    await expect(manualEntitlementService.setManualFeatureEntitlement({ req: mockReq(), companyId: 'co-a', feature: 'made_up_feature', enabled: true, reason: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_FEATURE' });
  });

  test('a missing reason is rejected', async () => {
    await expect(manualEntitlementService.setManualFeatureEntitlement({ req: mockReq(), companyId: 'co-a', feature: 'ai_estimator', enabled: true }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
});
