'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/roleMiddleware');
const {
  createQuotation, updateQuotation, getQuotation,
  listQuotations, duplicateQuotation, deleteQuotation, exportQuotationsCsv,
} = require('../services/quotationService');

function createQuotationRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // All quotation routes require auth + company context
  router.use(authMiddleware, requireCompanyContext);

  // List quotations (with optional filters)
  router.get('/', async (req, res) => {
    try {
      const filters = {};
      if (req.query.division) filters.division = req.query.division;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.customerName) filters.customerName = req.query.customerName;
      const quotations = await listQuotations(req.auth.companyId, filters, deps);
      return res.json({ quotations });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Export CSV
  router.get('/export/csv', async (req, res) => {
    try {
      const csv = await exportQuotationsCsv(req.auth.companyId, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=quotations.csv');
      return res.send(csv);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Get single quotation
  router.get('/:quotationId', async (req, res) => {
    try {
      const q = await getQuotation(req.auth.companyId, req.params.quotationId, deps);
      return res.json({ quotation: q });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Create quotation (admin, sales, finance only)
  router.post('/', requireRole('super', 'admin', 'sales', 'finance'), async (req, res) => {
    try {
      const q = await createQuotation(req.auth.companyId, req.body, req.auth.userId, deps);
      return res.status(201).json({ quotation: q });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Update quotation (admin, sales, finance only)
  router.patch('/:quotationId', requireRole('super', 'admin', 'sales', 'finance'), async (req, res) => {
    try {
      const q = await updateQuotation(
        req.auth.companyId, req.params.quotationId, req.body, req.auth.userId, deps
      );
      return res.json({ quotation: q });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Duplicate quotation (admin, sales, finance only)
  router.post('/:quotationId/duplicate', requireRole('super', 'admin', 'sales', 'finance'), async (req, res) => {
    try {
      const q = await duplicateQuotation(
        req.auth.companyId, req.params.quotationId, req.auth.userId, deps
      );
      return res.status(201).json({ quotation: q });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Delete quotation (Draft/Cancelled only; admin, sales only)
  router.delete('/:quotationId', requireRole('super', 'admin', 'sales'), async (req, res) => {
    try {
      const result = await deleteQuotation(req.auth.companyId, req.params.quotationId, deps);
      return res.json(result);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createQuotationRouter };
