const express = require('express');
const Enquiry = require('../models/Enquiry');
const Sequence = require('../models/Sequence');
const SalesOrder = require('../models/SalesOrder');
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
    // Hide lost by default unless explicitly requested
    if (!req.query.status && req.query.includeLost !== 'true') f.status = { $ne: 'lost' };
    const docs = await Enquiry.find(f).sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Enquiry.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const doc = await Enquiry.create(data);
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body }; delete data.co;
    const doc = await Enquiry.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/log', async (req, res) => {
  try {
    const entry = { ...req.body, by: req.user.name, at: new Date() };
    const doc = await Enquiry.findOneAndUpdate(coFilter(req, req.params.id), { $push: { log: entry } }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Mark as Lost with reason (adds a log entry + sets status)
router.post('/:id/lost', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const doc = await Enquiry.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.status = 'lost';
    doc.log.push({ by: req.user.name, at: new Date(), action: 'lost', note: reason || '' });
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    events.enquiryLost(global.io, doc, reason, req.user.name).catch(() => {});
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Reopen a lost enquiry
router.post('/:id/reopen', async (req, res) => {
  try {
    const doc = await Enquiry.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.status = 'new';
    doc.log.push({ by: req.user.name, at: new Date(), action: 'reopen', note: req.body?.note || '' });
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Convert enquiry to Sales Order (marks 'won' + creates SO)
router.post('/:id/convert', async (req, res) => {
  try {
    const doc = await Enquiry.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const soNo = await Sequence.next(doc.co, 'so');
    const so = await SalesOrder.create({
      co: doc.co,
      no: soNo,
      client: doc.client,
      contact: doc.contact,
      date: new Date(),
      items: req.body?.items || [],
      status: 'confirmed',
      notes: `From enquiry: ${doc.subject || doc.client}`,
    });
    doc.status = 'won';
    doc.log.push({ by: req.user.name, at: new Date(), action: 'converted', note: `SO #${soNo}` });
    await doc.save();
    broadcastUpdate(global.io, doc.co, 'enquiry', doc);
    broadcastUpdate(global.io, doc.co, 'salesorder', so);
    events.soConfirmed(global.io, so, req.user.name).catch(() => {});
    res.json({ enquiry: doc, salesOrder: so });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Enquiry.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'enquiry', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
