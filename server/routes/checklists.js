const router = require('express').Router();
const auth = require('../middleware/auth');
const Checklist = require('../models/Checklist');

// GET all for company
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    if (req.query.div) filter.div = req.query.div;
    const docs = await Checklist.find(filter).sort({ name: 1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Checklist.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Checklist.create(data);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await Checklist.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await Checklist.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
