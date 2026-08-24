const router = require('express').Router();
const auth = require('../middleware/auth');
const { broadcastUpdate, broadcastDelete } = require('../websocket/sync');
const InvCategory = require('../models/InvCategory');
const InvLocation = require('../models/InvLocation');
const InvItem = require('../models/InvItem');
const InvIssue = require('../models/InvIssue');
const InvTransaction = require('../models/InvTransaction');

function coFilter(req, id) { const f = { _id: id }; if (req.user.role !== 'super') f.co = req.user.co; return f; }

router.get('/categories', auth, async (req, res) => {
  try { const filter = req.user.role === 'super' ? {} : { co: req.user.co }; res.json(await InvCategory.find(filter).sort({ name: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/categories', auth, async (req, res) => {
  try { const doc = await InvCategory.create({ ...req.body, co: req.user.co }); broadcastUpdate(global.io, req.user.co, req.user.role, 'category', doc); res.status(201).json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/categories/:id', auth, async (req, res) => {
  try { const doc = await InvCategory.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true }); if (!doc) return res.status(404).json({ error: 'Not found' }); broadcastUpdate(global.io, req.user.co, req.user.role, 'category', doc); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/categories/:id', auth, async (req, res) => {
  try { const doc = await InvCategory.findOneAndDelete(coFilter(req, req.params.id)); if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'category', doc._id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/locations', auth, async (req, res) => {
  try { const filter = req.user.role === 'super' ? {} : { co: req.user.co }; res.json(await InvLocation.find(filter).sort({ name: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/locations', auth, async (req, res) => {
  try { const doc = await InvLocation.create({ ...req.body, co: req.user.co }); broadcastUpdate(global.io, req.user.co, req.user.role, 'location', doc); res.status(201).json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/locations/:id', auth, async (req, res) => {
  try { const doc = await InvLocation.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true }); if (!doc) return res.status(404).json({ error: 'Not found' }); broadcastUpdate(global.io, req.user.co, req.user.role, 'location', doc); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/locations/:id', auth, async (req, res) => {
  try { const doc = await InvLocation.findOneAndDelete(coFilter(req, req.params.id)); if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'location', doc._id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/items', auth, async (req, res) => {
  try { const filter = req.user.role === 'super' ? {} : { co: req.user.co }; if (req.query.cat) filter.cat = req.query.cat; res.json(await InvItem.find(filter).sort({ name: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/items/:id', auth, async (req, res) => {
  try { const doc = await InvItem.findOne(coFilter(req, req.params.id)); if (!doc) return res.status(404).json({ error: 'Not found' }); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/items', auth, async (req, res) => {
  try { const doc = await InvItem.create({ ...req.body, co: req.user.co }); broadcastUpdate(global.io, req.user.co, req.user.role, 'invitem', doc); res.status(201).json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/items/:id', auth, async (req, res) => {
  try { const doc = await InvItem.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true }); if (!doc) return res.status(404).json({ error: 'Not found' }); broadcastUpdate(global.io, req.user.co, req.user.role, 'invitem', doc); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/items/:id', auth, async (req, res) => {
  try { const doc = await InvItem.findOneAndDelete(coFilter(req, req.params.id)); if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'invitem', doc._id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/issues', auth, async (req, res) => {
  try { const filter = req.user.role === 'super' ? {} : { co: req.user.co }; if (req.query.status) filter.status = req.query.status; if (req.query.staff) filter.staff = req.query.staff; res.json(await InvIssue.find(filter).sort({ createdAt: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/issues/:id', auth, async (req, res) => {
  try { const doc = await InvIssue.findOne(coFilter(req, req.params.id)); if (!doc) return res.status(404).json({ error: 'Not found' }); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/issues', auth, async (req, res) => {
  try { const doc = await InvIssue.create({ ...req.body, co: req.user.co }); broadcastUpdate(global.io, req.user.co, req.user.role, 'issue', doc); res.status(201).json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/issues/:id', auth, async (req, res) => {
  try { const doc = await InvIssue.findOneAndUpdate(coFilter(req, req.params.id), req.body, { new: true }); if (!doc) return res.status(404).json({ error: 'Not found' }); broadcastUpdate(global.io, req.user.co, req.user.role, 'issue', doc); res.json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/issues/:id', auth, async (req, res) => {
  try { const doc = await InvIssue.findOneAndDelete(coFilter(req, req.params.id)); if (doc) broadcastDelete(global.io, req.user.co, req.user.role, 'issue', doc._id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/transactions', auth, async (req, res) => {
  try { const filter = req.user.role === 'super' ? {} : { co: req.user.co }; if (req.query.item) filter.item = req.query.item; if (req.query.type) filter.type = req.query.type; res.json(await InvTransaction.find(filter).sort({ createdAt: -1 }).limit(500)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/transactions', auth, async (req, res) => {
  try { const doc = await InvTransaction.create({ ...req.body, co: req.user.co }); broadcastUpdate(global.io, req.user.co, req.user.role, 'transaction', doc); res.status(201).json(doc); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
