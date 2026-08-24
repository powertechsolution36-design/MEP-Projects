const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Company = require('../models/Company');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { un, pw } = req.body;
    if (!un || !pw) return res.status(400).json({ error: 'Username and password required' });

    const user = await User.findOne({ un });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await user.comparePw(pw);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Check company status
    if (user.role !== 'super') {
      const company = await Company.findById(user.co);
      if (company && company.status === 'Suspended') {
        return res.status(403).json({ error: 'Company subscription suspended. Contact provider.' });
      }
      // Check division access for PM roles
      const divMap = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };
      if (divMap[user.role] && company) {
        const divs = company.divs && company.divs.length ? company.divs : ['HVAC', 'Solar', 'MEP'];
        if (!divs.includes(divMap[user.role])) {
          return res.status(403).json({ error: `${company.name} is not subscribed to the ${divMap[user.role]} division.` });
        }
      }
    }

    const token = jwt.sign(
      { id: user._id, co: user.co, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { id: user._id, co: user.co, name: user.name, role: user.role, un: user.un }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-pw');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const company = user.role !== 'super' ? await Company.findById(user.co) : null;
    res.json({ user, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
