// V3 JWT auth — verifies against the SAME secret v2 uses (env.JWT_SECRET), so a v2-issued token
// is valid here without either side minting a new one. Loads the user through v3's OWN isolated
// User model (models/User.js on v3's connection), never v2's model object.
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const User = require('../models/User');
const { sendError } = require('../utils/ApiError');

function sign(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES });
}

// Normalizes the authenticated user into the shape every downstream v3 middleware/service expects
// (STEP 5): userId, companyId, role, designation, department, division — without ever writing back
// to the User document. Password fields are excluded at the query level (`.select('-pw')`), never
// relied on to be stripped later.
function buildAuthContext(user) {
  return {
    userId: user._id,
    companyId: user.co,
    role: user.role,
    designation: user.designation,
    department: user.department,
    division: user.division,
  };
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return sendError(res, 401, 'No token provided');

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      return sendError(res, 401, 'Invalid token');
    }

    const user = await User.findById(decoded.id).select('-pw').lean();
    if (!user || user.disabled) return sendError(res, 401, 'Invalid user');

    req.user = user;              // full record (minus password) — kept for backward-compatible reads
    req.authContext = buildAuthContext(user);  // normalized context per STEP 5
    req.token = token;
    next();
  } catch (err) {
    return sendError(res, 401, 'Invalid token');
  }
}

module.exports = { auth, sign, buildAuthContext };
