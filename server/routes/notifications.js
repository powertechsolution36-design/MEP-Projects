const router = require('express').Router();
const auth = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const Notification = require('../models/Notification');

router.get('/', auth, async (req, res) => {
  try {
    const filter = { co: req.user.co };
    const docs = await Notification.find(filter).sort({ createdAt: -1 }).limit(100);
    const filtered = docs.filter(n => n.roles.includes(req.user.role) || n.roles.includes('*'));
    res.json(filtered);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Notification.create(data);
    broadcastUpdate(global.io, req.user.co, req.user.role, 'notification', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.id, co: req.user.co },
      { $addToSet: { read: req.user.id } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate(global.io, req.user.co, req.user.role, 'notification', doc);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
