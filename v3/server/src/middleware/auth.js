// V3 JWT auth — verifies against the SAME secret v2 uses (env.JWT_SECRET), so a v2-issued token
// is valid here without either side minting a new one. Loads the user through v3's OWN isolated
// User model (models/User.js on v3's connection), never v2's model object.
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const User = require('../models/User');
const { sendError } = require('../utils/ApiError');
const roleResolver = require('../services/roleResolver');

function sign(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES });
}

// Normalizes the authenticated user into the shape every downstream v3 middleware/service expects
// (STEP 5): userId, companyId, role, designation, department, division — without ever writing back
// to the User document. Password fields are excluded at the query level (`.select('-pw')`), never
// relied on to be stripped later. `resolved` (designation/department/division) comes from
// services/roleResolver.js — the same normalized triple regardless of whether the underlying record
// already carries designation/department (v3-native users) or only a legacy `role` (v2 users).
function buildAuthContext(user, resolved) {
  return {
    userId: user._id,
    companyId: user.co,
    role: user.role,
    legacyRole: user.role,
    designation: resolved.designation,
    department: resolved.department,
    division: resolved.division,
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

    // Read-only normalization — never written back to the User document (LEGACY_ROLE_COMPATIBILITY.md
    // "Rule of engagement" #1-3). req.user carries the resolved designation/department/division so
    // every downstream middleware (ownership/authorization/tenant/division/department/projectScope)
    // sees the same normalized values without each one re-resolving legacy role itself.
    const resolved = roleResolver.resolve(user);
    req.user = { ...user, designation: resolved.designation, department: resolved.department, division: resolved.division, legacyRole: user.role };
    req.authContext = buildAuthContext(user, resolved);  // normalized context per STEP 5
    req.token = token;
    next();
  } catch (err) {
    return sendError(res, 401, 'Invalid token');
  }
}

module.exports = { auth, sign, buildAuthContext };
