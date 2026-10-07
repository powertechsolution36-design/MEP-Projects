'use strict';

const ms = require('ms');
const { signAccessToken, verifyAccessToken } = require('./tokenService');

/**
 * Authentication service — NEW BACKEND DESIGN, entirely owned by this
 * application. Functional requirement from the PWA: username/password login,
 * an authenticated employee session, role-aware and company-aware access.
 * The PWA itself has no server/session concept at all to copy from.
 *
 * All persistence is via injected repositories (userRepo/sessionRepo), never
 * called directly here — this keeps the auth logic itself fully unit
 * testable without any live database connection (production wiring for the
 * real Mongoose-backed repositories lives in src/auth/repositories.mongoose.js).
 *
 * A single generic error is thrown for "unknown username" and "wrong
 * password" so a caller (the HTTP layer) cannot distinguish which was the
 * cause — this matches the instruction that authentication failures must not
 * reveal whether username or password was the precise cause.
 */

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthError';
    this.code = code || 'AUTH_FAILED';
  }
}

const GENERIC_INVALID_CREDENTIALS = 'Invalid username or password.';

/**
 * @param {{ username: string, password: string, companyId?: string|null }} input
 *   companyId is required for every role except `super` (see USERNAME RULE:
 *   username is only unique WITHIN a company, so a bare username cannot be
 *   resolved to one account without knowing which company it belongs to;
 *   `super` accounts are cross-tenant and have no companyId).
 * @param {{
 *   userRepo: { findForLogin: (args: {companyId: string|null, username: string}) => Promise<object|null> },
 *   sessionRepo: { createSession: (args: object) => Promise<{id: string}> },
 *   passwordHasher: { verifyPassword: (plain: string, hash: string) => Promise<boolean> },
 *   config: { authTokenSecret: string, authTokenExpiry: string },
 * }} deps
 */
async function login({ username, password, companyId = null }, deps) {
  const { userRepo, sessionRepo, passwordHasher, config } = deps;

  if (!username || !password) {
    throw new AuthError(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  const user = await userRepo.findForLogin({ companyId, username });
  if (!user) {
    throw new AuthError(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  const passwordOk = await passwordHasher.verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    throw new AuthError(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  // Only checked AFTER a correct password match, so an unauthenticated
  // guesser learns nothing about account existence/state from this branch.
  if (user.active === false) {
    throw new AuthError('This account is inactive.', 'ACCOUNT_INACTIVE');
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ms(config.authTokenExpiry));

  const session = await sessionRepo.createSession({
    userId: user.id,
    companyId: user.companyId || null,
    role: user.role,
    issuedAt,
    expiresAt,
  });

  const token = signAccessToken(
    { sub: user.id, companyId: user.companyId || null, role: user.role, sid: session.id },
    config.authTokenSecret,
    config.authTokenExpiry
  );

  return {
    token,
    user: toSafeUser(user),
    expiresAt,
  };
}

/**
 * Verifies a bearer token AND that its backing session is still active
 * (un-revoked, unexpired) — this is what makes logout actually invalidate a
 * token before its JWT `exp` would otherwise let it through.
 *
 * @returns {{ userId: string, companyId: string|null, role: string, sessionId: string }}
 * @throws {AuthError} on any invalid/expired/revoked condition — one generic message.
 */
async function verifySession(token, deps) {
  const { sessionRepo, config } = deps;
  let claims;
  try {
    claims = verifyAccessToken(token, config.authTokenSecret);
  } catch {
    throw new AuthError('Invalid or expired session.', 'SESSION_INVALID');
  }

  const session = await sessionRepo.findActiveSession(claims.sid);
  if (!session) {
    throw new AuthError('Invalid or expired session.', 'SESSION_INVALID');
  }

  return {
    userId: claims.sub,
    companyId: claims.companyId,
    role: claims.role,
    sessionId: claims.sid,
  };
}

/**
 * Revokes the session backing a token (logout). Idempotent: revoking an
 * already-revoked/nonexistent session is not an error.
 */
async function logout(sessionId, deps) {
  const { sessionRepo } = deps;
  await sessionRepo.revokeSession(sessionId);
}

function toSafeUser(user) {
  // Never include passwordHash or any internal credential/secret material.
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    companyId: user.companyId || null,
    active: user.active !== false,
  };
}

module.exports = {
  AuthError,
  login,
  verifySession,
  logout,
  toSafeUser,
  GENERIC_INVALID_CREDENTIALS,
};
