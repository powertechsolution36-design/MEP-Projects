'use strict';

const express = require('express');
const service = require('../services/inventoryService');
const { ServiceError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext, rejectClientSuppliedCompanyId } = require('../middleware/tenantGuard');

/**
 * Inventory (Category/Location/Item/Issue/Transaction) business API.
 * See PWA_COVERAGE_AUDIT_INVENTORY.md / INVENTORY_DECISION_LOCK.md.
 *
 *   GET  /api/inventory/categories                  list categories
 *   POST /api/inventory/categories                   create category (inventory/admin)
 *   PUT  /api/inventory/categories/:id                rename category (inventory/admin)
 *   DELETE /api/inventory/categories/:id              delete category (inventory/admin, blocked if referenced)
 *   GET  /api/inventory/locations                    list locations
 *   POST /api/inventory/locations                     create location (inventory/admin)
 *   PUT  /api/inventory/locations/:id                  rename location (inventory/admin)
 *   DELETE /api/inventory/locations/:id                delete location (inventory/admin, blocked if stocked)
 *   GET  /api/inventory/items                        list items
 *   POST /api/inventory/items                          create item (inventory/admin)
 *   GET  /api/inventory/items/:id                       item detail (tenant-scoped, closes PWA itemById() gap)
 *   PUT  /api/inventory/items/:id                        edit item (inventory/admin)
 *   DELETE /api/inventory/items/:id                      delete item (inventory/admin, hard/unguarded)
 *   POST /api/inventory/items/:id/adjust                  stock adjustment (Purchase In/Opening Stock/Damage/Adjustment)
 *   POST /api/inventory/issues                        issue material (inventory/admin)
 *   POST /api/inventory/issues/:id/return-request        staff self-service return request (owner only)
 *   POST /api/inventory/issues/:id/accept-return          accept a return (inventory/admin)
 *   POST /api/inventory/issues/:id/reject-return           reject a return request (inventory/admin)
 *   POST /api/inventory/issues/:id/mark-used                mark used (inventory/admin)
 *   POST /api/inventory/transfers                     stock transfer (inventory/admin)
 *   GET  /api/inventory/dashboard                     dashboard KPIs (inventory/admin)
 *   GET  /api/inventory/my-material                   caller's own issues
 *   GET  /api/inventory/reports/stock.csv               Stock Report
 *   GET  /api/inventory/reports/issued.csv                Issued Material Report
 *   GET  /api/inventory/reports/transactions.csv           Inventory Transaction Report (admin/inventory)
 *   GET  /api/inventory/reports/my-material.csv              My Material Report
 *   GET  /api/inventory/reports/returns.csv                    Material Return Report (admin/inventory)
 *
 * No edit/delete route exists for InventoryTransaction -- it is append-only
 * (INVENTORY_DECISION_LOCK.md Decision 29).
 */
