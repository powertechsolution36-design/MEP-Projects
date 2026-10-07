'use strict';

const express = require('express');
const service = require('../services/checklistTemplateService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Checklist Template Library API (FIX-3.3-01).
 *
 *   GET    /api/checklist-templates                    list (optionally ?division=HVAC|Solar|MEP)
 *   GET    /api/checklist-templates/:id                  detail
 *   POST   /api/checklist-templates                     create (optional sourceTemplateId to start-from-copy)
 *   POST   /api/checklist-templates/:id/duplicate         duplicate
 *   PATCH  /api/checklist-templates/:id/rename             rename
 *   POST   /api/checklist-templates/:id/set-default        set as division default
 *   DELETE /api/checklist-templates/:id                   delete (min 1 per division enforced)
 *   POST   /api/checklist-templates/:id/items              add a point
 *   PATCH  /api/checklist-templates/:id/items/:i             edit a point
 *   DELETE /api/checklist-templates/:id/items/:i             remove a point
 *   POST   /api/checklist-templates/:id/items/:i/move        reorder (body: { direction: -1 | 1 })
 *
 * Role/tenant enforcement happens in the service layer (canEditChecklistLibrary),
 * matching the pattern in projectRoutes.js/contractRoutes.js.
 */
function createChecklistTemplateRouter(deps) {
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
        console.error('[checklistTemplateRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/',
    handle(async (req, res) => {
      const templates = await service.listTemplates(req.auth, { division: req.query.division }, deps);
      return res.status(200).json({ templates });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const template = await service.getTemplate(req.params.id, req.auth, deps);
      return res.status(200).json({ template });
    })
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const template = await service.createTemplate(req.body, req.auth, deps);
      return res.status(201).json({ template });
    })
  );

  router.post(
    '/:id/duplicate',
    handle(async (req, res) => {
      const template = await service.duplicateTemplate(req.params.id, req.auth, deps);
      return res.status(201).json({ template });
    })
  );

  router.patch(
    '/:id/rename',
    handle(async (req, res) => {
      const template = await service.renameTemplate(req.params.id, req.body && req.body.name, req.auth, deps);
      return res.status(200).json({ template });
    })
  );

  router.post(
    '/:id/set-default',
    handle(async (req, res) => {
      const template = await service.setDefaultTemplate(req.params.id, req.auth, deps);
      return res.status(200).json({ template });
    })
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      const result = await service.deleteTemplate(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    })
  );

  router.post(
    '/:id/items',
    handle(async (req, res) => {
      const template = await service.addTemplateItem(req.params.id, req.body, req.auth, deps);
      return res.status(201).json({ template });
    })
  );

  router.patch(
    '/:id/items/:i',
    handle(async (req, res) => {
      const template = await service.editTemplateItem(req.params.id, Number(req.params.i), req.body, req.auth, deps);
      return res.status(200).json({ template });
    })
  );

  router.delete(
    '/:id/items/:i',
    handle(async (req, res) => {
      const template = await service.removeTemplateItem(req.params.id, Number(req.params.i), req.auth, deps);
      return res.status(200).json({ template });
    })
  );

  router.post(
    '/:id/items/:i/move',
    handle(async (req, res) => {
      const template = await service.moveTemplateItem(
        req.params.id,
        Number(req.params.i),
        req.body && req.body.direction,
        req.auth,
        deps
      );
      return res.status(200).json({ template });
    })
  );

  return router;
}

module.exports = { createChecklistTemplateRouter };
