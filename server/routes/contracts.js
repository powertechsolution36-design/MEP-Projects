const router = require('express').Router();
const auth = require('../middleware/auth');
const Contract = require('../models/Contract');

function coFilter(req, id) {
  const f = { _id: id };
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

// GET all
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    const docs = await Contract.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Contract.findOne(coFilter(req, req.params.id));
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Contract.create(data);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await Contract.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update service schedule entry
router.put('/:id/svcs/:idx', auth, async (req, res) => {
  try {
    const contract = await Contract.findOne(coFilter(req, req.params.id));
    if (!contract) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= contract.svcs.length) return res.status(400).json({ error: 'Invalid index' });
    Object.assign(contract.svcs[idx], req.body);
    await contract.save();
    res.json(contract);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await Contract.findOneAndDelete(coFilter(req, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
