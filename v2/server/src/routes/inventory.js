const express = require('express');
const InvCategory = require('../models/InvCategory');
const InvLocation = require('../models/InvLocation');
const InvItem = require('../models/InvItem');
const InvIssue = require('../models/InvIssue');
const InvTransaction = require('../models/InvTransaction');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

const router = express.Router();
router.use(auth);

function coFilter(req, id) {
  const f = id ? { _id: id } : {};
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

// Factory to reduce boilerplate for sub-resources
function subCrud(path, model, resource) {
  router.get(`/${path}`, async (req, res) => {
    try {
      const f = coFilter(req);
      for (const k of ['cat', 'status', 'staff', 'item', 'type']) if (req.query[k]) f[k] = req.query[k];
      const docs = await model.find(f).sort({ createdAt: -1 }).limit(500).lean();
      res.json(docs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get(`/${path}/:id`, async (req, res) => {
    try {
      const doc = await model.findOne(coFilter(req, req.params.id)).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json(doc);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post(`/${path}`, async (req, res) => {
    try {
      const data = { ...req.body };
      if (req.user.role !== 'super') data.co = req.user.co;
      const doc = await model.create(data);
      broadcastUpdate(global.io, doc.co, resource, doc);
      res.status(201).json(doc);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.put(`/${path}/:id`, async (req, res) => {
    try {
      const data = { ...req.body };
      delete data.co;
      const doc = await model.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      broadcastUpdate(global.io, doc.co, resource, doc);
      res.json(doc);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete(`/${path}/:id`, async (req, res) => {
    try {
      const doc = await model.findOneAndDelete(coFilter(req, req.params.id));
      if (!doc) return res.status(404).json({ error: 'Not found' });
      broadcastDelete(global.io, doc.co, resource, doc._id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

subCrud('categories', InvCategory, 'invcategory');
subCrud('locations', InvLocation, 'invlocation');
subCrud('items', InvItem, 'invitem');
subCrud('issues', InvIssue, 'invissue');

// Transactions - special handling; also updates item qty
router.get('/transactions', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.item) f.item = req.query.item;
    if (req.query.type) f.type = req.query.type;
    const docs = await InvTransaction.find(f).sort({ createdAt: -1 }).limit(500).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transactions', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.by) data.by = req.user.name;
    // Update item qty
    if (data.item) {
      const item = await InvItem.findOne({ _id: data.item, co: data.co });
      if (item) {
        const delta = data.type === 'in' ? data.qty : (data.type === 'out' ? -data.qty : (data.type === 'adjust' ? (data.qty - item.qty) : 0));
        if (data.type === 'adjust') item.qty = data.qty; else item.qty = (item.qty || 0) + delta;
        await item.save();
        broadcastUpdate(global.io, item.co, 'invitem', item);
      }
    }
    const doc = await InvTransaction.create(data);
    broadcastUpdate(global.io, doc.co, 'invtransaction', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
