'use strict';

const express = require('express');
const service = require('../services/projectService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Project Execution business API.
 *
 * No standalone Project creation route -- PWA FACT (audit §4): a Project is
 * created ONLY as a side effect of SalesOrder creation (the already-mounted
 * `POST /api/sales-orders` and `POST /api/enquiries/:id/convert` routes).
 *
 *   GET    /api/projects                                   list/search
 *   GET    /api/projects/export.csv                         list/dashboard CSV
 *   GET    /api/projects/:id                                 detail (no division restriction -- see projectService.getProject)
 *   POST   /api/projects/:id/stage                            stage edit + completion gate
 *   PATCH  /api/projects/:id/vendor                           vendor edit
 *   POST   /api/projects/:id/engineers                        engineer assignment (full replace)
 *   POST   /api/projects/:id/timeline                         set/edit timeline
 *   PATCH  /api/projects/:id/checklist/:i/target-date          single-point target date edit
 *   POST   /api/projects/:id/checklist                        add a checklist point
 *   PATCH  /api/projects/:id/checklist/:i                       edit a checklist point (text/sign responsibility)
 *   DELETE /api/projects/:id/checklist/:i                       remove a checklist point
 *   POST   /api/projects/:id/checklist/apply                   apply a template (replace/append)
 *   POST   /api/projects/:id/checklist/:i/tick                  tick/untick
 *   PATCH  /api/projects/:id/checklist/:i/remark                 remark edit
 *   POST   /api/projects/:id/checklist/:i/photos                 add a photo
 *   POST   /api/projects/:id/checklist/:i/approve                 approve/sign
 *   POST   /api/projects/:id/checklist/:i/pm-sign                  PM counter-sign
 *   POST   /api/projects/:id/updates                            append an execution update
 *   POST   /api/projects/:id/delivery-challans                   create/append to a DC
 *   PATCH  /api/projects/:id/delivery-challans/:i                 edit one DC item
 *   DELETE /api/projects/:id/delivery-challans/:i                 delete one DC item
 *   POST   /api/projects/:id/delivery-challans/:i/return           record a material return
 *   GET    /api/projects/:id/delivery-challans/export.csv           DC CSV export
 *   GET    /api/projects/:id/report                                detailed report (JSON)
 *   GET    /api/projects/:id/report/export.csv                       detailed report (CSV)
 *   POST   /api/projects/:id/delay-check                            manual delay-check trigger (no scheduler wired up in this task)
 *   POST   /api/projects/:id/service-conversion/prepare              deferred Contract/ServiceCall integration point (see projectService.prepareServiceConversion)
 *
 * Raising a payment milestone to Finance from a Project stays on the
 * SalesOrder router (`POST /api/sales-orders/:id/milestones/:mi/raise`,
 * already implemented) -- Project never reimplements that logic, per
 * instruction; a client resolves `project.salesOrderId` first.
 *
 * Role/tenant enforcement happens in the service layer, matching the
 * pattern in salesOrderRoutes.js/paymentRoutes.js.
 */
function createProjectRouter(deps) {
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
        console.error('[projectRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  router.get(
    '/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportProjectsCsv(req.auth, { filters: parseFilters(req.query) }, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="projects.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const projects = await service.listProjects(req.auth, { filters: parseFilters(req.query) }, deps);
      return res.status(200).json({ projects });
    })
  );


  router.get(
    '/engineer-candidates',
    handle(async (req, res) => {
      const candidates = await service.listEngineerCandidates(req.auth, deps);
      return res.status(200).json({ candidates });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      const project = await service.getProject(req.params.id, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/stage',
    handle(async (req, res) => {
      const project = await service.setStage(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.patch(
    '/:id/vendor',
    handle(async (req, res) => {
      const project = await service.setVendor(req.params.id, req.body && req.body.vendor, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/engineers',
    handle(async (req, res) => {
      const project = await service.assignEngineers(req.params.id, req.body && req.body.engineerIds, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/timeline',
    handle(async (req, res) => {
      const project = await service.saveTimeline(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.patch(
    '/:id/checklist/:i/target-date',
    handle(async (req, res) => {
      const project = await service.editChecklistItemDate(req.params.id, Number(req.params.i), req.body && req.body.targetDate, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/checklist',
    handle(async (req, res) => {
      const project = await service.addChecklistItem(req.params.id, req.body, req.auth, deps);
      return res.status(201).json({ project });
    })
  );

  router.patch(
    '/:id/checklist/:i',
    handle(async (req, res) => {
      const project = await service.editChecklistItem(req.params.id, Number(req.params.i), req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.delete(
    '/:id/checklist/:i',
    handle(async (req, res) => {
      const project = await service.removeChecklistItem(req.params.id, Number(req.params.i), req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/checklist/apply',
    handle(async (req, res) => {
      const project = await service.applyChecklistTemplate(req.params.id, req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/checklist/:i/tick',
    handle(async (req, res) => {
      const project = await service.setChecklistItemDone(req.params.id, Number(req.params.i), !!(req.body && req.body.done), req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.patch(
    '/:id/checklist/:i/remark',
    handle(async (req, res) => {
      const project = await service.setChecklistItemRemark(req.params.id, Number(req.params.i), req.body && req.body.remark, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/checklist/:i/photos',
    handle(async (req, res) => {
      const project = await service.addChecklistItemPhoto(req.params.id, Number(req.params.i), req.body && req.body.photo, req.auth, deps);
      return res.status(201).json({ project });
    })
  );

  router.post(
    '/:id/checklist/:i/approve',
    handle(async (req, res) => {
      const project = await service.approveChecklistItem(req.params.id, Number(req.params.i), req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/checklist/:i/pm-sign',
    handle(async (req, res) => {
      const project = await service.counterSignChecklistItem(req.params.id, Number(req.params.i), req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/updates',
    handle(async (req, res) => {
      const project = await service.addExecutionUpdate(req.params.id, req.body, req.auth, deps);
      return res.status(201).json({ project });
    })
  );

  router.post(
    '/:id/delivery-challans',
    handle(async (req, res) => {
      const project = await service.addDeliveryChallan(req.params.id, req.body, req.auth, deps);
      return res.status(201).json({ project });
    })
  );

  router.patch(
    '/:id/delivery-challans/:i',
    handle(async (req, res) => {
      const project = await service.editDeliveryChallanItem(req.params.id, Number(req.params.i), req.body, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.delete(
    '/:id/delivery-challans/:i',
    handle(async (req, res) => {
      const project = await service.removeDeliveryChallanItem(req.params.id, Number(req.params.i), req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.post(
    '/:id/delivery-challans/:i/return',
    handle(async (req, res) => {
      const project = await service.recordDeliveryChallanReturn(req.params.id, Number(req.params.i), req.body && req.body.quantity, req.auth, deps);
      return res.status(200).json({ project });
    })
  );

  router.get(
    '/:id/delivery-challans/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportDeliveryChallanCsv(req.params.id, req.auth, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="delivery-challan.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.get(
    '/:id/report',
    handle(async (req, res) => {
      const report = await service.getProjectReport(req.params.id, req.auth, deps);
      return res.status(200).json({ report });
    })
  );

  router.get(
    '/:id/report/export.csv',
    handle(async (req, res) => {
      const csv = await service.exportProjectReportCsv(req.params.id, req.auth, deps);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="project-report.csv"`);
      return res.status(200).send(csv);
    })
  );

  router.post(
    '/:id/delay-check',
    handle(async (req, res) => {
      const notification = await service.runDelayCheckForProject(req.params.id, req.auth, deps);
      return res.status(200).json({ notification });
    })
  );

  router.post(
    '/:id/service-conversion/prepare',
    handle(async (req, res) => {
      const result = await service.prepareServiceConversion(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    })
  );

  return router;
}

function parseFilters(query) {
  if (!query) return {};
  return { q: query.q };
}

module.exports = { createProjectRouter };
