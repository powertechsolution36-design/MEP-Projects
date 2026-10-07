'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const {
  autocomplete, listItems, deleteItemName,
} = require('../services/itemNameService');

function createItemNameRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  // All item-name routes require auth + company context
  router.use(authMiddleware, requireCompanyContext);

  // Autocomplete — used by quotation/DC line-item editors
  router.get('/autocomplete', async (req, res) => {
    try {
      const { division, q, limit } = req.query;
      if (!division) return res.status(400).json({ error: 'division query param is required.' });
      const results = await autocomplete(
        req.auth.companyId, division, q || '', limit ? parseInt(limit, 10) : 20, deps
      );
      return res.json({ items: results });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // List all items for a division
  router.get('/list', async (req, res) => {
    try {
      const { division } = req.query;
      if (!division) return res.status(400).json({ error: 'division query param is required.' });
      const items = await listItems(req.auth.companyId, division, deps);
      return res.json({ items });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Delete an item name (admin only)
  router.delete('/:itemId', async (req, res) => {
    try {
      if (!['super', 'admin'].includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only admin can delete item names.' });
      }
      const result = await deleteItemName(req.auth.companyId, req.params.itemId, deps);
      return res.json(result);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createItemNameRouter };
