'use strict';

/**
 * /api/clients — the people we work for (owner request, 16 Nov 2026).
 *
 *   GET    /api/clients?search=        the list, searched by name, number or GST
 *   GET    /api/clients/:id            one client
 *   POST   /api/clients                add one
 *   PATCH  /api/clients/:id            edit one
 *   DELETE /api/clients/:id            remove one (admin only)
 *   POST   /api/clients/import/amc     bring the AMC / PM clients in
 */

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');
const service = require('../services/clientService');

function createClientRouter(deps) {
  const router = express.Router();
  router.use(createAuthMiddleware(deps), requireCompanyContext, rejectClientSuppliedCompanyId);

  router.get('/', async (req, res) => {
    try {
      const clients = await service.listClients(req.auth, { search: req.query.search }, deps);
      return res.status(200).json({ clients });
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  // Mounted above '/:id' so it is not read as an id.
  router.post('/import/amc', async (req, res) => {
    try {
      const result = await service.importFromContracts(req.auth, deps);
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const client = await service.getClient(req.params.id, req.auth, deps);
      return res.status(200).json({ client });
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  router.post('/', async (req, res) => {
    try {
      const client = await service.createClient(req.body, req.auth, deps);
      return res.status(201).json({ client });
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const client = await service.updateClient(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ client });
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const result = await service.deleteClient(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, 'clientRoutes');
    }
  });

  return router;
}

module.exports = { createClientRouter };
