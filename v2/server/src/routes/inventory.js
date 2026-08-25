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

function subCrud(path, model, resource, sortField = 'name') {
  router.get(`/${path}`, async (req, res) => {
    try {
      const f = coFilter(req);
      for (const k of ['cat', 'status', 'staff', 'item', 'type', 'location']) if (req.query[k]) f[k] = req.query[k];
      const sort = sortField === 'name' ? { name: 1 } : { createdAt: -1 };
      const docs = await model.find(f).sort(sort).limit(1000).lean();
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
      const data = { ...req.body }; delete data.co;
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

// ----- ISSUES -----
router.get('/issues', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.status) f.status = req.query.status;
    if (req.query.staff) f.staff = req.query.staff;
    const docs = await InvIssue.find(f).sort({ createdAt: -1 }).limit(500).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/issues/:id', async (req, res) => {
  try {
    const doc = await InvIssue.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create issue: deduct stock and log transactions
router.post('/issues', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.issuedBy) data.issuedBy = req.user.name;
    // Deduct stock and log
    for (const line of (data.items || [])) {
      if (!line.item || !line.qty) continue;
      const it = await InvItem.findOne({ _id: line.item, co: data.co });
      if (it) {
        it.qty = (it.qty || 0) - line.qty;
        await it.save();
        broadcastUpdate(global.io, it.co, 'invitem', it);
        await InvTransaction.create({ co: data.co, item: it._id, type: 'out', qty: line.qty, rate: it.rate, ref: `Issue to ${data.staff}`, by: req.user.name });
      }
    }
    const doc = await InvIssue.create(data);
    broadcastUpdate(global.io, doc.co, 'invissue', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/issues/:id', async (req, res) => {
  try {
    const data = { ...req.body }; delete data.co;
    const doc = await InvIssue.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'invissue', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Staff requests return of materials
router.post('/issues/:id/return-request', async (req, res) => {
  try {
    const doc = await InvIssue.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.returnRequests.push({ by: req.user.name, items: req.body.items || [], notes: req.body.notes, status: 'pending' });
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'invissue', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Store receives (or rejects) a return request → returns qty to stock
router.patch('/issues/:id/return-request/:reqId', async (req, res) => {
  try {
    const { action } = req.body; // 'receive' | 'reject'
    const doc = await InvIssue.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const rr = doc.returnRequests.id(req.params.reqId);
    if (!rr) return res.status(404).json({ error: 'Return request not found' });
    rr.status = action === 'receive' ? 'received' : 'rejected';
    rr.handledAt = new Date();
    rr.handledBy = req.user.name;
    if (action === 'receive') {
      for (const rl of rr.items) {
        if (!rl.item || !rl.qty) continue;
        const it = await InvItem.findOne({ _id: rl.item, co: doc.co });
        if (it) {
          it.qty = (it.qty || 0) + rl.qty;
          await it.save();
          broadcastUpdate(global.io, it.co, 'invitem', it);
          await InvTransaction.create({ co: doc.co, item: it._id, type: 'in', qty: rl.qty, ref: `Return from ${rr.by}`, by: req.user.name });
        }
        // update issue line returnedQty
        const line = doc.items.find(l => String(l.item) === String(rl.item));
        if (line) line.returnedQty = (line.returnedQty || 0) + rl.qty;
      }
      // update issue status
      const allReturned = doc.items.every(l => (l.returnedQty || 0) + (l.consumedQty || 0) >= (l.qty || 0));
      doc.status = allReturned ? 'closed' : 'partial';
    }
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'invissue', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Mark issued items as consumed (used on site, no return)
router.patch('/issues/:id/consume', async (req, res) => {
  try {
    const doc = await InvIssue.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    for (const { itemId, qty } of (req.body.items || [])) {
      const line = doc.items.find(l => String(l.item) === String(itemId));
      if (line) line.consumedQty = (line.consumedQty || 0) + (qty || 0);
    }
    const allDone = doc.items.every(l => (l.returnedQty || 0) + (l.consumedQty || 0) >= (l.qty || 0));
    doc.status = allDone ? 'closed' : 'partial';
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'invissue', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/issues/:id', async (req, res) => {
  try {
    const doc = await InvIssue.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'invissue', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----- TRANSACTIONS -----
router.get('/transactions', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.item) f.item = req.query.item;
    if (req.query.type) f.type = req.query.type;
    const docs = await InvTransaction.find(f).sort({ createdAt: -1 }).limit(1000).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stock IN (receive) / Adjust / Transfer
router.post('/transactions', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.by) data.by = req.user.name;
    if (data.item) {
      const item = await InvItem.findOne({ _id: data.item, co: data.co });
      if (item) {
        if (data.type === 'in') item.qty = (item.qty || 0) + data.qty;
        else if (data.type === 'out') item.qty = (item.qty || 0) - data.qty;
        else if (data.type === 'adjust') item.qty = data.qty;
        // transfer doesn't change qty (same company, moves between locations)
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
