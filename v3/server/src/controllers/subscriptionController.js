const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const Subscription = require('../models/Subscription');
const subscriptionService = require('../services/subscriptionService');

function handleServiceError(res, err) {
  const statusByCode = {
    NOT_FOUND: 404, INVALID_DIVISION: 422, PLAN_NOT_SELLABLE: 422, ADDON_INVALID: 400, INVALID_STATE: 409,
  };
  const status = statusByCode[err.code];
  if (status) return sendError(res, status, err.message, { code: err.code });
  throw err;
}

// GET /subscriptions/:id — tenant-scoped read: Super Admin may read any; a Company Admin/Manager may
// only read their own company's subscription (enforced here, not left to req.tenantCompanyId alone,
// since a subscription's companyId comes from the record itself, not the URL).
const getSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id).lean();
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  if (req.user.role !== 'super' && String(subscription.co) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  res.json({ subscription });
});

const createSubscription = asyncHandler(async (req, res) => {
  try {
    const subscription = await subscriptionService.createSubscription({
      req, companyId: req.body.targetCompanyId, planId: req.body.planId,
      purchasedDivisions: req.body.purchasedDivisions, source: req.body.source || 'plan',
      addOnCodes: req.body.addOnCodes || [],
    });
    res.status(201).json({ subscription });
  } catch (err) { handleServiceError(res, err); }
});

const changePlan = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id).lean();
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  try {
    const result = await subscriptionService.changePlan({
      req, companyId: subscription.co, newPlanId: req.body.newPlanId, purchasedDivisions: req.body.purchasedDivisions,
    });
    res.json({ subscription: result });
  } catch (err) { handleServiceError(res, err); }
});

const cancelSubscription = asyncHandler(async (req, res) => {
  try {
    const subscription = await subscriptionService.cancelSubscription({ req, subscriptionId: req.params.id, reason: req.body.reason });
    res.json({ subscription });
  } catch (err) { handleServiceError(res, err); }
});

const addAddon = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id).lean();
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  try {
    const result = await subscriptionService.addAddOn({ req, companyId: subscription.co, addOnCode: req.body.addOnCode });
    res.json({ subscription: result });
  } catch (err) { handleServiceError(res, err); }
});

const removeAddon = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id).lean();
  if (!subscription) return sendError(res, 404, 'Subscription not found');
  try {
    const result = await subscriptionService.removeAddOn({ req, companyId: subscription.co, addOnCode: req.body.addOnCode });
    res.json({ subscription: result });
  } catch (err) { handleServiceError(res, err); }
});

module.exports = { getSubscription, createSubscription, changePlan, cancelSubscription, addAddon, removeAddon };
