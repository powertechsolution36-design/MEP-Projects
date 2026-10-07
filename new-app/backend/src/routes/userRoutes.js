'use strict';

const express = require('express');
const service = require('../services/userService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * User Management API (FIX-3.8-01, P0).
 *
 *   GET    /api/users        list this company's users (admin only)
 *   GET    /api/users/:id      single user detail (admin only)
 *   POST   /api/users        create a user + role assignment (admin only)
 *   PATCH  /api/users/:id      edit name/username/role/password (admin only)
 *   DELETE /api/users/:id      remove a user, hard delete, no cascade (admin only; cannot remove self)
 *
 * Role/tenant enforcement happens in the service layer (src/services/userService.js),
 * matching the pattern in checklistTemplateRoutes.js/projectRoutes.js.
 * Company context is fixed to req.auth.companyId only (rejectClientSuppliedCompanyId) —
 * a caller can never operate on another company's users.
 */
function createUserRouter(deps) {
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
        console.error('[userRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/',
    handle(async (req, res) => {
      const users = await service.listUsers(req.auth, deps);
      return res.status(200).json({ users });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const user = await service.getUser(req.params.id, req.auth, deps);
      return res.status(200).json({ user });
    })
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const user = await service.createUser(req.body, req.auth, deps);
      return res.status(201).json({ user }); // never includes a password/hash
    })
  );

  router.patch(
    '/:id',
    handle(async (req, res) => {
      const user = await service.updateUser(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ user });
    })
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      const result = await service.deleteUser(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    })
  );

  return router;
}

module.exports = { createUserRouter };
