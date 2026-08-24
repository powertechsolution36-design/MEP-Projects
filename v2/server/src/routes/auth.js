const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Company = require('../models/Company');
const { auth, sign } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { un, pw, co } = req.body || {};
    if (!un || !pw) return res.status(400).json({ error: 'Username and password required' });
    const filter = { un: String(un).toLowerCase().trim(), disabled: false };
    if (co) filter.co = co;
    const user = await User.findOne(filter);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await user.comparePw(pw);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = sign({ id: user._id, role: user.role, co: user.co });
    const company = user.co ? await Company.findById(user.co).lean() : null;
    const u = user.toObject(); delete u.pw;
    res.json({ token, user: u, company });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const company = req.user.co ? await Company.findById(req.user.co).lean() : null;
    res.json({ user: req.user, company });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/change-password', auth, async (req, res) => {
  try {
    const { current, next } = req.body || {};
    if (!next || next.length < 6) return res.status(400).json({ error: 'New password too short' });
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const ok = await user.comparePw(current || '');
    if (!ok) return res.status(401).json({ error: 'Current password wrong' });
    user.pw = next;
    await user.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
