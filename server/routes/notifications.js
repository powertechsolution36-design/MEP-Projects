const router = require('express').Router();
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET notifications for user's company + role
router.get('/', auth, async (req, res) => {
  try {
    const filter = { co: req.user.co };
    const docs = await Notification.find(filter).sort({ createdAt: -1 }).limit(100);
    // Filter to those matching the user's role or wildcard
    const filtered = docs.filter(n => n.roles.includes(req.user.role) || n.roles.includes('*'));
    res.json(filtered);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create notification
router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, co: req.user.co };
    const doc = await Notification.create(data);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT mark as read — scoped to user's company
router.put('/:id/read', auth, async (req, res) => {
  try {
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.id, co: req.user.co },
      { $addToSet: { read: req.user.id } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
