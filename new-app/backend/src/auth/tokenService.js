'use strict';

const jwt = require('jsonwebtoken');

/**
 * Signed session/token mechanism — NEW BACKEND DESIGN, owned entirely by this
 * application. Does not use, read, or share any V2/V3 secret, token format,
 * or verification logic.
 *
 * The token is a JWT whose payload identifies the authenticated user, their
 * company (tenant), role, and the backing session record (`sid`) used for
 * server-side logout/invalidation (see src/auth/authService.js). The token's
 * signature and `exp` claim are verified on every request by authMiddleware;
 * `sid` is additionally checked against the session store so a session can be
 * revoked (logged out) before its token would otherwise expire.
 */

/**
 * @param {{ sub: string, companyId: string|null, role: string, sid: string }} claims
 * @param {string} secret
 * @param {string|number} expiresIn - jsonwebtoken "expiresIn" value (e.g. "15m")
 * @returns {string} signed JWT
 */
function signAccessToken(claims, secret, expiresIn) {
  if (!secret) {
    throw new Error('AUTH_TOKEN_SECRET is not configured. Refusing to sign a token without a secret.');
  }
  return jwt.sign(claims, secret, { expiresIn });
}

/**
 * @param {string} token
 * @param {string} secret
 * @returns {{ sub: string, companyId: string|null, role: string, sid: string, iat: number, exp: number }}
 * @throws {Error} if the token is missing, malformed, expired, or signed with a different secret.
 */
function verifyAccessToken(token, secret) {
  if (!secret) {
    throw new Error('AUTH_TOKEN_SECRET is not configured. Refusing to verify a token without a secret.');
  }
  if (!token) {
    throw new Error('No token provided.');
  }
  // jwt.verify throws (TokenExpiredError / JsonWebTokenError) on any problem —
  // callers (authMiddleware) catch this and respond with a generic
  // "invalid or expired session" error, never distinguishing the exact cause.
  return jwt.verify(token, secret);
}

module.exports = { signAccessToken, verifyAccessToken };
