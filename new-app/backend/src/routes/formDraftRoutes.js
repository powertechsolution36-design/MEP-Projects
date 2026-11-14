'use strict';

/**
 * /api/form-drafts — half-filled quotation and sales-order forms.
 *
 *   GET    /api/form-drafts?kind=quotation|salesOrder   this person's drafts
 *   GET    /api/form-drafts/:id                         one draft, to resume
 *   POST   /api/form-drafts                             save, or re-save one
 *   DELETE /api/form-drafts/:id                         throw one away
 *
 * Owner request (14 Nov 2026). Nothing here numbers anything or creates
 * anything downstream — see services/formDraftService.js.
 */

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');
const service = require('../services/formDraftService');

function createFormDraftRouter(deps) {
  const router = express.Router();
  router.use(createAuthMiddleware(deps), requireCompanyContext, rejectClientSuppliedCompanyId);

  router.get('/', async (req, res) => {
    try {
      const drafts = await service.listDrafts(req.query.kind, req.auth, deps);
      return res.status(200).json({ drafts });
    } catch (err) {
      return sendError(res, err, 'formDraftRoutes');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const draft = await service.getDraft(req.params.id, req.auth, deps);
      return res.status(200).json({ draft });
    } catch (err) {
      return sendError(res, err, 'formDraftRoutes');
    }
  });

  router.post('/', async (req, res) => {
    try {
      const draft = await service.saveDraft(req.body, req.auth, deps);
      return res.status(req.body && req.body.id ? 200 : 201).json({ draft });
    } catch (err) {
      return sendError(res, err, 'formDraftRoutes');
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const result = await service.deleteDraft(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, 'formDraftRoutes');
    }
  });

  return router;
}

module.exports = { createFormDraftRouter };
