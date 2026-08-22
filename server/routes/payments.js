const router = require('express').Router();
const auth = require('../middleware/auth');
const Payment = require('../models/Payment');

// GET all
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    if (req.query.status) filter.status = req.query.status;
    const docs = await Payment.find(filter).sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Payment.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Payment.create(data);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT add partial payment
router.put('/:id/paid', auth, async (req, res) => {
  try {
    const doc = await Payment.findByIdAndUpdate(
      req.params.id,
      { $push: { paid: req.body } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
