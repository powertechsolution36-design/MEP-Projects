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
  const { userRepo, passwordHasher } = deps;

  if (!username || !password) {
    throw new AuthError(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  // DECISION (Completion order, approved by the owner): like the PWA
  // (index.html:1293, `DB.users.find(x => x.un===un && x.pw===pw)`), a user
  // logs in with username + password only; usernames are unique across the
  // whole platform (enforced on create/edit). A companyId may still be
  // supplied to disambiguate legacy data where two companies' users share a
  // username.
  let user = null;
  if (companyId || typeof userRepo.findLoginCandidates !== 'function') {
    user = await userRepo.findForLogin({ companyId, username });
    if (user && !(await passwordHasher.verifyPassword(password, user.passwordHash))) user = null;
  } else {
    const candidates = await userRepo.findLoginCandidates(username);
    const matches = [];
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await passwordHasher.verifyPassword(password, candidate.passwordHash)) matches.push(candidate);
    }
    if (matches.length > 1) {
      throw new AuthError(
        'More than one account uses this username. Ask your administrator to give your login a unique username.',
        'AMBIGUOUS_USERNAME'
      );
    }
    user = matches[0] || null;
  }
  if (!user) {
    throw new AuthError(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  // Only checked AFTER a correct password match, so an unauthenticated
  // guesser learns nothing about account existence/state from this branch.
  if (user.active === false) {
    throw new AuthError('This account is inactive.', 'ACCOUNT_INACTIVE');
  }

  await assertCompanyAllowsLogin(user, deps);
  return issueSession(user, deps);
}

/**
 * PWA FACT (index.html:1307, 1311-1316): a suspended company's users cannot
 * log in, and a project-manager role cannot log in when the company is not
 * subscribed to that PM's division. Super has no company.
 */
const PM_DIVISION = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

async function assertCompanyAllowsLogin(user, deps) {
  if (user.role === 'super' || !user.companyId || !deps.companyRepo) return;
  const company = await deps.companyRepo.findById(user.companyId);
  if (!company) throw new AuthError('Invalid or expired session.', 'SESSION_INVALID');
  if (company.status === 'Suspended') {
    throw new AuthError('Company subscription suspended. Contact provider.', 'COMPANY_SUSPENDED');
  }
  const need = PM_DIVISION[user.role];
  if (need) {
    let divisions = company.divisions && company.divisions.length ? company.divisions : ['HVAC', 'Solar', 'MEP'];
    if (deps.subscriptionRepo) {
      const sub = await deps.subscriptionRepo.findByCompany(user.companyId);
      if (sub && sub.status !== 'cancelled' && sub.status !== 'expired' && sub.purchasedDivisions) {
        divisions = sub.purchasedDivisions;
      }
    }
    if (!divisions.includes(need)) {
      throw new AuthError(`${company.name || 'Company'} is not subscribed to the ${need} division.`, 'DIVISION_NOT_SUBSCRIBED');
    }
  }
}

async function issueSession(user, deps) {
  const { sessionRepo, config } = deps;
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

  // The account is re-read on every request, so a deleted or deactivated
  // user loses access immediately and a changed role takes effect at once
  // (the token's role claim is never trusted on its own), and a suspended
  // company's users are cut off.
  let role = claims.role;
  let companyId = claims.companyId;
  let name;
  if (deps.userRepo && typeof deps.userRepo.findById === 'function') {
    const user = await deps.userRepo.findById(claims.sub);
    if (!user || user.active === false) {
      throw new AuthError('Invalid or expired session.', 'SESSION_INVALID');
    }
    if (String(user.companyId || '') !== String(claims.companyId || '')) {
      throw new AuthError('Invalid or expired session.', 'SESSION_INVALID');
    }
    role = user.role;
    companyId = user.companyId || null;
    name = user.name;
    await assertCompanyAllowsLogin(user, deps);
  }

  return {
    userId: claims.sub,
    companyId,
    role,
    name,
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
  assertCompanyAllowsLogin,
  login,
  verifySession,
  logout,
  toSafeUser,
  GENERIC_INVALID_CREDENTIALS,
};
