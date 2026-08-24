const express = require('express');
const Checklist = require('../models/Checklist');
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
    if (req.query.div) f.div = req.query.div;
    const docs = await Checklist.find(f).sort({ name: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Checklist.findOne(coFilter(req, req.params.id)).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const doc = await Checklist.create(data);
    broadcastUpdate(global.io, doc.co, 'checklist', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.co;
    const doc = await Checklist.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, doc.co, 'checklist', doc);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Checklist.findOneAndDelete(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, doc.co, 'checklist', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
