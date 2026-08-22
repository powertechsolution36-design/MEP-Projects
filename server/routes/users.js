const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

function coFilter(req, id) {
  const f = { _id: id };
  if (req.user.role !== 'super') f.co = req.user.co;
  return f;
}

// GET users for company
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'super' ? {} : { co: req.user.co };
    const users = await User.find(filter).select('-pw').sort({ name: 1 });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create user
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = { ...req.body };
    if (req.user.role !== 'super') data.co = req.user.co;
    const user = await User.create(data);
    const u = user.toObject();
    delete u.pw;
    res.status(201).json(u);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update user
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const update = { ...req.body };
    // If password is being updated, let the pre-save hook hash it
    if (update.pw) {
      const user = await User.findOne(coFilter(req, req.params.id));
      if (!user) return res.status(404).json({ error: 'Not found' });
      Object.assign(user, update);
      await user.save();
      const u = user.toObject();
      delete u.pw;
      return res.json(u);
    }
    const user = await User.findOneAndUpdate(coFilter(req, req.params.id), update, { new: true }).select('-pw');
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE user
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await User.findOneAndDelete(coFilter(req, req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
