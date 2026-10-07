'use strict';

const express = require('express');
const service = require('../services/notificationService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Notification read-side API (FIX-B1).
 *
 *   GET   /api/notifications           list, role/company-scoped (PWA `myNotifs()`)
 *   PATCH /api/notifications/:id/read    mark read for the acting user (PWA `vNotifs()`'s per-item read call)
 *
 * No create route here -- every module's service already creates
 * notifications directly via `notificationRepo.create()` as a side effect
 * of its own business actions (SalesOrder/Project/Contract/ServiceCall/
 * Payment/Inventory); this router only adds the previously-missing
 * read/list path.
 */
function createNotificationRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);
  router.use(authMiddleware, requireCompanyContext, rejectClientSuppliedCompanyId);

  function handle(fn) {
    return async (req, res) => {
      try {
        return await fn(req, res);
      } catch (err) {
        if (err instanceof ServiceError) {
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        // eslint-disable-next-line no-console
        console.error('[notificationRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/',
    handle(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const notifications = await service.listNotifications(req.auth, { limit }, deps);
      return res.status(200).json({ notifications });
    })
  );

  router.patch(
    '/:id/read',
    handle(async (req, res) => {
      const notification = await service.markNotificationRead(req.params.id, req.auth, deps);
      return res.status(200).json({ notification });
    })
  );

  return router;
}

module.exports = { createNotificationRouter };
