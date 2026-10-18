'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, requireOwnCompany } = require('../middleware/tenantGuard');
const {
  getTemplate, saveTemplate, generateAmcDocument, listTemplates,
} = require('../services/amcDocumentService');

function createAmcDocumentRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // All AMC document routes require auth + company context
  router.use(authMiddleware, requireCompanyContext);

  // ── Templates ──

  // List templates (system defaults + company overrides)
  router.get('/templates', async (req, res) => {
    try {
      const templates = await listTemplates(req.auth.companyId, deps);
      return res.json({ templates });
    } catch (err) {
      return sendError(res, err, 'amcDocumentRoutes');
    }
  });

  // Get single template by type
  router.get('/templates/:type', async (req, res) => {
    try {
      const template = await getTemplate(req.auth.companyId, req.params.type, deps);
      return res.json({ template });
    } catch (err) {
      return sendError(res, err, 'amcDocumentRoutes');
    }
  });

  // Save/update company template (admin only)
  router.put('/templates', requireOwnCompany, async (req, res) => {
    try {
      if (!['super', 'admin'].includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only admin can modify templates.' });
      }
      const template = await saveTemplate(req.auth.companyId, req.body, deps);
      return res.json({ template });
    } catch (err) {
      return sendError(res, err, 'amcDocumentRoutes');
    }
  });

  // ── Document generation ──

  // Generate AMC document data from contract + profile + template
  router.get('/generate/:contractId/:templateType', async (req, res) => {
    try {
      const doc = await generateAmcDocument(
        req.auth.companyId,
        req.params.contractId,
        req.params.templateType,
        deps
      );
      return res.json({ document: doc });
    } catch (err) {
      return sendError(res, err, 'amcDocumentRoutes');
    }
  });

  return router;
}

module.exports = { createAmcDocumentRouter };
