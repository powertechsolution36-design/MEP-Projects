const express = require('express');
const User = require('../models/User');
const { auth, requireRole } = require('../middleware/auth');
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
    if (req.query.role) f.role = req.query.role;
    const users = await User.find(f).select('-pw').sort({ name: 1 }).lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne(coFilter(req, req.params.id)).select('-pw').lean();
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    if (!data.pw) return res.status(400).json({ error: 'Password required' });
    const user = await User.create(data);
    const u = user.toObject(); delete u.pw;
    broadcastUpdate(global.io, u.co, 'user', u);
    res.status(201).json(u);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already exists' });
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.co;
    if (data.pw) {
      const user = await User.findOne(coFilter(req, req.params.id));
      if (!user) return res.status(404).json({ error: 'Not found' });
      Object.assign(user, data);
      await user.save();
      const u = user.toObject(); delete u.pw;
      broadcastUpdate(global.io, u.co, 'user', u);
      return res.json(u);
    }
    const user = await User.findOneAndUpdate(coFilter(req, req.params.id), data, { new: true }).select('-pw');
    if (!user) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, user.co, 'user', user);
    res.json(user);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findOneAndDelete(coFilter(req, req.params.id));
    if (!user) return res.status(404).json({ error: 'Not found' });
    broadcastDelete(global.io, user.co, 'user', user._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
