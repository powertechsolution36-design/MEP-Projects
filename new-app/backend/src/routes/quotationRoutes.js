'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/roleMiddleware');
const {
  createQuotation, updateQuotation, getQuotation, convertQuotationToSalesOrder,
  listQuotations, duplicateQuotation, deleteQuotation, exportQuotationsCsv,
  getPdfLink,
  VIEW_ROLES, EDIT_ROLES, COMMERCIAL_ROLES, divisionScope, assertDivisionVisible,
} = require('../services/quotationService');

function createQuotationRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // All quotation routes require auth + company context, and one of the
  // roles that has the Quotations menu: the commercial roles (admin, sales,
  // finance; super for support) and, since 18 Nov 2026, the three division
  // Managers — confined to their own division by assertDivisionVisible,
  // and still kept off raising, duplicating, deleting and exporting.
  router.use(authMiddleware, requireCompanyContext, requireRole(...VIEW_ROLES));

  // Owner decision (14 Nov 2026): the customer accepted it — turn it into
  // the sales order, its project and its payment milestones, and mark the
  // lead behind it Won. The only route from a lead to an order.
  router.post('/:id/convert', async (req, res) => {
    try {
      const result = await convertQuotationToSalesOrder(req.params.id, req.body, req.auth, deps);
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // List quotations (with optional filters)
  router.get('/', async (req, res) => {
    try {
      const filters = {};
      if (req.query.division) filters.division = req.query.division;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.customerName) filters.customerName = req.query.customerName;
      // A Manager's register is their own division's, whatever they ask for.
      const mine = divisionScope(req.auth);
      if (mine) filters.division = mine;
      const quotations = await listQuotations(req.auth.companyId, filters, deps);
      return res.json({ quotations });
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Export CSV
  router.get('/export/csv', requireRole(...COMMERCIAL_ROLES), async (req, res) => {
    try {
      const csv = await exportQuotationsCsv(req.auth.companyId, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=quotations.csv');
      return res.send(csv);
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Client-facing PDF link for this quotation
  router.get('/:quotationId/pdf-link', async (req, res) => {
    try {
      assertDivisionVisible(req.auth, await getQuotation(req.auth.companyId, req.params.quotationId, deps));
      const link = await getPdfLink(req.auth.companyId, req.params.quotationId, deps);
      return res.json(link);
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Get single quotation
  router.get('/:quotationId', async (req, res) => {
    try {
      const q = await getQuotation(req.auth.companyId, req.params.quotationId, deps);
      assertDivisionVisible(req.auth, q);
      return res.json({ quotation: q });
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Create quotation (the commercial roles only)
  router.post('/', requireRole(...COMMERCIAL_ROLES), async (req, res) => {
    try {
      const q = await createQuotation(req.auth.companyId, req.body, req.auth.userId, deps);
      return res.status(201).json({ quotation: q });
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Update quotation — the commercial roles, and a Manager on their own
  // division's (owner request, 18 Nov 2026).
  router.patch('/:quotationId', requireRole(...EDIT_ROLES), async (req, res) => {
    try {
      assertDivisionVisible(req.auth, await getQuotation(req.auth.companyId, req.params.quotationId, deps));
      const q = await updateQuotation(
        req.auth.companyId, req.params.quotationId, req.body, req.auth.userId, deps
      );
      return res.json({ quotation: q });
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Duplicate quotation (the commercial roles only)
  router.post('/:quotationId/duplicate', requireRole(...COMMERCIAL_ROLES), async (req, res) => {
    try {
      const q = await duplicateQuotation(
        req.auth.companyId, req.params.quotationId, req.auth.userId, deps
      );
      return res.status(201).json({ quotation: q });
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  // Delete quotation (Draft/Cancelled only). Owner request (20 Nov 2026):
  // "delete button only in Admin login" — sales had this and no longer does.
  router.delete('/:quotationId', requireRole('super', 'admin'), async (req, res) => {
    try {
      const result = await deleteQuotation(req.auth.companyId, req.params.quotationId, deps);
      return res.json(result);
    } catch (err) {
      return sendError(res, err, 'quotationRoutes');
    }
  });

  return router;
}

module.exports = { createQuotationRouter };
