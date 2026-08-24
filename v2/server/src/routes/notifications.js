const express = require('express');
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');
const { broadcastUpdate } = require('../websocket/sync');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const f = { co: req.user.co };
    const docs = await Notification.find(f).sort({ createdAt: -1 }).limit(100).lean();
    const filtered = docs.filter(n => n.roles.includes(req.user.role) || n.roles.includes('*'));
    const out = filtered.map(n => ({ ...n, isRead: n.read?.some(id => String(id) === String(req.user._id)) }));
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Notification.create(data);
    broadcastUpdate(global.io, doc.co, 'notification', doc);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.id, co: req.user.co },
      { $addToSet: { read: req.user._id } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      { co: req.user.co, read: { $ne: req.user._id } },
      { $addToSet: { read: req.user._id } }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, co: req.user.co });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
