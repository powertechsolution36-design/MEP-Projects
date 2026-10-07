'use strict';

/**
 * NEW role-check utility/middleware. Deliberately minimal for this stage —
 * only the role-gate patterns needed now (requireRole('admin'), multi-role
 * requireRole('finance','admin')), not a full permission framework. Business
 * action-level authorization (e.g. "only the assigned engineer may tick this
 * checklist point") is out of scope until the relevant business module.
 *
 * Must run AFTER authMiddleware (depends on req.auth being set).
 */
function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return function roleMiddleware(req, res, next) {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}

module.exports = { requireRole };
