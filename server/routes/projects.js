const router = require('express').Router();
const auth = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const Project = require('../models/Project');

function coFilter(req, id) { const f = { _id: id }; if (req.user.role !== 'super') f.co = req.user.co; return f; }

router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.div) filter.div = req.query.div;
    if (req.user.role === 'engineer') filter.engs = req.user.name;
    const pmDiv = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };
    if (pmDiv[req.user.role]) filter.div = pmDiv[req.user.role];
    const docs = await Project.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Project.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Project.create(data);
    broadcastUpdate(global.io, req.user.co, req.user.role, 'project', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/chk/:idx', auth, async (req, res) => {
  try {
    const proj = await Project.findOne(coFilter(req, req.params.id));
    if (!proj) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= proj.chk.length) return res.status(400).json({ error: 'Invalid index' });
    Object.assign(proj.chk[idx], req.body);
    await proj.save();
    broadcastUpdate(global.io, req.user.co, req.user.role, 'project', proj);
    res.json(proj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/updates', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), { $push: { updates: req.body } }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/dc', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), { $push: { dc: req.body } }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndDelete(coFilter(req, req.params.id));
    if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'project', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
