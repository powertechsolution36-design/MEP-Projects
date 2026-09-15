// Subscription lifecycle management — Super Admin / authorized commercial workflows only (caller
// authorizes; this service assumes it). "Do not allow a client user to directly assign itself a
// subscription" (V3 PHASE 3 spec §4) is enforced at the route layer (middleware/platform.js), not
// here — this module has no concept of "self-serve".
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const AddOn = require('../models/AddOn');
const DivisionEntitlement = require('../models/DivisionEntitlement');
const { audit } = require('./auditService');
const { validateAddOnAttach } = require('./commercialEntitlementService');
const { computeAndCacheEntitlements } = require('./entitlementResolutionService');

class SubscriptionServiceError extends Error {
  constructor(message, code = 'SUBSCRIPTION_ERROR') {
    super(message);
    this.code = code;
  }
}

function snapshotFromPlan(plan) {
  return {
    planId: plan._id,
    code: plan.code,
    name: plan.name,
    version: plan.version,
    billingCycle: plan.billingCycle,
    basePrice: plan.basePrice,
    currency: plan.currency,
    availableDivisions: plan.availableDivisions || [],
    forbiddenDivisions: plan.forbiddenDivisions || [],
    includedModules: plan.includedModules || [],
    defaultFeatures: plan.defaultFeatures || {},
    defaultLimits: plan.defaultLimits || {},
    trial: plan.trial || { enabled: false, days: 0 },
    snapshotAt: new Date(),
  };
}

/**
 * createSubscription() — PLAN_ENTITLEMENTS.md §10: exactly one 'active' Subscription per company.
 * If one already exists, this call is a PLAN SWITCH (§8): the old row is marked 'replaced' with
 * endDate=now, and a new row is created — never a mutation of the old row's planSnapshot.
 */
async function createSubscription({ req, companyId, planId, purchasedDivisions = [], source = 'plan', addOnCodes = [] }) {
  const plan = await Plan.findById(planId);
  if (!plan) throw new SubscriptionServiceError('Plan not found', 'NOT_FOUND');
  if (plan.status !== 'active' && plan.editable !== false) {
    // LEGACY_UNLIMITED (editable:false) is the one exception — it is never 'active' in the normal
    // catalog sense (visibility:'internal'), but migration is still allowed to assign it.
    throw new SubscriptionServiceError(`Plan ${plan.code} is not active/sellable`, 'PLAN_NOT_SELLABLE');
  }

  const invalidDivisions = purchasedDivisions.filter((d) => !(plan.availableDivisions || []).includes(d));
  if (invalidDivisions.length) {
    throw new SubscriptionServiceError(`Division(s) not available on plan ${plan.code}: ${invalidDivisions.join(', ')}`, 'INVALID_DIVISION');
  }

  const existing = await Subscription.findOne({ co: companyId, status: 'active' });
  const isSwitch = !!existing;

  const planSnapshot = snapshotFromPlan(plan);
  const now = new Date();
  const trialEndsAt = plan.trial?.enabled ? new Date(now.getTime() + plan.trial.days * 24 * 60 * 60 * 1000) : undefined;

  const subscription = await Subscription.create({
    co: companyId,
    planId: plan._id,
    planSnapshot,
    purchasedDivisions,
    addOns: [],
    status: trialEndsAt ? 'trial' : 'active',
    source,
    startDate: now,
    trialEndsAt,
    createdBy: req.user._id,
  });

  if (isSwitch) {
    existing.status = 'replaced';
    existing.endDate = now;
    existing.supersededBy = subscription._id;
    await existing.save();
  }

  for (const code of addOnCodes) {
    await addAddOn({ req, companyId, addOnCode: code, _skipRecompute: true });
  }

  await audit({
    req, action: isSwitch ? 'SUBSCRIPTION_CHANGED' : 'SUBSCRIPTION_CREATED', resource: 'subscription',
    resourceId: subscription._id, after: { planCode: plan.code, purchasedDivisions, status: subscription.status },
  });

  await computeAndCacheEntitlements(companyId);
  return subscription;
}

