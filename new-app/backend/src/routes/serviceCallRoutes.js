'use strict';

const express = require('express');
const service = require('../services/serviceCallService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * ServiceCall (Complaint / PM visit) business API.
 *
 *   GET  /api/service-calls                     list/search register (admin/service_mgr -- PWA FACT §18)
 *   GET  /api/service-calls/open                 Open Service Calls dashboard panel (admin/service_mgr)
 *   GET  /api/service-calls/export.csv            report export (admin/service_mgr)
 *   GET  /api/service-calls/:id                   detail (any company member -- tenant-scoped only, §20)
 *   POST /api/service-calls/complaints             register a Complaint (admin/service_mgr)
 *   POST /api/service-calls/pm/:contractId          schedule a PM visit from a Contract (admin/service_mgr)
 *   PUT  /api/service-calls/:id/assign              assign/reassign/clear engineer + date/time (admin/service_mgr)
 *   PUT  /api/service-calls/:id/report              save report draft (assigned engineer or admin/service_mgr)
 *   POST /api/service-calls/:id/complete            complete the call (assigned engineer or admin/service_mgr)
 *
 * No edit/delete/cancel/reopen route exists for any role -- the PWA has
 * none (SERVICECALL_DECISION_LOCK.md §21 item 14 / §23 item 13).
 */
function createServiceCallRouter(deps) {
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
        console.error('[serviceCallRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/open',
    handle(async (req, res) => {
      const serviceCalls = await service.getOpenServiceCalls(req.auth, deps);
      return res.status(200).json({ serviceCalls });
    })
  );

  router.get(
    '/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportServiceCallsCsv(req.auth, { filters: parseFilters(req.query) }, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="service-call-register.csv"`);
      return res.status(200).send(csv);
    })
  );

  /* Engineer candidates for service-call assignment dropdown (infrastructure-only addition).
     Placed before /:id catch-all. Accessible to any authenticated company member. */
  router.get(
    '/engineer-candidates',
    handle(async (req, res) => {
      const candidates = await service.listEngineerCandidates(req.auth, deps);
      return res.status(200).json({ candidates });
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const serviceCalls = await service.listServiceCalls(req.auth, { filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ serviceCalls });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const serviceCall = await service.getServiceCall(req.params.id, req.auth, deps);
      return res.status(200).json({ serviceCall });
    })
  );

  router.post(
    '/complaints',
    handle(async (req, res) => {
      const result = await service.registerComplaint(req.body, req.auth, deps);
      return res.status(201).json(result);
    })
  );

  router.post(
    '/pm/:contractId',
    handle(async (req, res) => {
      const result = await service.schedulePM(req.params.contractId, req.body, req.auth, deps);
      return res.status(201).json(result);
    })
  );

  router.put(
    '/:id/assign',
    handle(async (req, res) => {
      const serviceCall = await service.assignEngineer(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ serviceCall });
    })
  );

  router.put(
    '/:id/report',
    handle(async (req, res) => {
      const serviceCall = await service.saveReportDraft(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ serviceCall });
    })
  );

  router.post(
    '/:id/complete',
    handle(async (req, res) => {
      const result = await service.completeServiceCall(req.params.id, req.body, req.auth, deps);
      return res.status(200).json(result);
    })
  );

  return router;
}

function parseFilters(query) {
  if (!query) return {};
  return { q: query.q };
}

module.exports = { createServiceCallRouter };
