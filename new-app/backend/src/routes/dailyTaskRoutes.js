'use strict';

const express = require('express');
const service = require('../services/dailyTaskService');
const { ServiceError, mapPersistenceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

function createDailyTaskRouter(deps) {
  const router = express.Router();
  router.use(createAuthMiddleware(deps), requireCompanyContext, rejectClientSuppliedCompanyId);

  function handle(fn) {
    return async (req, res) => {
      try {
        return await fn(req, res);
      } catch (err) {
        if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message, code: err.code });
        const mapped = mapPersistenceError(err);
        if (mapped) return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
        console.error('[dailyTaskRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get('/', handle(async (req, res) => {
    const tasks = await service.listDailyTasks(req.auth, { date: req.query.date }, deps);
    return res.status(200).json({ tasks });
  }));

  router.get('/assignees', handle(async (req, res) => {
    const assignees = await service.listAssignees(req.auth, deps);
    return res.status(200).json({ assignees });
  }));

  router.post('/', handle(async (req, res) => {
    const task = await service.createDailyTask(req.body, req.auth, deps);
    return res.status(201).json({ task });
  }));

  router.post('/:id/submit', handle(async (req, res) => {
    const task = await service.submitDailyTask(req.params.id, req.auth, deps);
    return res.status(200).json({ task });
  }));

  router.post('/:id/approve', handle(async (req, res) => {
    const task = await service.approveDailyTask(req.params.id, req.auth, deps);
    return res.status(200).json({ task });
  }));

  return router;
}

module.exports = { createDailyTaskRouter };
