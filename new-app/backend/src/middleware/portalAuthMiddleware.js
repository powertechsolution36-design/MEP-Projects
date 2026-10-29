'use strict';

const { verifyCustomerSession } = require('../services/portalAuthService');

/**
 * Authenticates a CLIENT, not a member of staff (owner decision,
 * 27 Oct 2026).
 *
 * `req.portal` is deliberately a different property from `req.auth`. Nothing
 * downstream of the staff middleware can mistake one for the other, and no
 * route can accidentally satisfy a staff guard with a client's identity:
 * roleMiddleware and tenantGuard read `req.auth`, which this never sets.
 *
 * `req.portal.companyId` and `req.portal.contractId` come from the verified
 * session and the account behind it — never from the request.
 */
function createPortalAuthMiddleware(deps) {
  return async function portalAuthMiddleware(req, res, next) {
    const header = req.headers && req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    try {
      req.portal = await verifyCustomerSession(token, deps);
      return next();
    } catch {
      // One answer for every cause: expired, revoked, a staff token, or an
      // account that has just been switched off.
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
  };
}

module.exports = { createPortalAuthMiddleware };
