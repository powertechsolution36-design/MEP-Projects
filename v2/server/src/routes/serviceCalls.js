const express = require('express');
const ServiceCall = require('../models/ServiceCall');
const Sequence = require('../models/Sequence');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const { scopeServiceCalls } = require('../utils/scope');
const { events } = require('../utils/notify');

const router = express.Router();
router.use(auth);

function coFilter(req, id) {
  const f = id ? { _id: id } : {};
  return scopeServiceCalls(f, req);
}

router.get('/', async (req, res) => {
  try {
    const f = scopeServiceCalls({}, req);
    if (req.query.status) f.status = req.query.status;
    if (req.query.type) f.type = req.query.type;
    const docs = await ServiceCall.find(f).sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await ServiceCall.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.psc) data.psc = await Sequence.next(data.co, 'psc');
    const doc = await ServiceCall.create(data);
    broadcastUpdate(global.io, doc.co, 'servicecall', doc);
    events.serviceCallCreated(global.io, doc, req.user.name).catch(() => {});
    if (doc.eng) events.serviceCallAssigned(global.io, doc).catch(() => {});
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await ServiceCall.findOne(coFilter(req, req.params.id));
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const oldEng = existing.eng;
    const data = { ...req.body }; delete data.co;
    if (data.status === 'closed' && !data.closedAt) data.closedAt = new Date();
    Object.assign(existing, data);
    await existing.save();
    broadcastUpdate(global.io, existing.co, 'servicecall', existing);
    if (existing.eng && existing.eng !== oldEng) {
      events.serviceCallAssigned(global.io, existing).catch(() => {});
    }
    res.json(existing);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await ServiceCall.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'servicecall', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
