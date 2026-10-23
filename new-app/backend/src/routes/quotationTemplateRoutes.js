'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/roleMiddleware');
const { TEMPLATE_FIELDS } = require('../services/quotationService');

/**
 * Quotation starting points — the saved wording for each kind of offer
 * (Split, Ductable, VRF, Solar …), applied when a quotation is created.
 *
 * Repository-backed, like paymentTermTemplateRoutes: there is no business
 * logic here beyond picking out the fields a template is allowed to carry.
 */
function createQuotationTemplateRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // Same roles as the Quotations menu — a starting point carries pricing wording.
  router.use(authMiddleware, requireCompanyContext, requireRole('super', 'admin', 'sales', 'finance'));

  /** Only the fields a starting point is allowed to carry. */
  function pickTemplateFields(body) {
    const out = {};
    for (const f of TEMPLATE_FIELDS) {
      if (body[f] !== undefined) out[f] = body[f];
    }
    for (const f of ['excludedWorks', 'paymentTerms', 'equipmentItems', 'accessoriesItems']) {
      if (out[f] !== undefined && !Array.isArray(out[f])) out[f] = [];
    }
    return out;
  }

  router.get('/', async (req, res) => {
    try {
      const filters = {};
      if (req.query.division) filters.division = req.query.division;
      const templates = await deps.quotationTemplateRepo.listByCompany(req.auth.companyId, filters);
      return res.json({ templates });
    } catch (err) {
      return sendError(res, err, 'quotationTemplateRoutes');
    }
  });

  router.get('/:templateId', async (req, res) => {
    try {
      const tpl = await deps.quotationTemplateRepo.findById(req.auth.companyId, req.params.templateId);
      if (!tpl) return res.status(404).json({ error: 'Quotation starting point not found.' });
      return res.json({ template: tpl });
    } catch (err) {
      return sendError(res, err, 'quotationTemplateRoutes');
    }
  });

  router.post('/', requireRole('super', 'admin', 'sales'), async (req, res) => {
    try {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Give the starting point a name.' });
      if (!req.body.division) return res.status(400).json({ error: 'Division is required.' });
      const isDefault = req.body.isDefault === true;
      const tpl = await deps.quotationTemplateRepo.create({
        ...pickTemplateFields(req.body),
        companyId: req.auth.companyId,
        name,
        division: req.body.division,
        isDefault,
      });
      // At most one automatic starting point per division.
      if (isDefault) await deps.quotationTemplateRepo.clearDefaults(req.auth.companyId, tpl.division, tpl.id);
      return res.status(201).json({ template: tpl });
    } catch (err) {
      return sendError(res, err, 'quotationTemplateRoutes');
    }
  });

  router.patch('/:templateId', requireRole('super', 'admin', 'sales'), async (req, res) => {
    try {
      const patch = pickTemplateFields(req.body);
      if (typeof req.body.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
      if (req.body.division) patch.division = req.body.division;
      if (typeof req.body.isDefault === 'boolean') patch.isDefault = req.body.isDefault;
      const tpl = await deps.quotationTemplateRepo.updateFields(req.auth.companyId, req.params.templateId, patch);
      if (!tpl) return res.status(404).json({ error: 'Quotation starting point not found.' });
      if (patch.isDefault === true) await deps.quotationTemplateRepo.clearDefaults(req.auth.companyId, tpl.division, tpl.id);
      return res.json({ template: tpl });
    } catch (err) {
      return sendError(res, err, 'quotationTemplateRoutes');
    }
  });

  router.delete('/:templateId', requireRole('super', 'admin', 'sales'), async (req, res) => {
    try {
      const tpl = await deps.quotationTemplateRepo.findById(req.auth.companyId, req.params.templateId);
      if (!tpl) return res.status(404).json({ error: 'Quotation starting point not found.' });
      await deps.quotationTemplateRepo.delete(req.auth.companyId, req.params.templateId);
      return res.json({ deleted: true });
    } catch (err) {
      return sendError(res, err, 'quotationTemplateRoutes');
    }
  });

  return router;
}

module.exports = { createQuotationTemplateRouter };
