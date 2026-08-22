const router = require('express').Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');

function coFilter(req, id) {
  const f = { _id: id };
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

// GET all
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.div) filter.div = req.query.div;
    // Engineers see only their projects
    if (req.user.role === 'engineer') {
      filter.engs = req.user.name;
    }
    // PM roles see only their division
    const pmDiv = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };
    if (pmDiv[req.user.role]) filter.div = pmDiv[req.user.role];
    const docs = await Project.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Project.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Project.create(data);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update checklist item
router.put('/:id/chk/:idx', auth, async (req, res) => {
  try {
    const proj = await Project.findOne(coFilter(req, req.params.id));
    if (!proj) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= proj.chk.length) return res.status(400).json({ error: 'Invalid index' });
    Object.assign(proj.chk[idx], req.body);
    await proj.save();
    res.json(proj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT add update entry
router.put('/:id/updates', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(
      coFilter(req, req.params.id),
      { $push: { updates: req.body } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT add DC item
router.put('/:id/dc', auth, async (req, res) => {
  try {
    const doc = await Project.findOneAndUpdate(
      coFilter(req, req.params.id),
      { $push: { dc: req.body } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await Project.findOneAndDelete(coFilter(req, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
