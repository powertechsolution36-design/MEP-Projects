const router = require('express').Router();
const auth = require('../middleware/auth');
const Company = require('../models/Company');

// GET all companies (super only)
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const companies = await Company.find().sort({ createdAt: -1 });
    res.json(companies);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single company
router.get('/:id', auth, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'super' && String(req.user.co) !== String(company._id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(company);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create company (super only)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const company = await Company.create(req.body);
    res.status(201).json(company);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update company
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'super' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const company = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!company) return res.status(404).json({ error: 'Not found' });
    res.json(company);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE company (super only)
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    await Company.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
