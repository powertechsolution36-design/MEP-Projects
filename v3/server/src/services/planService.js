// Plan catalog management — Super Admin only (enforced by the caller via middleware/platform.js's
// requirePlatformAdmin, not re-checked here; this service assumes the caller has already
// authorized). Implements safe versioning (V3 PHASE 3 spec §3/§13, models/Plan.js header): editing a
// Plan with existing subscriptions referencing it never mutates those subscriptions' terms.
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { audit } = require('./auditService');
const { LEGACY_UNLIMITED_PLAN_CODE } = require('../config/constants');

class PlanServiceError extends Error {
  constructor(message, code = 'PLAN_ERROR') {
    super(message);
    this.code = code;
  }
}

function assertEditable(plan) {
  if (plan.editable === false || plan.code === LEGACY_UNLIMITED_PLAN_CODE) {
    throw new PlanServiceError(`Plan ${plan.code} is not editable (system/migration-only)`, 'NOT_EDITABLE');
  }
}

async function createPlan({ req, data }) {
  const plan = await Plan.create({ ...data, version: 1, createdBy: req.user._id });
  await audit({ req, action: 'PLAN_CREATED', resource: 'plan', resourceId: plan._id, after: { code: plan.code, version: plan.version } });
  return plan;
}

/**
 * updatePlan() — if the plan has no subscriptions referencing it (never sold yet, e.g. still
 * 'draft'), it may be edited in place. Otherwise a NEW Plan document is created with the same
 * `code`, `version + 1`, `supersedes` pointing at the old plan, and the old plan is archived — so
 * existing Subscription.planSnapshot rows (frozen at signup) are never retroactively affected, and
 * the live Plan a NEW subscription would reference is always the latest version.
 */
async function updatePlan({ req, planId, changes }) {
  const plan = await Plan.findById(planId);
  if (!plan) throw new PlanServiceError('Plan not found', 'NOT_FOUND');
  assertEditable(plan);

  const referencedCount = await Subscription.countDocuments({ planId: plan._id });

  if (referencedCount === 0) {
    Object.assign(plan, changes);
    await plan.save();
    await audit({ req, action: 'PLAN_UPDATED', resource: 'plan', resourceId: plan._id, after: { code: plan.code, version: plan.version, inPlace: true } });
    return plan;
  }

  const newVersionData = plan.toObject();
  delete newVersionData._id;
  delete newVersionData.createdAt;
  delete newVersionData.updatedAt;
  const newPlan = await Plan.create({
    ...newVersionData,
    ...changes,
    version: plan.version + 1,
    supersedes: plan._id,
    createdBy: req.user._id,
  });

  plan.status = 'archived';
  await plan.save();

  await audit({ req, action: 'PLAN_UPDATED', resource: 'plan', resourceId: newPlan._id, after: { code: newPlan.code, version: newPlan.version, supersedes: plan._id, inPlace: false } });
  return newPlan;
}

async function activatePlan({ req, planId }) {
  const plan = await Plan.findById(planId);
  if (!plan) throw new PlanServiceError('Plan not found', 'NOT_FOUND');
  plan.status = 'active';
  await plan.save();
  await audit({ req, action: 'PLAN_ACTIVATED', resource: 'plan', resourceId: plan._id, after: { code: plan.code, status: 'active' } });
  return plan;
}

async function deactivatePlan({ req, planId }) {
  const plan = await Plan.findById(planId);
  if (!plan) throw new PlanServiceError('Plan not found', 'NOT_FOUND');
  if (plan.code === LEGACY_UNLIMITED_PLAN_CODE) {
    throw new PlanServiceError('LEGACY_UNLIMITED cannot be deactivated — system/migration-only', 'NOT_EDITABLE');
  }
  plan.status = 'inactive';
  await plan.save();
  await audit({ req, action: 'PLAN_DEACTIVATED', resource: 'plan', resourceId: plan._id, after: { code: plan.code, status: 'inactive' } });
  return plan;
}

module.exports = { createPlan, updatePlan, activatePlan, deactivatePlan, PlanServiceError };
