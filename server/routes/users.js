const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');

function coFilter(req, id) { const f = { _id: id }; if (req.user.role !== 'super') f.co = req.user.co; return f; }

router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    const users = await User.find(filter).select('-pw').sort({ name: 1 });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const user = await User.create(data);
    const u = user.toObject(); delete u.pw;
    broadcastUpdate(global.io, data.co, req.user.role, 'user', u);
    res.status(201).json(u);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const update = { ...req.body };
    if (update.pw) {
      const user = await User.findOne(coFilter(req, req.params.id));
      if (!user) return res.status(404).json({ error: 'Not found' });
      Object.assign(user, update); await user.save();
      const u = user.toObject(); delete u.pw;
      broadcastUpdate(global.io, req.user.co, req.user.role, 'user', u);
      return res.json(u);
    }
    const user = await User.findOneAndUpdate(coFilter(req, req.params.id), update, { new: true }).select('-pw');
    if (!user) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'user', user);
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') return res.status(403).json({ error: 'Forbidden' });
    const doc = await User.findOneAndDelete(coFilter(req, req.params.id));
    if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'user', doc._id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
