// Thin controllers — all business logic lives in services/planService.js.
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const Plan = require('../models/Plan');
const planService = require('../services/planService');

const listPlans = asyncHandler(async (req, res) => {
  // Only sellable/active plans are shown to a non-platform-admin caller; a platform admin sees the
  // full catalog including drafts/archived versions for management purposes.
  const filter = req.__isPlatformAdmin ? {} : { status: 'active', sellable: true, visibility: 'public' };
  const plans = await Plan.find(filter).sort({ code: 1, version: -1 }).lean();
  res.json({ plans });
});

const getPlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id).lean();
  if (!plan) return sendError(res, 404, 'Plan not found');
  res.json({ plan });
});

const createPlan = asyncHandler(async (req, res) => {
  const plan = await planService.createPlan({ req, data: req.body });
  res.status(201).json({ plan });
});

const updatePlan = asyncHandler(async (req, res) => {
  try {
    const plan = await planService.updatePlan({ req, planId: req.params.id, changes: req.body });
    res.json({ plan });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return sendError(res, 404, err.message);
    if (err.code === 'NOT_EDITABLE') return sendError(res, 409, err.message);
    throw err;
  }
});

const activatePlan = asyncHandler(async (req, res) => {
  try {
    const plan = await planService.activatePlan({ req, planId: req.params.id });
    res.json({ plan });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return sendError(res, 404, err.message);
    throw err;
  }
});

const deactivatePlan = asyncHandler(async (req, res) => {
  try {
    const plan = await planService.deactivatePlan({ req, planId: req.params.id });
    res.json({ plan });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return sendError(res, 404, err.message);
    if (err.code === 'NOT_EDITABLE') return sendError(res, 409, err.message);
    throw err;
  }
});

module.exports = { listPlans, getPlan, createPlan, updatePlan, activatePlan, deactivatePlan };
