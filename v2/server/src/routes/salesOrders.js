const express = require('express');
const SalesOrder = require('../models/SalesOrder');
const Sequence = require('../models/Sequence');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

const router = express.Router();
router.use(auth);

function coFilter(req, id) {
  const f = id ? { _id: id } : {};
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

function recalc(data) {
  if (!Array.isArray(data.items)) return;
  data.items.forEach(it => { it.amount = (it.qty || 0) * (it.rate || 0); });
  data.subtotal = data.items.reduce((s, it) => s + (it.amount || 0), 0);
  data.total = data.subtotal + (data.tax || 0);
}

router.get('/', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.status) f.status = req.query.status;
    const docs = await SalesOrder.find(f).sort({ no: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await SalesOrder.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.no) data.no = await Sequence.next(data.co, 'so');
    recalc(data);
    const doc = await SalesOrder.create(data);
    broadcastUpdate(global.io, doc.co, 'salesorder', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.co;
    recalc(data);
    const doc = await SalesOrder.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'salesorder', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await SalesOrder.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'salesorder', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
