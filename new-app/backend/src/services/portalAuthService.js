'use strict';

const crypto = require('crypto');
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
  let companyId = null;
  let contractId = null;
  let projectIds = [];
  let matchResult = 'no-match';
  let invite = null;

  /*
   * An invite decides the identity (owner decision, 31 Oct 2026).
   *
   * A client registering from a new number, a colleague's phone or the
   * office line matches no contract, so matching on the number alone used to
   * leave them attached to nothing. When they open the link we sent, the
   * link says who they are and the number is beside the point.
   *
   * It does NOT activate them: the account still arrives Pending and still
   * needs approving. A used invite is refused a second time rather than
   * quietly minting a rival login for the same client.
   */
  const inviteToken = String((input && input.invite) || '').trim();
  if (inviteToken && deps.portalInviteRepo) {
    invite = await deps.portalInviteRepo.findByToken(inviteToken);
    if (invite && !invite.revokedAt && !invite.usedByAccountId) {
      companyId = invite.companyId;
      contractId = invite.contractId || null;
      projectIds = (invite.projectIds || []).map(String);
      matchResult = 'invited';
    } else {
      // Spent, revoked or unknown — fall through to matching on the number,
      // and say nothing different from any other outcome.
      invite = null;
    }
  }

  if (matchResult !== 'invited') {
    // The tenant is decided here, by the data, and nowhere else. Contracts
    // keep the number as it was typed, so candidates are narrowed in the
    // repository and then compared as properly normalised values.
    const national = phone.slice(-10);
    const candidates = await deps.contractRepo.findCandidatesByPhoneDigits(national);
    const matches = candidates.filter((c) => normalizePhone(c.phone) === phone);
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
  }

  const account = await deps.customerAccountRepo.create({
    companyId,
    contractId,
    linkedProjectIds: projectIds,
    phone,
    name,
    email,
    passwordHash: await hashPassword(password),
    status: PENDING,
    claimedSite,
    matchResult,
  });

  if (invite) {
    await deps.portalInviteRepo.updateFields(invite.id, {
      usedByAccountId: account.id,
      usedAt: new Date(),
    });
  }

  /*
   * Tell somebody (owner decision, 31 Oct 2026). Until now a registration
   * sat in the Customer Logins screen and waited to be noticed, which for a
   * client reads as being ignored. An unmatched one is called out, because
   * that is the one a member of staff has to think about.
   */
  if (companyId && deps.notificationRepo) {
    const where = matchResult === 'invited' ? 'from the link we sent them'
      : matchResult === 'matched' ? 'matched to their service record'
        : 'NOT matched to a client — check who they are';
    await deps.notificationRepo.create({
      companyId,
      text: `Portal registration: ${name} (${phone}) is waiting to be activated — ${where}.`,
      date: todayDate(),
      targetRoles: ['admin', 'service_mgr'],
      readByUserIds: [],
    }).catch(() => { /* a registration must not fail because a notice did */ });
  }

  return { ...GENERIC_REGISTER_REPLY };
}

/** UTC midnight, as every other service in this application dates things. */
function todayDate() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
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

/**
 * Registrations staff can act on.
 *
 * Owner decision (31 Oct 2026): this used to list the company's own
 * registrations only. A client who registered from a number on no contract
 * was stored with NO company — so they appeared on nobody's screen and
 * waited for an approval that could never come. Those now come back too,
 * marked, for any reviewer to claim. There is no tenant to scope them by
 * yet; that is the point of them.
 */
