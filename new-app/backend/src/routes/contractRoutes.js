'use strict';

const express = require('express');
const service = require('../services/contractService');
const amcDocuments = require('../services/amcDocumentService');
const { ServiceError, mapPersistenceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Contract (AMC / Warranty) business API.
 *
 *   GET  /api/contracts                          list/search (all company roles, no division scoping -- PWA FACT §2/§13)
 *   GET  /api/contracts/export.csv                 report export (admin/service_mgr only -- Decision 6)
 *   GET  /api/contracts/pm-due                     PM-Due dashboard panel (all company roles)
 *   GET  /api/contracts/renewal-opportunities       Renewal-Opportunities dashboard panel (all company roles)
 *   GET  /api/contracts/:id                        detail
 *   POST /api/contracts                           manual AMC/Warranty creation (admin/service_mgr only)
 *   POST /api/contracts/from-project/:projectId     Project -> Warranty Contract conversion (admin/service_mgr only)
 *
 * No edit/delete route exists for Contract, anywhere, for any role --
 * CONTRACT_DECISION_LOCK.md Decisions 2-3: the PWA has neither, and none is
 * added. No PM-visit-completion route is mounted here either -- that side
 * effect belongs to a future ServiceCall module (see
 * contractService.completePmVisitForContract's own doc comment); this
 * router does not build ServiceCall endpoints, per instruction.
 */
function createContractRouter(deps) {
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
        const mapped = mapPersistenceError(err);
        if (mapped) return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
        // eslint-disable-next-line no-console
        console.error('[contractRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportContractsCsv(req.auth, { filters: parseFilters(req.query) }, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="amc-pm-list.csv"`);
      return res.status(200).send(csv);
    })
  );

  // AMC / Warranty client picker (owner request, 22 Oct 2026). Declared
  // before '/:id' so "clients" is not read as a contract id.
  router.get(
    '/clients',
    handle(async (req, res) => {
      const clients = await service.searchClients(req.auth, { q: req.query.q, limit: req.query.limit }, deps);
      return res.status(200).json({ clients });
    })
  );

  router.get(
    '/pm-due',
    handle(async (req, res) => {
      const rows = await service.getPmDuePanel(req.auth, deps);
      return res.status(200).json({ rows });
    })
  );

  router.get(
    '/renewal-opportunities',
    handle(async (req, res) => {
      const rows = await service.getRenewalOpportunities(req.auth, deps);
      return res.status(200).json({ rows });
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const contracts = await service.listContracts(req.auth, { filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ contracts });
    })
  );

  // Owner request (22 Oct 2026): the AMC client page.
  router.get(
    '/:id/history',
    handle(async (req, res) => {
      const history = await service.getClientHistory(req.params.id, req.auth, deps);
      return res.status(200).json(history);
    })
  );

  router.get(
    '/:id/letter-link',
    handle(async (req, res) => {
      const link = await amcDocuments.getLetterLink(req.auth.companyId, req.params.id, req.auth, deps);
      return res.status(200).json(link);
    })
  );

  router.post(
    '/:id/payment',
    handle(async (req, res) => {
      const contract = await service.markAmcPaid(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ contract });
    })
  );

  router.post(
    '/:id/renew',
    handle(async (req, res) => {
      const contract = await service.renewContract(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ contract });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const contract = await service.getContract(req.params.id, req.auth, deps);
      return res.status(200).json({ contract });
    })
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const contract = await service.createManualContract(req.body, req.auth, deps);
      return res.status(201).json({ contract });
    })
  );

  router.post(
    '/from-project/:projectId',
    handle(async (req, res) => {
      const contract = await service.convertProjectToContract(req.params.projectId, req.auth, deps);
      return res.status(201).json({ contract });
    })
  );

  return router;
}

function parseFilters(query) {
  if (!query) return {};
  return { q: query.q };
}

module.exports = { createContractRouter };
