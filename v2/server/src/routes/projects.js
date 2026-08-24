const express = require('express');
const Project = require('../models/Project');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

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
    if (req.query.div) f.div = req.query.div;
    // Engineer sees only own projects
    if (req.user.role === 'engineer') f.engs = req.user.name;
    // Division PMs only see their own division
    const pmDiv = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };
    if (pmDiv[req.user.role]) f.div = pmDiv[req.user.role];
    const docs = await Project.find(f).sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Project.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const doc = await Project.create(data);
    broadcastUpdate(global.io, doc.co, 'project', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.co;
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id/chk/:idx', async (req, res) => {
  try {
    const proj = await Project.findOne(coFilter(req, req.params.id));
    if (!proj) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= proj.chk.length) return res.status(400).json({ error: 'Invalid index' });
    Object.assign(proj.chk[idx], req.body, { by: req.user.name, at: new Date() });
    await proj.save();
    broadcastUpdate(global.io, proj.co, 'project', proj);
    res.json(proj);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/updates', async (req, res) => {
  try {
    const upd = { ...req.body, by: req.user.name, at: new Date() };
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), { $push: { updates: upd } }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/dc', async (req, res) => {
  try {
    const entry = { ...req.body, by: req.user.name, at: new Date() };
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), { $push: { dc: entry } }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'project', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Project.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'project', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
