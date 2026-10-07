'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');

/**
 * Payment term templates — reusable sets of payment terms
 * that can be applied to quotations and other documents.
 */
function createPaymentTermTemplateRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  router.use(authMiddleware, requireCompanyContext);

  // List templates for company
  router.get('/', async (req, res) => {
    try {
      const filters = {};
      if (req.query.division) filters.division = req.query.division;
      if (req.query.documentType) filters.documentType = req.query.documentType;
      const templates = await deps.paymentTermTemplateRepo.listByCompany(req.auth.companyId, filters);
      return res.json({ templates });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Get single template
  router.get('/:templateId', async (req, res) => {
    try {
      const tpl = await deps.paymentTermTemplateRepo.findById(req.auth.companyId, req.params.templateId);
      if (!tpl) return res.status(404).json({ error: 'Payment term template not found.' });
      return res.json({ template: tpl });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Create template (admin/finance/sales)
  router.post('/', async (req, res) => {
    try {
      if (!['super', 'admin', 'finance', 'sales'].includes(req.auth.role)) {
        return res.status(403).json({ error: 'Not authorized to create payment term templates.' });
      }
      if (!req.body.name) return res.status(400).json({ error: 'Template name is required.' });
      if (!req.body.rows || !req.body.rows.length) {
        return res.status(400).json({ error: 'At least one payment term row is required.' });
      }
      const tpl = await deps.paymentTermTemplateRepo.create({
        companyId: req.auth.companyId,
        name: req.body.name,
        division: req.body.division || '',
        documentType: req.body.documentType || 'quotation',
        rows: req.body.rows,
        isDefault: req.body.isDefault || false,
      });
      return res.status(201).json({ template: tpl });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Update template
  router.patch('/:templateId', async (req, res) => {
    try {
      if (!['super', 'admin', 'finance', 'sales'].includes(req.auth.role)) {
        return res.status(403).json({ error: 'Not authorized to update payment term templates.' });
      }
      const existing = await deps.paymentTermTemplateRepo.findById(req.auth.companyId, req.params.templateId);
      if (!existing) return res.status(404).json({ error: 'Payment term template not found.' });
      const patch = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.division !== undefined) patch.division = req.body.division;
      if (req.body.documentType !== undefined) patch.documentType = req.body.documentType;
      if (req.body.rows !== undefined) patch.rows = req.body.rows;
      if (req.body.isDefault !== undefined) patch.isDefault = req.body.isDefault;
      const updated = await deps.paymentTermTemplateRepo.updateFields(
        req.auth.companyId, req.params.templateId, patch
      );
      return res.json({ template: updated });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Delete template
  router.delete('/:templateId', async (req, res) => {
    try {
      if (!['super', 'admin', 'finance', 'sales'].includes(req.auth.role)) {
        return res.status(403).json({ error: 'Not authorized to delete payment term templates.' });
      }
      const existing = await deps.paymentTermTemplateRepo.findById(req.auth.companyId, req.params.templateId);
      if (!existing) return res.status(404).json({ error: 'Payment term template not found.' });
      await deps.paymentTermTemplateRepo.delete(req.auth.companyId, req.params.templateId);
      return res.json({ deleted: true });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPaymentTermTemplateRouter };
