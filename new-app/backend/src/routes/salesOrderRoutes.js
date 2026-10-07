'use strict';

const express = require('express');
const service = require('../services/salesOrderService');
const paymentService = require('../services/paymentService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * SalesOrder business API.
 *
 *   POST   /api/sales-orders                        standalone create (sales/admin, no Enquiry)
 *   GET    /api/sales-orders                         list/search/filter
 *   GET    /api/sales-orders/export.csv              CSV export (exact PWA dlSOs columns)
 *   GET    /api/sales-orders/:id                     detail (costing redacted for engineer/service_eng)
 *   PATCH  /api/sales-orders/:id                     plain field edit (no cascade re-run)
 *   POST   /api/sales-orders/:id/milestones/:mi/raise  raise a milestone to Finance (PM/admin)
 *
 * Enquiry -> SalesOrder conversion stays on POST /api/enquiries/:id/convert
 * (src/routes/enquiryRoutes.js) — this router is for the standalone path
 * and for reading/editing/reporting on ANY SalesOrder regardless of how it
 * was created, since both paths produce the identical entity shape.
 *
 * Role/tenant enforcement happens in the service layer — this router only
 * wires HTTP concerns, matching the pattern in enquiryRoutes.js.
 */
function createSalesOrderRouter(deps) {
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
        if (err && err.code === 'DUPLICATE_CONVERSION') {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        // eslint-disable-next-line no-console
        console.error('[salesOrderRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.post(
    '/',
    handle(async (req, res) => {
      const result = await service.createSalesOrder(req.body, req.auth, deps);
      return res.status(201).json(result);
    })
  );

  router.get(
    '/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportSalesOrdersCsv(req.auth, { filters: parseFilters(req.query) }, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="sales-orders.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const salesOrders = await service.listSalesOrders(req.auth, { filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ salesOrders });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const salesOrder = await service.getSalesOrder(req.params.id, req.auth, deps);
      return res.status(200).json({ salesOrder });
    })
  );

  router.patch(
    '/:id',
    handle(async (req, res) => {
      const salesOrder = await service.editSalesOrder(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ salesOrder });
    })
  );

  router.post(
    '/:id/milestones/:mi/raise',
    handle(async (req, res) => {
      const payment = await paymentService.raiseToFinance(req.params.id, Number(req.params.mi), req.body, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  return router;
}

function parseFilters(query) {
  if (!query) return {};
  const { q, division } = query;
  return { q, division };
}

module.exports = { createSalesOrderRouter };
