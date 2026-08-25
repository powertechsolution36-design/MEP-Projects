const express = require('express');
const Payment = require('../models/Payment');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const { events } = require('../utils/notify');

const router = express.Router();
router.use(auth);

function coFilter(req, id) {
  const f = id ? { _id: id } : {};
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

router.get('/', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.status) f.status = req.query.status;
    if (req.query.pending === 'true') f.status = { $ne: 'paid' };
    const docs = await Payment.find(f).sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Payment.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const doc = await Payment.create(data);
    broadcastUpdate(global.io, doc.co, 'payment', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body }; delete data.co;
    const doc = await Payment.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'payment', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/paid', async (req, res) => {
  try {
    const entry = { ...req.body, by: req.user.name, at: new Date() };
    const doc = await Payment.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.paid.push(entry);
    const totalPaid = doc.paid.reduce((s, p) => s + (p.amt || 0), 0);
    doc.status = totalPaid >= doc.amount ? 'paid' : (totalPaid > 0 ? 'partial' : 'pending');
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'payment', doc);
    events.paymentReceived(global.io, doc, entry.amt || 0, req.user.name).catch(() => {});
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Payment.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'payment', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
