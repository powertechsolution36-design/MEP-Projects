'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const {
  listPlans, getPlan, createPlan, updatePlan, seedDefaultPlans,
  getSubscription, createOrUpdateSubscription, getEffectiveDivisions,
} = require('../services/subscriptionService');

function createSubscriptionRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // ── Plan catalog (super-only management, readable by all) ──

  // The plan catalogue (pricing) belongs to the Super Admin Subscriptions screen only.
  router.get('/plans', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const plans = await listPlans(deps);
      return res.json({ plans });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  router.get('/plans/:code', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const plan = await getPlan(req.params.code, deps);
      return res.json({ plan });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  router.post('/plans', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const plan = await createPlan(req.body, deps);
      return res.status(201).json({ plan });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  router.patch('/plans/:code', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const plan = await updatePlan(req.params.code, req.body, deps);
      return res.json({ plan });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  router.post('/plans/seed', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const plans = await seedDefaultPlans(deps);
      return res.json({ plans, seeded: true });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  // ── Company subscription (super manages, company reads own) ──

  router.get('/company/:companyId', authMiddleware, async (req, res) => {
    try {
      // Non-super can only see their own
      if (req.auth.role !== 'super' && String(req.auth.companyId) !== String(req.params.companyId)) {
        return res.status(403).json({ error: 'Cannot view another company\'s subscription.' });
      }
      const sub = await getSubscription(req.params.companyId, deps);
      return res.json({ subscription: sub || null });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  router.post('/company/:companyId', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const sub = await createOrUpdateSubscription(
        req.params.companyId, req.body, req.auth.userId, deps
      );
      return res.status(201).json({ subscription: sub });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  // ── Effective divisions for current user's company ──

  router.get('/my-divisions', authMiddleware, requireCompanyContext, async (req, res) => {
    try {
      const divisions = await getEffectiveDivisions(req.auth.companyId, deps);
      return res.json({ divisions });
    } catch (err) {
      return sendError(res, err, 'subscriptionRoutes');
    }
  });

  return router;
}

module.exports = { createSubscriptionRouter };
