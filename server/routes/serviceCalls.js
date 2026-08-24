const router = require('express').Router();
const auth = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const ServiceCall = require('../models/ServiceCall');
const Sequence = require('../models/Sequence');

function coFilter(req, id) { const f = { _id: id }; if (req.user.role !== 'super') f.co = req.user.co; return f; }

router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.user.role === 'service_eng') filter.eng = req.user.name;
    const docs = await ServiceCall.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await ServiceCall.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    if (!data.psc) data.psc = await Sequence.next(req.user.co, 'psc');
    const doc = await ServiceCall.create(data);
    broadcastUpdate(global.io, req.user.co, req.user.role, 'servicecall', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await ServiceCall.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'servicecall', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await ServiceCall.findOneAndDelete(coFilter(req, req.params.id));
    if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'servicecall', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
