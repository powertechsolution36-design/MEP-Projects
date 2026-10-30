'use strict';

const { ServiceError } = require('../errors');
const { hashPassword, verifyPassword } = require('../auth/passwordHasher');
const { signAccessToken, verifyAccessToken } = require('../auth/tokenService');

/**
 * Customer portal — registration, staff approval, and login (owner decision,
 * 27 Oct 2026).
 *
 * The shape of the thing, because it is unusual:
 *
 *   A client registers with their mobile number. The server looks for a
 *   Contract (an AMC or Warranty record) carrying that number. The registrant
 *   never names a company or a contract and could not be believed if they
 *   did — the tenant comes from the matched contract alone.
 *
 *   Every registration lands as `Pending`. Nothing is accessible until a
 *   member of staff approves it. That is deliberate: this application has no
 *   SMS or email provider, so there is no way to prove the registrant holds
 *   the number. Staff approval IS the verification step, and it is the one
 *   the brief allows when a registrant cannot be safely matched. The OTP
 *   boundary is sketched in verificationChannel.js for the day a provider is
 *   bought; until then nothing here claims a number was verified.
 *
 *   The reply to a registration is the same whatever happened — matched, not
 *   matched, or already registered. Otherwise the form would answer "is this
 *   number one of your clients?" for anyone who asked.
 */

const PENDING = 'Pending';
const ACTIVE = 'Active';

