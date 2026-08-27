const jwt = require('jsonwebtoken');
const User = require('../models/User');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES || '30d';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, SECRET);
    const user = await User.findById(decoded.id).select('-pw').lean();
    if (!user || user.disabled) return res.status(401).json({ error: 'Invalid user' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Division manager roles get admin-level access (but data is filtered by scope.js)
const DM_ROLES = ['hvac_dm', 'solar_dm', 'mep_dm'];

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (req.user.role === 'super') return next();
    // Division managers granted the same route access as admin (data filtered by scope)
    if (roles.includes('admin') && DM_ROLES.includes(req.user.role)) return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/**
 * Ensures a POST body has a company (co) set.
 * - Super admin must supply co in body
 * - Any other role must have co set on their user
 * Returns friendly error instead of raw Mongoose validation failure.
 */
function ensureCompany(req, res, next) {
  if (req.method !== 'POST') return next();
  if (req.user.role === 'super') {
    if (!req.body?.co) return res.status(400).json({ error: 'Company is required. Please select a company for this record.' });
  } else {
    if (!req.user.co) return res.status(400).json({ error: 'Your account is not assigned to any company. Ask an admin to assign one.' });
    req.body.co = req.user.co;
  }
  next();
}

module.exports = { auth, sign, requireRole, ensureCompany, SECRET };
