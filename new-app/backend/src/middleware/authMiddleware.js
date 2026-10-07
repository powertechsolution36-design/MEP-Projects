'use strict';

const { verifySession, AuthError } = require('../auth/authService');

/**
 * NEW application authentication middleware — validates this backend's own
 * token/session, identifies the user AND their company, and attaches that
 * identity to the request context as `req.auth`. Never copied from V2/V3.
 *
 * `req.auth.companyId` is the ONLY source of tenant context for everything
 * downstream — see src/middleware/tenantGuard.js. It comes exclusively from
 * the verified session, never from client-supplied request data.
 *
 * @param {object} deps - { sessionRepo, config } (see authService.verifySession)
 */
function createAuthMiddleware(deps) {
  return async function authMiddleware(req, res, next) {
    const header = req.headers && req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const identity = await verifySession(token, deps);
      req.auth = identity; // { userId, companyId, role, sessionId }
      return next();
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: err.message });
      }
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
  };
}

module.exports = { createAuthMiddleware };