/** Digits only, no trunk zero, 10-digit Indian numbers given their 91. */
function normalizePhone(value, countryCode = '91') {
  let d = String(value || '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^0+/, '');
  if (d.length === 10) d = countryCode + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

function portalError(message, code = 'PORTAL_ERROR', status = 400) {
  return new ServiceError(message, code, status);
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * The app has none anywhere else, and these are its first endpoints a
 * stranger can reach. In-process and per-key: enough to stop a script
 * guessing passwords or farming the registration form from one machine.
 * It is NOT a defence against a distributed attempt — a reverse-proxy or
 * WAF rule is the right place for that, and PORTAL.md says so.
 * ------------------------------------------------------------------ */
const buckets = new Map();

function rateLimit(key, { max, windowMs }, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > max) {
    const secs = Math.ceil((b.resetAt - now) / 1000);
    throw portalError(`Too many attempts. Try again in ${secs} seconds.`, 'RATE_LIMITED', 429);
  }
}

/** Test seam: clears the in-process counters. */
function resetRateLimits() {
  buckets.clear();
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

const GENERIC_REGISTER_REPLY = Object.freeze({
  registered: true,
  message: 'Thank you. Our team will check your details and activate your account.',
});

/**
 * @param {object} input { name, phone, password, email?, site? }
 * @param {object} deps  { customerAccountRepo, contractRepo }
 * @param {object} opts  { ip }
 */
async function registerCustomer(input, deps, { ip = 'unknown' } = {}) {
  rateLimit(`register:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 });

  const name = String((input && input.name) || '').trim();
  const phone = normalizePhone(input && input.phone);
  const password = String((input && input.password) || '');
  const email = String((input && input.email) || '').trim().toLowerCase();
  const claimedSite = String((input && input.site) || '').trim().slice(0, 200);

  if (name.length < 2) throw portalError('Enter your name.', 'INVALID_NAME');
  if (!phone) throw portalError('Enter a valid mobile number.', 'INVALID_PHONE');
  if (password.length < 8) throw portalError('Choose a password of at least 8 characters.', 'WEAK_PASSWORD');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw portalError('Enter a valid email address.', 'INVALID_EMAIL');

  // Already registered? Say nothing different from any other outcome.
  const existing = await deps.customerAccountRepo.findByPhone(phone);
  if (existing) return { ...GENERIC_REGISTER_REPLY };

  // The tenant is decided here, by the data, and nowhere else. Contracts
  // keep the number as it was typed, so candidates are narrowed in the
  // repository and then compared as properly normalised values.
  const national = phone.slice(-10);
  const candidates = await deps.contractRepo.findCandidatesByPhoneDigits(national);
  const matches = candidates.filter((c) => normalizePhone(c.phone) === phone);
  let companyId = null;
  let contractId = null;
  let matchResult = 'no-match';
  if (matches.length === 1) {
    companyId = matches[0].companyId;
    contractId = matches[0].id;
    matchResult = 'matched';
  } else if (matches.length > 1) {
    // Several clients share the number — staff decide which one.
    const sameCompany = matches.every((m) => String(m.companyId) === String(matches[0].companyId));
    companyId = sameCompany ? matches[0].companyId : null;
    matchResult = 'ambiguous';
  }

  await deps.customerAccountRepo.create({
    companyId,
    contractId,
    phone,
    name,
    email,
    passwordHash: await hashPassword(password),
    status: PENDING,
    claimedSite,
    matchResult,
  });

  return { ...GENERIC_REGISTER_REPLY };
}

/* ------------------------------------------------------------------ *
 * Staff review
 * ------------------------------------------------------------------ */

const REVIEW_ROLES = Object.freeze(['admin', 'service_mgr']);

function assertCanReview(actorAuth) {
  if (actorAuth.role === 'super') return;
  if (!REVIEW_ROLES.includes(actorAuth.role)) {
    throw portalError(`Role "${actorAuth.role}" cannot review customer accounts.`, 'FORBIDDEN', 403);
  }
}

/** Never returns a password hash, and never another company's accounts. */
function publicAccount(a, contract) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    email: a.email || '',
    status: a.status,
    claimedSite: a.claimedSite || '',
    matchResult: a.matchResult || 'no-match',
    contractId: a.contractId || null,
    linkedProjectIds: (a.linkedProjectIds || []).map(String),
    contract: contract ? { id: contract.id, customer: contract.customer, site: contract.site, category: contract.category } : null,
    createdAt: a.createdAt || null,
    approvedAt: a.approvedAt || null,
    lastLoginAt: a.lastLoginAt || null,
    decisionNote: a.decisionNote || '',
  };
}

async function listCustomerAccounts(companyId, filters, actorAuth, deps) {
  assertCanReview(actorAuth);
  const rows = await deps.customerAccountRepo.listByCompany(companyId, filters || {});
  const out = [];
  for (const a of rows) {
    // eslint-disable-next-line no-await-in-loop
    const c = a.contractId ? await deps.contractRepo.findById(companyId, a.contractId) : null;
    out.push(publicAccount(a, c));
  }
  return out;
}

/**
 * Approve a registration, binding it to one contract. Staff may name the
 * contract when the phone number matched none or several — but it is read
 * from THIS company, so an account can never be pointed at another tenant.
 */
async function approveCustomerAccount(companyId, accountId, input, actorAuth, deps) {
  assertCanReview(actorAuth);
  const account = await deps.customerAccountRepo.findByIdForCompany(companyId, accountId);
  if (!account) throw portalError('Customer account not found.', 'NOT_FOUND', 404);

  const wantedContractId = (input && input.contractId) || account.contractId;
  if (!wantedContractId) {
    throw portalError('Choose which AMC / Warranty client this account belongs to.', 'CONTRACT_REQUIRED');
  }
  const contract = await deps.contractRepo.findById(companyId, wantedContractId);
  if (!contract) throw portalError('That AMC / Warranty client was not found.', 'NOT_FOUND', 404);

  const updated = await deps.customerAccountRepo.updateFields(accountId, {
    companyId,
    contractId: contract.id,
    status: ACTIVE,
    approvedByUserId: actorAuth.userId,
    approvedAt: new Date(),
    decisionNote: String((input && input.note) || '').slice(0, 300),
  });
  return publicAccount(updated, contract);
}

/** Refuse a registration, or switch off an account that was active. */
async function setCustomerAccountStatus(companyId, accountId, status, input, actorAuth, deps) {
  assertCanReview(actorAuth);
  if (!['Rejected', 'Disabled', 'Pending'].includes(status)) {
    throw portalError('Unknown account status.', 'INVALID_STATUS');
  }
  const account = await deps.customerAccountRepo.findByIdForCompany(companyId, accountId);
  if (!account) throw portalError('Customer account not found.', 'NOT_FOUND', 404);

  const updated = await deps.customerAccountRepo.updateFields(accountId, {
    status,
    decisionNote: String((input && input.note) || '').slice(0, 300),
  });
  // Shutting an account means shutting the sessions it already holds.
  if (status !== 'Pending') await deps.customerSessionRepo.revokeAllForAccount(accountId);
  const contract = updated.contractId ? await deps.contractRepo.findById(companyId, updated.contractId) : null;
  return publicAccount(updated, contract);
}

/* ------------------------------------------------------------------ *
 * Login / session
 * ------------------------------------------------------------------ */

async function loginCustomer(input, deps, { ip = 'unknown' } = {}) {
  const phone = normalizePhone(input && input.phone);
  rateLimit(`login:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (phone) rateLimit(`login-phone:${phone}`, { max: 8, windowMs: 15 * 60 * 1000 });

  const password = String((input && input.password) || '');
  const invalid = () => portalError('Mobile number or password is incorrect.', 'INVALID_CREDENTIALS', 401);
  if (!phone || !password) throw invalid();

  const account = await deps.customerAccountRepo.findByPhone(phone);
  if (!account) throw invalid();
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) throw invalid();

  // Why the account cannot sign in is safe to say once the password is
  // right — it is their own account, and they need to know to wait.
  if (account.status === PENDING) {
    throw portalError('Your account is waiting to be activated by our team.', 'ACCOUNT_PENDING', 403);
  }
  if (account.status !== ACTIVE) {
    throw portalError('This account is not active. Please contact us.', 'ACCOUNT_INACTIVE', 403);
  }
  if (!account.companyId || !account.contractId) {
    throw portalError('This account is not linked to a service record yet.', 'ACCOUNT_UNLINKED', 403);
  }

  const now = new Date();
  const ttlMs = (deps.config && deps.config.portalSessionMs) || 7 * 24 * 60 * 60 * 1000;
  const session = await deps.customerSessionRepo.create({
    accountId: account.id,
    companyId: account.companyId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  await deps.customerAccountRepo.updateFields(account.id, { lastLoginAt: now });

  const token = signAccessToken(
    // `kind` is belt and braces: a customer session id is not in the staff
    // session store either, so a staff endpoint rejects this token anyway.
    { sub: String(account.id), companyId: String(account.companyId), kind: 'customer', sid: String(session.id) },
    deps.config.authTokenSecret,
    Math.floor(ttlMs / 1000)
  );
  return { token, account: publicAccount(account, null) };
}

async function verifyCustomerSession(token, deps) {
  let claims;
  try {
    claims = verifyAccessToken(token, deps.config.authTokenSecret);
  } catch {
    throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);
  }
  if (claims.kind !== 'customer') throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);

  const session = await deps.customerSessionRepo.findActive(claims.sid);
  if (!session) throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);

  // Re-read the account every request, so disabling one takes effect at once.
  const account = await deps.customerAccountRepo.findById(claims.sub);
  if (!account || account.status !== ACTIVE) throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);
  if (String(account.companyId || '') !== String(session.companyId || '')) {
    throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);
  }
  if (!account.contractId) throw portalError('Invalid or expired session.', 'SESSION_INVALID', 401);

  return {
    accountId: String(account.id),
    companyId: String(account.companyId),
    contractId: String(account.contractId),
    sessionId: String(session.id),
    name: account.name,
    phone: account.phone,
    // Owner decision (30 Oct 2026): the projects this client may watch,
    // read from the account on every request along with its status — so
    // unlinking a project takes effect on the client's next page load, the
    // same way disabling an account does.
    linkedProjectIds: (account.linkedProjectIds || []).map(String),
  };
}

