const express = require('express');
const Company = require('../models/Company');
const User = require('../models/User');
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

// Super admin creates a Company AND its initial Admin user atomically.
// Body: { name, code, ...companyFields, admin: { name, un, pw, email, phone } }
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'super') return res.status(403).json({ error: 'Only super can create companies' });
    const { admin, ...companyData } = req.body || {};
    if (!admin || !admin.un || !admin.pw || !admin.name) {
      return res.status(400).json({ error: 'Company admin (name, username, password) is required' });
    }
    // Check duplicate username first (fast fail, no orphan company)
    const un = String(admin.un).toLowerCase().trim();
    const dupe = await User.findOne({ un });
    if (dupe) return res.status(409).json({ error: `Username "${un}" already in use` });

    const co = await Company.create(companyData);
    try {
      const adminUser = await User.create({
        co: co._id,
        un,
        pw: admin.pw,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: 'admin',
      });
      broadcastUpdate(global.io, co._id, 'company', co);
      const u = adminUser.toObject(); delete u.pw;
      broadcastUpdate(global.io, co._id, 'user', u);
      res.status(201).json({ company: co, admin: u });
    } catch (uerr) {
      // Roll back company if admin creation failed
      await Company.findByIdAndDelete(co._id);
      throw uerr;
    }
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
