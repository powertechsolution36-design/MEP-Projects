'use strict';

const { ServiceError } = require('../errors');
const { DIVISIONS } = require('../models/shared/enums');

/**
 * DEFAULT_PLANS — the 7 V3-style plan catalog entries.
 * Seeded into the plans collection if empty.
 * Prices are NOT hardcoded — they're editable by Super Admin.
 */
const DEFAULT_PLANS = [
  { code: 'HVAC_STARTER', name: 'HVAC Starter', availableDivisions: ['HVAC'], trialDays: 15 },
  { code: 'SOLAR_STARTER', name: 'Solar Starter', availableDivisions: ['Solar'], trialDays: 15 },
  { code: 'MEP_STARTER', name: 'MEP Starter', availableDivisions: ['MEP'], trialDays: 15 },
  { code: 'MEP_HVAC_PRO', name: 'MEP + HVAC Pro', availableDivisions: ['MEP', 'HVAC'], trialDays: 15 },
  { code: 'MEP_SOLAR_PRO', name: 'MEP + Solar Pro', availableDivisions: ['MEP', 'Solar'], trialDays: 15 },
  { code: 'SOLAR_HVAC_PRO', name: 'Solar + HVAC Pro', availableDivisions: ['Solar', 'HVAC'], trialDays: 15 },
  { code: 'FULL_ENTERPRISE', name: 'Full Enterprise', availableDivisions: ['HVAC', 'Solar', 'MEP'], trialDays: 30 },
];

// ── Plan CRUD ──

async function listPlans(deps) {
  return deps.planRepo.listAll();
}

async function getPlan(code, deps) {
  const plan = await deps.planRepo.findByCode(code);
  if (!plan) throw new ServiceError('Plan not found.', 'NOT_FOUND', 404);
  return plan;
}

async function createPlan(data, deps) {
  if (!data.code || !data.name || !data.availableDivisions || data.availableDivisions.length < 1) {
    throw new ServiceError('Plan code, name, and at least one division are required.');
  }
  for (const d of data.availableDivisions) {
    if (!DIVISIONS.includes(d)) throw new ServiceError(`Invalid division: ${d}`);
  }
  return deps.planRepo.create(data);
}

async function updatePlan(code, patch, deps) {
  if (patch.availableDivisions) {
    for (const d of patch.availableDivisions) {
      if (!DIVISIONS.includes(d)) throw new ServiceError(`Invalid division: ${d}`);
    }
  }
  const updated = await deps.planRepo.updateByCode(code, patch);
  if (!updated) throw new ServiceError('Plan not found.', 'NOT_FOUND', 404);
  return updated;
}

async function seedDefaultPlans(deps) {
  const existing = await deps.planRepo.listAll();
  const existingCodes = new Set(existing.map((p) => p.code));
  const created = [];
  for (const p of DEFAULT_PLANS) {
    if (!existingCodes.has(p.code)) {
      created.push(await deps.planRepo.create({ ...p, status: 'active', version: 1, pricing: {} }));
    }
  }
  // Return the full catalog (existing untouched + newly created)
  if (created.length === 0) return existing;
  return deps.planRepo.listAll();
}

// ── Subscription management ──

async function getSubscription(companyId, deps) {
  return deps.subscriptionRepo.findByCompany(companyId);
}

async function createOrUpdateSubscription(companyId, data, actorId, deps) {
  if (!data.planCode) throw new ServiceError('Plan code is required.');
  if (!data.purchasedDivisions || data.purchasedDivisions.length < 1) {
    throw new ServiceError('At least one division must be purchased.');
  }
  for (const d of data.purchasedDivisions) {
    if (!DIVISIONS.includes(d)) throw new ServiceError(`Invalid division: ${d}`);
  }

  // Verify company exists
  const company = await deps.companyRepo.findById(companyId);
  if (!company) throw new ServiceError('Company not found.', 'NOT_FOUND', 404);

  // Verify plan exists
  const plan = await deps.planRepo.findByCode(data.planCode);
  if (!plan) throw new ServiceError(`Plan "${data.planCode}" not found.`, 'NOT_FOUND', 404);

  // Verify purchased divisions are subset of plan's available divisions
  for (const d of data.purchasedDivisions) {
    if (!plan.availableDivisions.includes(d)) {
      throw new ServiceError(
        `Division "${d}" is not available in plan "${plan.name}". Available: [${plan.availableDivisions.join(', ')}].`
      );
    }
  }

  const existing = await deps.subscriptionRepo.findByCompany(companyId);
  const subData = {
    companyId,
    planCode: data.planCode,
    planSnapshot: { code: plan.code, name: plan.name, availableDivisions: plan.availableDivisions },
    startDate: data.startDate || new Date(),
    endDate: data.endDate || null,
    trialEndsAt: data.trialEndsAt || null,
    status: data.status || 'active',
    billingStatus: data.billingStatus || 'na',
    billingCycle: data.billingCycle || 'Monthly',
    autoRenew: data.autoRenew || false,
    purchasedDivisions: data.purchasedDivisions,
    addOns: data.addOns || [],
    createdBy: actorId,
  };

  let result;
  if (existing) {
    const auditEntry = {
      action: 'updated',
      performedBy: actorId,
      performedAt: new Date(),
      details: { previousPlan: existing.planCode, newPlan: data.planCode, previousDivisions: existing.purchasedDivisions },
    };
    result = await deps.subscriptionRepo.update(existing.id, { ...subData, $push: { auditLog: auditEntry } });
  } else {
    subData.auditLog = [{ action: 'created', performedBy: actorId, performedAt: new Date() }];
    result = await deps.subscriptionRepo.create(subData);
  }

  // Sync Company.divisions with purchased divisions for compatibility
  await deps.companyRepo.updateFields(companyId, { divisions: data.purchasedDivisions });

  return result;
}

/**
 * Returns effective divisions for a company.
 * Priority: Subscription.purchasedDivisions > Company.divisions.
 * PWA FACT (coDivs, index.html:1215): a company with no division list is
 * treated as having all three divisions.
 */
async function getEffectiveDivisions(companyId, deps) {
  if (deps.subscriptionRepo) {
    const sub = await deps.subscriptionRepo.findByCompany(companyId);
    if (sub && sub.status !== 'cancelled' && sub.status !== 'expired') {
      return sub.purchasedDivisions || [];
    }
  }
  const company = await deps.companyRepo.findById(companyId);
  if (!company) return [];
  return company.divisions && company.divisions.length ? company.divisions : [...DIVISIONS];
}

/**
 * Server-side division entitlement (owner-approved: enforced in every
 * module that carries a division). `allowAmc` lets the Enquiry "AMC"
 * segment through, which the PWA always offers alongside the company's
 * divisions (index.html:1913, `myDivs().concat(["AMC"])`).
 */
async function assertDivisionEntitled(companyId, division, deps, { allowAmc = false } = {}) {
  if (allowAmc && division === 'AMC') return;
  const divisions = await getEffectiveDivisions(companyId, deps);
  if (!divisions.includes(division)) {
    throw new ServiceError(`Division "${division}" is not available for this company.`, 'DIVISION_NOT_ENTITLED', 403);
  }
}

module.exports = {
  DEFAULT_PLANS,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  seedDefaultPlans,
  getSubscription,
  createOrUpdateSubscription,
  getEffectiveDivisions,
  assertDivisionEntitled,
};