async function logoutCustomer(sessionId, deps) {
  await deps.customerSessionRepo.revoke(sessionId);
  return { loggedOut: true };
}


/* ------------------------------------------------------------------ *
 * Which projects a client may watch (owner decision, 30 Oct 2026)
 *
 * A client's access to a project is a stored fact a member of staff put
 * there. This module helps them find the right project and records the
 * decision; it never grants access on its own.
 *
 * The ranking below is a CONVENIENCE, not an authorization. It exists so
 * that linking the obvious project is one click instead of a hunt through
 * every project in the company. A high score grants nothing: only
 * setLinkedProjects writes, and only a person can call it.
 * ------------------------------------------------------------------ */

/** Lower case, punctuation out, meaningless words out. */
const NOISE_WORDS = new Set([
  'the', 'and', 'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'co',
  'project', 'site', 'hvac', 'solar', 'mep', 'mr', 'mrs', 'dr', 'ms',
]);

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 2 && !NOISE_WORDS.has(t));
}

/**
 * How strongly a project's text looks like this client's text. The share of
 * the client's distinctive words that the project repeats — so a project
 * named for the site scores high, and a long project name full of unrelated
 * words is not rewarded for its length.
 */
function matchScore(clientTokens, projectTokens) {
  if (clientTokens.size === 0 || projectTokens.size === 0) return 0;
  let hits = 0;
  for (const t of clientTokens) if (projectTokens.has(t)) hits += 1;
  return Math.round((hits / clientTokens.size) * 100);
}