function createInventoryRouter(deps) {
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
        console.error('[inventoryRoutes]', err);
        return res.status(500).json({ error: 'Internal error.' });
      }
    };
  }

  /* ---- Recipient candidates for issue dropdown (infrastructure-only addition) ---- */
  router.get('/recipient-candidates', handle(async (req, res) => {
    const candidates = await service.listRecipientCandidates(req.auth, deps);
    return res.status(200).json({ candidates });
  }));

  /* ---- Categories ---- */
  router.get('/categories', handle(async (req, res) => {
    const categories = await service.listCategories(req.auth, deps);
    return res.status(200).json({ categories });
  }));
  router.post('/categories', handle(async (req, res) => {
    const category = await service.createCategory(req.body, req.auth, deps);
    return res.status(201).json({ category });
  }));
  router.put('/categories/:id', handle(async (req, res) => {
    const category = await service.renameCategory(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ category });
  }));
  router.delete('/categories/:id', handle(async (req, res) => {
    const result = await service.deleteCategory(req.params.id, req.auth, deps);
    return res.status(200).json(result);
  }));

  /* ---- Locations ---- */
  router.get('/locations', handle(async (req, res) => {
    const locations = await service.listLocations(req.auth, deps);
    return res.status(200).json({ locations });
  }));
  router.post('/locations', handle(async (req, res) => {
    const location = await service.createLocation(req.body, req.auth, deps);
    return res.status(201).json({ location });
  }));
  router.put('/locations/:id', handle(async (req, res) => {
    const location = await service.renameLocation(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ location });
  }));
  router.delete('/locations/:id', handle(async (req, res) => {
    const result = await service.deleteLocation(req.params.id, req.auth, deps);
    return res.status(200).json(result);
  }));

  /* ---- Items ---- */
  router.get('/items', handle(async (req, res) => {
    const items = await service.listItems(req.auth, deps);
    return res.status(200).json({ items });
  }));
  router.post('/items', handle(async (req, res) => {
    const item = await service.createItem(req.body, req.auth, deps);
    return res.status(201).json({ item });
  }));
  router.get('/items/:id', handle(async (req, res) => {
    const item = await service.getItem(req.params.id, req.auth, deps);
    return res.status(200).json({ item });
  }));
  router.put('/items/:id', handle(async (req, res) => {
    const item = await service.updateItem(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ item });
  }));
  router.delete('/items/:id', handle(async (req, res) => {
    const result = await service.deleteItem(req.params.id, req.auth, deps);
    return res.status(200).json(result);
  }));
  router.post('/items/:id/adjust', handle(async (req, res) => {
    const item = await service.adjustStock(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ item });
  }));

  /* ---- Issues / Returns / Mark-used ---- */
  router.post('/issues', handle(async (req, res) => {
    const result = await service.issueMaterial(req.body, req.auth, deps);
    return res.status(201).json(result);
  }));
  router.post('/issues/:id/return-request', handle(async (req, res) => {
    const issue = await service.requestReturn(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ issue });
  }));
  router.post('/issues/:id/accept-return', handle(async (req, res) => {
    const result = await service.acceptReturn(req.params.id, req.body, req.auth, deps);
    return res.status(200).json(result);
  }));
  router.post('/issues/:id/reject-return', handle(async (req, res) => {
    const issue = await service.rejectReturn(req.params.id, req.auth, deps);
    return res.status(200).json({ issue });
  }));
  router.post('/issues/:id/mark-used', handle(async (req, res) => {
    const issue = await service.markUsed(req.params.id, req.body, req.auth, deps);
    return res.status(200).json({ issue });
  }));

  /* ---- Transfer ---- */
  router.post('/transfers', handle(async (req, res) => {
    const item = await service.transferStock(req.body, req.auth, deps);
    return res.status(201).json({ item });
  }));

  /* ---- Dashboard / My Material ---- */
  router.get('/dashboard', handle(async (req, res) => {
    const dashboard = await service.getDashboard(req.auth, deps);
    return res.status(200).json({ dashboard });
  }));
  router.get('/my-material', handle(async (req, res) => {
    const issues = await service.listMyMaterial(req.auth, deps);
    return res.status(200).json({ issues });
  }));

  /* ---- Reports ---- */
  router.get('/reports/stock.csv', handle(async (req, res) => {
    const csv = await service.exportStockCsv(req.auth, deps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-stock-report.csv"');
    return res.status(200).send(csv);
  }));
  router.get('/reports/issued.csv', handle(async (req, res) => {
    const csv = await service.exportIssuedCsv(req.auth, deps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="issued-material-report.csv"');
    return res.status(200).send(csv);
  }));
  router.get('/reports/transactions.csv', handle(async (req, res) => {
    const csv = await service.exportTransactionsCsv(req.auth, deps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-transaction-report.csv"');
    return res.status(200).send(csv);
  }));
  router.get('/reports/my-material.csv', handle(async (req, res) => {
    const csv = await service.exportMyMaterialCsv(req.auth, deps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="my-material-report.csv"');
    return res.status(200).send(csv);
  }));
  router.get('/reports/returns.csv', handle(async (req, res) => {
    const csv = await service.exportReturnsCsv(req.auth, deps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="material-return-report.csv"');
    return res.status(200).send(csv);
  }));

  return router;
}

module.exports = { createInventoryRouter };
