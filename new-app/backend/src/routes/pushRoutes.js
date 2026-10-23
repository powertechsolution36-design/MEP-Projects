'use strict';

const express = require('express');
const service = require('../services/pushService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Phone push registration (owner decision, 21 Oct 2026).
 *
 *   POST   /api/push-devices   { token, platform }  this phone receives the logged-in user's notifications
 *   DELETE /api/push-devices   { token }            stop (called on logout)
 */
function createPushRouter(deps) {
  const router = express.Router();
  router.use(createAuthMiddleware(deps), requireCompanyContext, rejectClientSuppliedCompanyId);

  const handle = (fn) => async (req, res) => {
    try {
      return await fn(req, res);
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message, code: err.code });
      // eslint-disable-next-line no-console
      console.error('[pushRoutes]', err);
      return res.status(500).json({ error: 'Internal error.' });
    }
  };

  router.post('/', handle(async (req, res) => res.status(200).json(await service.registerDevice(req.body, req.auth, deps))));
  router.delete('/', handle(async (req, res) => res.status(200).json(await service.unregisterDevice(req.body, req.auth, deps))));
  return router;
}

module.exports = { createPushRouter };
