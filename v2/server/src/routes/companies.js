const express = require('express');
const Company = require('../models/Company');
const { auth, requireRole } = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    if (req.user.role === 'super') {
      const cos = await Company.find().sort({ name: 1 }).lean();
      return res.json(cos);
    }
    const co = await Company.findById(req.user.co).lean();
    res.json(co ? [co] : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'super' && String(req.user.co) !== String(req.params.id))
      return res.status(403).json({ error: 'Forbidden' });
    const co = await Company.findById(req.params.id).lean();
    if (!co) return res.status(404).json({ error: 'Not found' });
    res.json(co);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Only super can create companies' });
    const co = await Company.create(req.body);
    broadcastUpdate(global.io, co._id, 'company', co);
    res.status(201).json(co);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (req.user.role !== 'super' && String(req.user.co) !== String(req.params.id))
      return res.status(403).json({ error: 'Forbidden' });
    const co = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!co) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, co._id, 'company', co);
    res.json(co);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const co = await Company.findByIdAndDelete(req.params.id);
    if (!co) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, co._id, 'company', co._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
