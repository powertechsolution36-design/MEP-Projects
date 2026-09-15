// requirePlatformAdmin() — gates Super-Admin-only platform commercial actions (Plan CRUD, AddOn
// catalog CRUD, Subscription assignment, manual entitlement overrides). Company Admin/Manager must
// NEVER become a platform commercial operator (V3 PHASE 3 spec §16) — this is a stricter, separate
// check from the ordinary permission/ownership layers, since none of the 10 generic PERMISSIONS
// constants represent "manage the platform's commercial catalog."
const { sendError } = require('../utils/ApiError');

function isPlatformAdmin(user) {
  return !!user && (user.role === 'super' || user.designation === 'super_admin');
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user) return sendError(res, 401, 'Auth required');
  if (!isPlatformAdmin(req.user)) {
    return sendError(res, 403, 'Platform commercial administration requires Super Admin authority');
  }
  next();
}

module.exports = { isPlatformAdmin, requirePlatformAdmin };