async function listCustomerAccounts(companyId, filters, actorAuth, deps) {
  assertCanReview(actorAuth);
  const rows = await deps.customerAccountRepo.listByCompany(companyId, filters || {});
  if (typeof deps.customerAccountRepo.listUnassigned === 'function') {
    const orphans = await deps.customerAccountRepo.listUnassigned();
    for (const o of orphans) {
      if (o.status === PENDING) rows.push(o);
    }
  }
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
/**
 * The account a reviewer may act on.
 *
 * Normally their own company's. But a registration whose number matched no
 * contract belongs to NOBODY yet — that is the whole point of it — so a
 * company-scoped lookup never finds it and it could be seen but neither
 * approved nor rejected (owner report, 31 Oct 2026). Any reviewer may claim
 * an unassigned one; approving it attaches it to their company.
 *
 * An account that belongs to ANOTHER company is still not found here, which
 * is the line that matters.
 */
async function findReviewableAccount(companyId, accountId, deps) {
  const own = await deps.customerAccountRepo.findByIdForCompany(companyId, accountId);
  if (own) return own;
  const unassigned = await deps.customerAccountRepo.findById(accountId);
  if (unassigned && !unassigned.companyId) return unassigned;
  return null;
}

async function approveCustomerAccount(companyId, accountId, input, actorAuth, deps) {
  assertCanReview(actorAuth);
  const account = await findReviewableAccount(companyId, accountId, deps);
  if (!account) throw portalError('Customer account not found.', 'NOT_FOUND', 404);

  const wantedContractId = (input && input.contractId) || account.contractId;
  if (!wantedContractId) {
    throw portalError('Choose which AMC / Warranty client this account belongs to.', 'CONTRACT_REQUIRED');
  }
  const contract = await deps.contractRepo.findById(companyId, wantedContractId);
  if (!contract) throw portalError('That AMC / Warranty client was not found.', 'NOT_FOUND', 404);

  /*
   * Owner decision (31 Oct 2026): say which projects they may follow in the
   * same step as approving them. It was two screens, so an approved client
   * routinely ended up seeing nothing. Ids are checked against THIS company,
   * and anything else is dropped rather than argued with.
   */
  const patch = {
    companyId,
    contractId: contract.id,
    status: ACTIVE,
    approvedByUserId: actorAuth.userId,
    approvedAt: new Date(),
    decisionNote: String((input && input.note) || '').slice(0, 300),
  };
  if (Array.isArray(input && input.projectIds)) {
    const unique = [...new Set(input.projectIds.map(String))];
    const found = await deps.projectRepo.listByIdsForCompany(companyId, unique);
    patch.linkedProjectIds = found.map((p) => String(p.id || p._id));
  }

  const updated = await deps.customerAccountRepo.updateFields(accountId, patch);
  return publicAccount(updated, contract);
}

/** Refuse a registration, or switch off an account that was active. */
async function setCustomerAccountStatus(companyId, accountId, status, input, actorAuth, deps) {
  assertCanReview(actorAuth);
  if (!['Rejected', 'Disabled', 'Pending'].includes(status)) {
    throw portalError('Unknown account status.', 'INVALID_STATUS');
  }
  const account = await findReviewableAccount(companyId, accountId, deps);
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


/* ------------------------------------------------------------------ *
 * A client's own link to the portal (owner decision, 31 Oct 2026)
 *
 * Minted from the client's AMC record or from their project, kept on that
 * record so it can be sent again months later, and never expiring — the
 * owner asked for all three. What keeps that safe is that the link only says
 * WHO is registering. It cannot activate anybody: a registration through it
 * still arrives Pending for a member of staff to approve.
 * ------------------------------------------------------------------ */

function publicInvite(i, origin = '') {
  if (!i) return null;
  const path = `/portal/register?invite=${i.token}`;
  return {
    id: String(i.id || i._id),
    url: origin ? `${String(origin).replace(/\/+$/, '')}${path}` : path,
    path,
    customerName: i.customerName || '',
    site: i.site || '',
    contractId: i.contractId ? String(i.contractId) : null,
    projectIds: (i.projectIds || []).map(String),
    used: Boolean(i.usedByAccountId),
    usedAt: i.usedAt || null,
    revokedAt: i.revokedAt || null,
    createdAt: i.createdAt || null,
  };
}

/**
 * Mint a link for one client. `contractId` and/or `projectIds` say what they
 * are being invited to; at least one is required, because a link that grants
 * nothing is a link that wastes everyone's time.
 */
async function createPortalInvite(companyId, input, actorAuth, deps) {
  assertCanReview(actorAuth);
  const contractId = (input && input.contractId) || null;
  const wantedProjects = Array.isArray(input && input.projectIds) ? input.projectIds : [];

  let contract = null;
  if (contractId) {
    contract = await deps.contractRepo.findById(companyId, contractId);
    if (!contract) throw portalError('That AMC / Warranty client was not found.', 'NOT_FOUND', 404);
  }

  const found = wantedProjects.length
    ? await deps.projectRepo.listByIdsForCompany(companyId, [...new Set(wantedProjects.map(String))])
    : [];
  const projectIds = found.map((p) => String(p.id || p._id));

  if (!contract && projectIds.length === 0) {
    throw portalError('Choose the AMC client or the project this link is for.', 'VALIDATION_ERROR');
  }

  const created = await deps.portalInviteRepo.create({
    companyId,
    token: crypto.randomBytes(24).toString('hex'),
    contractId: contract ? contract.id : null,
    projectIds,
    customerName: contract ? (contract.customer || '') : (found[0] && found[0].customer) || '',
    site: contract ? (contract.site || '') : (found[0] && found[0].name) || '',
    createdByUserId: actorAuth.userId || null,
  });
  return publicInvite(created, input && input.origin);
}

async function listPortalInvites(companyId, { contractId, projectId, origin } = {}, actorAuth, deps) {
  assertCanReview(actorAuth);
  const rows = contractId
    ? await deps.portalInviteRepo.listForContract(companyId, contractId)
    : projectId
      ? await deps.portalInviteRepo.listForProject(companyId, projectId)
      : [];
  return rows.map((i) => publicInvite(i, origin));
}

/** Switch a link off. The client's account, if they used it, is untouched. */
async function revokePortalInvite(companyId, inviteId, actorAuth, deps) {
  assertCanReview(actorAuth);
  const found = await deps.portalInviteRepo.findByIdForCompany(companyId, inviteId);
  if (!found) throw portalError('Link not found.', 'NOT_FOUND', 404);
  const updated = await deps.portalInviteRepo.updateFields(found.id, { revokedAt: new Date() });
  return publicInvite(updated);
}

/**
 * What the register page shows someone who opened a link: the name it was
 * made out to, and nothing else. No contract, no projects, no phone number —
 * the holder has not proved they are anybody yet.
 *
 * A spent, revoked or unknown token is simply "not usable": the page then
 * behaves exactly as it does without a link at all.
 */
async function describePortalInvite(token, deps) {
  const found = deps.portalInviteRepo ? await deps.portalInviteRepo.findByToken(token) : null;
  if (!found || found.revokedAt || found.usedByAccountId) return { usable: false };
  return { usable: true, customerName: found.customerName || '', site: found.site || '' };
}

module.exports = {
  normalizePhone,
  createPortalInvite,
  listPortalInvites,
  revokePortalInvite,
  describePortalInvite,
  publicInvite,
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