/**
 * changePlan() — thin alias for createSubscription() driving a plan switch; kept as its own named
 * entry point to match the route surface (`/subscriptions/:id/change-plan`, API_ARCHITECTURE.md §3).
 */
async function changePlan({ req, companyId, newPlanId, purchasedDivisions }) {
  return createSubscription({ req, companyId, planId: newPlanId, purchasedDivisions, source: 'plan' });
}

async function cancelSubscription({ req, subscriptionId, reason }) {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw new SubscriptionServiceError('Subscription not found', 'NOT_FOUND');
  if (subscription.status !== 'active' && subscription.status !== 'trial') {
    throw new SubscriptionServiceError(`Cannot cancel a subscription in status ${subscription.status}`, 'INVALID_STATE');
  }
  subscription.status = 'cancelled';
  subscription.endDate = new Date();
  await subscription.save();

  await audit({ req, action: 'SUBSCRIPTION_CANCELLED', resource: 'subscription', resourceId: subscription._id, reason, after: { status: 'cancelled' } });
  await computeAndCacheEntitlements(subscription.co);
  return subscription;
}

/**
 * addAddOn() — appends/reactivates an entry in Subscription.addOns[] after §5 validation. Never
 * rewrites purchasedDivisions or planSnapshot.
 */
async function addAddOn({ req, companyId, addOnCode, _skipRecompute = false }) {
  const subscription = await Subscription.findOne({ co: companyId, status: { $in: ['active', 'trial'] } });
  if (!subscription) throw new SubscriptionServiceError('No active subscription for this company', 'NOT_FOUND');

  const addOn = await AddOn.findOne({ code: addOnCode });
  const recentManualDivisionEntitlements = await DivisionEntitlement.find({ co: companyId, source: 'manual' }).lean();

  const validation = validateAddOnAttach({ addOn, planSnapshot: subscription.planSnapshot, recentManualDivisionEntitlements });
  if (!validation.valid) throw new SubscriptionServiceError(validation.reason, 'ADDON_INVALID');

  const existingEntry = subscription.addOns.find((a) => a.addOnCode === addOnCode);
  if (existingEntry) {
    existingEntry.active = true;
    existingEntry.activatedAt = new Date();
    existingEntry.activatedBy = req.user._id;
    existingEntry.deactivatedAt = undefined;
  } else {
    subscription.addOns.push({ addOnCode, active: true, activatedAt: new Date(), activatedBy: req.user._id });
  }
  await subscription.save();

  await audit({ req, action: 'ADDON_ASSIGNED', resource: 'subscription', resourceId: subscription._id, after: { addOnCode } });
  if (!_skipRecompute) await computeAndCacheEntitlements(companyId);
  return subscription;
}

async function removeAddOn({ req, companyId, addOnCode }) {
  const subscription = await Subscription.findOne({ co: companyId, status: { $in: ['active', 'trial'] } });
  if (!subscription) throw new SubscriptionServiceError('No active subscription for this company', 'NOT_FOUND');

  const entry = subscription.addOns.find((a) => a.addOnCode === addOnCode && a.active);
  if (!entry) throw new SubscriptionServiceError(`Add-on ${addOnCode} is not currently active on this subscription`, 'NOT_FOUND');
  entry.active = false;
  entry.deactivatedAt = new Date();
  entry.deactivatedBy = req.user._id;
  await subscription.save();

  await audit({ req, action: 'ADDON_REMOVED', resource: 'subscription', resourceId: subscription._id, after: { addOnCode } });
  await computeAndCacheEntitlements(companyId);
  return subscription;
}

module.exports = { createSubscription, changePlan, cancelSubscription, addAddOn, removeAddOn, snapshotFromPlan, SubscriptionServiceError };
