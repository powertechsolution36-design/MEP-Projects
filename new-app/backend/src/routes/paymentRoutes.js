'use strict';

const express = require('express');
const service = require('../services/paymentService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Payment / Finance business API.
 *
 *   GET    /api/payments                              list (optional ?status=Pending|Received)
 *   GET    /api/payments/export/pending.csv            pending-payments CSV
 *   GET    /api/payments/export/receipts.csv           receipts ledger CSV (exact PWA dlReceipts columns)
 *   POST   /api/payments                                manual pending entry (no SO link)
 *   GET    /api/payments/:id                            detail
 *   PATCH  /api/payments/:id/milestone                  edit the milestone/reference record (savePayEdit)
 *   POST   /api/payments/:id/follow-up                  lastCall/nextCall/disc/remark (savePayFollow)
 *   POST   /api/payments/:id/part-payments               add a part-payment (addPayment)
 *   PATCH  /api/payments/:id/part-payments/:partId       edit a part-payment entry (saveEditPayment)
 *   DELETE /api/payments/:id/part-payments/:partId       remove one entry (delPayment)
 *   DELETE /api/payments/:id                              delete whole record — only if not SO-linked (delPayRow)
 *
 * Raising a milestone to Finance is exposed under the SalesOrder router
 * (POST /api/sales-orders/:id/milestones/:mi/raise) since the PWA's `mRaise`
 * is invoked from the Project/SO side, not the Payments screen.
 */
function createPaymentRouter(deps) {
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
        console.error('[paymentRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/export/pending.csv',
    handle(async (req, res) => {
      const csv = await service.exportPendingPaymentsCsv(req.auth, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pending-payments.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/export/receipts.csv',
    handle(async (req, res) => {
      const csv = await service.exportReceiptsCsv(req.auth, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payment-receipts.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const payments = await service.listPayments(req.auth, { status: req.query.status }, deps);
      return res.status(200).json({ payments });
    })
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const payment = await service.createManualPayment(req.body, req.auth, deps);
      return res.status(201).json({ payment });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const payment = await service.getPayment(req.params.id, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  router.patch(
    '/:id/milestone',
    handle(async (req, res) => {
      const payment = await service.editMilestone(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  router.post(
    '/:id/follow-up',
    handle(async (req, res) => {
      const payment = await service.addFollowUp(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  router.post(
    '/:id/part-payments',
    handle(async (req, res) => {
      const payment = await service.addPartPayment(req.params.id, req.body, req.auth, deps);
      return res.status(201).json({ payment });
    })
  );

  router.patch(
    '/:id/part-payments/:partId',
    handle(async (req, res) => {
      const payment = await service.editPartPayment(req.params.id, req.params.partId, req.body, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  router.delete(
    '/:id/part-payments/:partId',
    handle(async (req, res) => {
      const payment = await service.removePartPayment(req.params.id, req.params.partId, req.auth, deps);
      return res.status(200).json({ payment });
    })
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      await service.deletePaymentRecord(req.params.id, req.auth, deps);
      return res.status(204).send();
    })
  );

  return router;
}

module.exports = { createPaymentRouter };