async function listProjectCandidates(companyId, accountId, actorAuth, deps) {
  assertCanReview(actorAuth);
  const account = await deps.customerAccountRepo.findByIdForCompany(companyId, accountId);
  if (!account) throw portalError('Customer account not found.', 'NOT_FOUND', 404);

  const contract = account.contractId
    ? await deps.contractRepo.findById(companyId, account.contractId)
    : null;

  const clientTokens = new Set([
    ...tokens(contract && contract.customer),
    ...tokens(contract && contract.site),
    ...tokens(account.name),
    ...tokens(account.claimedSite),
  ]);

  const linked = new Set((account.linkedProjectIds || []).map(String));
  const projects = await deps.projectRepo.listByCompany(companyId);

  return projects
    .map((p) => ({
      id: String(p.id || p._id),
      name: p.name || '',
      division: p.division || '',
      customer: p.customer || '',
      stage: p.stage || '',
      status: p.status || '',
      startDate: p.startDate || null,
      linked: linked.has(String(p.id || p._id)),
      score: matchScore(clientTokens, new Set([...tokens(p.customer), ...tokens(p.name)])),
    }))
    .sort((a, b) => {
      // Already linked first so staff can see and undo what is in force,
      // then the likeliest matches, then the rest newest-first.
      if (a.linked !== b.linked) return a.linked ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.startDate || 0) - new Date(a.startDate || 0);
    });
}

/**
 * Record exactly which projects this client may watch. The whole list is
 * replaced, so removing a project is the same operation as adding one, and
 * an empty list is a valid answer meaning "no projects".
 *
 * Every id is checked against THIS company before it is stored. An id for
 * another tenant's project is not an error to argue about — it is dropped,
 * and the reply says what was actually saved.
 */
async function setLinkedProjects(companyId, accountId, projectIds, actorAuth, deps) {
  assertCanReview(actorAuth);
  const account = await deps.customerAccountRepo.findByIdForCompany(companyId, accountId);
  if (!account) throw portalError('Customer account not found.', 'NOT_FOUND', 404);
  if (!Array.isArray(projectIds)) {
    throw portalError('projectIds must be a list.', 'VALIDATION_ERROR');
  }
  if (projectIds.length > 100) {
    throw portalError('That is more projects than one client account can hold.', 'VALIDATION_ERROR');
  }

  const unique = [...new Set(projectIds.map(String))];
  const found = await deps.projectRepo.listByIdsForCompany(companyId, unique);
  const valid = found.map((p) => String(p.id || p._id));

  const updated = await deps.customerAccountRepo.updateFields(accountId, { linkedProjectIds: valid });
  const contract = updated.contractId ? await deps.contractRepo.findById(companyId, updated.contractId) : null;
  return {
    account: publicAccount(updated, contract),
    ignored: unique.filter((id) => !valid.includes(id)),
  };
}

module.exports = {
  normalizePhone,
  listProjectCandidates,
  setLinkedProjects,
  matchScore,
  tokens,
  registerCustomer,
  listCustomerAccounts,
  approveCustomerAccount,
  setCustomerAccountStatus,
  loginCustomer,
  verifyCustomerSession,
  logoutCustomer,
  publicAccount,
  resetRateLimits,
  REVIEW_ROLES,
};
