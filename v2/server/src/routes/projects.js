const express = require('express');
const Project = require('../models/Project');
const Sequence = require('../models/Sequence');
const { auth } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const { scopeProjects } = require('../utils/scope');
const { events } = require('../utils/notify');

const router = express.Router();
router.use(auth);

function coFilter(req, id) {
  const f = id ? { _id: id } : {};
  return scopeProjects(f, req);
}

router.get('/', async (req, res) => {
  try {
    const f = scopeProjects({}, req);
    if (req.query.status) f.status = req.query.status;
    if (req.query.div && !f.div) f.div = req.query.div;
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
    // Auto-code: PRJ-<seq>
    if (!data.code) data.code = `PRJ-${await Sequence.next(data.co, 'project')}`;
    const doc = await Project.create(data);
    broadcastUpdate(global.io, doc.co, 'project', doc);
    events.projectCreated(global.io, doc, req.user.name).catch(() => {});
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await Project.findOne(coFilter(req, req.params.id));
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const oldStatus = existing.status;
    const data = { ...req.body };
    delete data.co; delete data.code;
    Object.assign(existing, data);
    await existing.save();
    broadcastUpdate(global.io, existing.co, 'project', existing);
    if (oldStatus !== existing.status) {
      events.projectStatus(global.io, existing, oldStatus, req.user.name).catch(() => {});
    }
    res.json(existing);
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
    const proj = await Project.findOne(coFilter(req, req.params.id));
    if (!proj) return res.status(404).json({ error: 'Not found' });
    const dcNo = await Sequence.next(proj.co, 'dc');
    const entry = { ...req.body, no: dcNo, by: req.user.name, at: new Date() };
    proj.dc.push(entry);
    await proj.save();
    broadcastUpdate(global.io, proj.co, 'project', proj);
    res.json({ project: proj, dc: entry });
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
