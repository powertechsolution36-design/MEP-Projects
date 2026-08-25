const express = require('express');
const Contract = require('../models/Contract');
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

// Utility: compute next-visit-due contracts within given days
function computeVisitDue(contracts, withinDays = 30) {
  const now = Date.now();
  const cut = now + withinDays * 24 * 60 * 60 * 1000;
  return contracts.map(c => {
    const next = (c.svcs || []).filter(v => !v.done).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
    return { ...c, nextVisit: next || null, isDueSoon: next && new Date(next.due).getTime() <= cut };
  });
}

router.get('/', async (req, res) => {
  try {
    const f = coFilter(req);
    if (req.query.status) f.status = req.query.status;
    if (req.query.type) f.type = req.query.type;
    const docs = await Contract.find(f).sort({ end: 1 }).lean();
    // Return with computed PM visit due
    const enriched = computeVisitDue(docs, 30);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Contract.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const doc = await Contract.create(data);
    broadcastUpdate(global.io, doc.co, 'contract', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body }; delete data.co;
    const doc = await Contract.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'contract', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id/svcs/:idx', async (req, res) => {
  try {
    const c = await Contract.findOne(coFilter(req, req.params.id));
    if (!c) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= c.svcs.length) return res.status(400).json({ error: 'Invalid index' });
    Object.assign(c.svcs[idx], req.body);
    if (req.body.done) c.svcs[idx].doneAt = new Date();
    await c.save();
    broadcastUpdate(global.io, c.co, 'contract', c);
    res.json(c);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Contract.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'contract', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Daily cron-callable endpoint: check contracts & generate notifications
router.post('/notify-checks', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const f = coFilter(req);
    const contracts = await Contract.find({ ...f, status: 'active' });
    let count = 0;
    const now = Date.now();
    for (const c of contracts) {
      const daysLeft = c.end ? Math.round((new Date(c.end).getTime() - now) / (24 * 60 * 60 * 1000)) : null;
      if (daysLeft !== null && daysLeft <= 30 && daysLeft >= 0) {
        events.contractExpiring(global.io, c, daysLeft).catch(() => {});
        count++;
      }
      for (const v of (c.svcs || [])) {
        if (v.done) continue;
        const dueDiff = new Date(v.due).getTime() - now;
        if (dueDiff <= 7 * 24 * 60 * 60 * 1000 && dueDiff >= 0) {
          events.pmVisitDue(global.io, c, v.due).catch(() => {});
          count++;
        }
      }
    }
    res.json({ ok: true, notified: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
