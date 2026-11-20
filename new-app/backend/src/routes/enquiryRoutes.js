'use strict';

const express = require('express');
const service = require('../services/enquiryService');
const { ServiceError, mapPersistenceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Enquiry business API.
 *
 *   POST   /api/enquiries                    create (sales only)
 *   GET    /api/enquiries                    list/search/filter (Enquiry List scope, excludes Lost and Won)
 *   GET    /api/enquiries/lost               list/search/filter (Lost Enquiries scope)
 *   GET    /api/enquiries/won                list/search/filter (Won Enquiries scope, 20 Nov 2026)
 *   GET    /api/enquiries/reports/summary     segment/status reporting summary
 *   GET    /api/enquiries/reports/followups-due   follow-ups-due-today dashboard data
 *   GET    /api/enquiries/export.csv          CSV export (Enquiry List, or Lost via ?lost=true, or Won via ?won=true)
 *   GET    /api/enquiries/:id                 detail
 *   PATCH  /api/enquiries/:id                 direct field edit (no edit-history, #17 HOLD FOR #3)
 *   POST   /api/enquiries/:id/follow-ups      add a follow-up
 *   POST   /api/enquiries/:id/mark-lost       mark Lost
 *   POST   /api/enquiries/:id/reopen          reopen a Lost Enquiry (#18=A: lostReason/lostDate untouched)
 *   (POST /api/enquiries/:id/convert is gone — owner decision, 14 Nov 2026:
 *    a lead becomes an order through its quotation, POST /api/quotations/:id/convert)
 *
 * Role/tenant enforcement happens in the service layer (see
 * src/services/enquiryService.js) — this router only wires HTTP concerns
 * (auth, tenant-context guard, request/response shape, error translation).
 * Tenant isolation: requireCompanyContext + rejectClientSuppliedCompanyId
 * ensure every request's company scope comes ONLY from the authenticated
 * session, never from client-supplied body/query data.
 */
function createEnquiryRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  router.use(authMiddleware, requireCompanyContext, rejectClientSuppliedCompanyId);

  function handle(fn) {
    return async (req, res) => {
      try {
        const result = await fn(req, res);
        return result;
      } catch (err) {
        if (err instanceof ServiceError) {
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        if (err && err.code === 'DUPLICATE_CONVERSION') {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        const mapped = mapPersistenceError(err);
        if (mapped) return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
        // eslint-disable-next-line no-console
        console.error('[enquiryRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.post(
    '/',
    handle(async (req, res) => {
      const enquiry = await service.createEnquiry(req.body, req.auth, deps);
      return res.status(201).json({ enquiry });
    })
  );

  router.get(
    '/lost',
    handle(async (req, res) => {
      const enquiries = await service.listEnquiries(req.auth, { scope: 'lost', filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ enquiries });
    })
  );

  // Owner request (20 Nov 2026): a won lead leaves the Enquiry List and
  // gets a screen of its own, beside the lost ones.
  router.get(
    '/won',
    handle(async (req, res) => {
      const enquiries = await service.listEnquiries(req.auth, { scope: 'won', filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ enquiries });
    })
  );

  router.get(
    '/reports/summary',
    handle(async (req, res) => {
      const summary = await service.getSegmentSummary(req.auth, deps);
      return res.status(200).json({ summary });
    })
  );

  router.get(
    '/reports/followups-due',
    handle(async (req, res) => {
      const enquiries = await service.getFollowUpsDueToday(req.auth, deps);
      return res.status(200).json({ enquiries });
    })
  );

  router.get(
    '/export.csv',
    handle(async (req, res) => {
      // ?lost=true and ?won=true pick those screens' scopes; neither picks
      // the Enquiry List, which is the leads still being chased.
      const scope = req.query.lost === 'true' ? 'lost' : req.query.won === 'true' ? 'won' : 'open';
      const csv = await service.exportEnquiriesCsv(req.auth, { scope, filters: parseFilters(req.query) }, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="enquiries.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const enquiries = await service.listEnquiries(req.auth, { scope: 'open', filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ enquiries });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const enquiry = await service.getEnquiry(req.params.id, req.auth, deps);
      return res.status(200).json({ enquiry });
    })
  );

  router.patch(
    '/:id',
    handle(async (req, res) => {
      const enquiry = await service.editEnquiry(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ enquiry });
    })
  );

  router.post(
    '/:id/follow-ups',
    handle(async (req, res) => {
      const enquiry = await service.addFollowUp(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ enquiry });
    })
  );

  router.post(
    '/:id/mark-lost',
    handle(async (req, res) => {
      const enquiry = await service.markLost(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ enquiry });
    })
  );

  router.post(
    '/:id/reopen',
    handle(async (req, res) => {
      const enquiry = await service.reopenEnquiry(req.params.id, req.auth, deps);
      return res.status(200).json({ enquiry });
    })
  );

  // Owner request (20 Nov 2026): admin alone may delete. The service
  // refuses every other role, so this is not the only guard.
  router.delete(
    '/:id',
    handle(async (req, res) => {
      const result = await service.deleteEnquiry(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    })
  );


  return router;
}

function parseFilters(query) {
  if (!query) return {};
  const { q, segment, siteType, rating, status, referenceSource, reviewFrom, reviewTo, nextActionFrom, nextActionTo, valueMin, valueMax } = query;
  return { q, segment, siteType, rating, status, referenceSource, reviewFrom, reviewTo, nextActionFrom, nextActionTo, valueMin, valueMax };
}

module.exports = { createEnquiryRouter };
