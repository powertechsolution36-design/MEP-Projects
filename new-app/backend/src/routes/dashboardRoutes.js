'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const { getDashboard } = require('../services/dashboardService');

/**
 * GET /api/dashboard — the role dashboard (PWA `vDash()`), computed from
 * the caller's own company only. See services/dashboardService.js.
 */
function createDashboardRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);
  router.use(authMiddleware, requireCompanyContext);

  router.get('/', async (req, res) => {
    try {
      const dashboard = await getDashboard(req.auth, deps);
      return res.json({ dashboard });
    } catch (err) {
      return sendError(res, err, 'dashboardRoutes');
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
