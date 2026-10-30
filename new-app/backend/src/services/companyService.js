'use strict';

const { assertRoleAllowedForCompany } = require('../auth/roleDivision');

/**
 * Company creation — isolated into its own service (per instruction) so
 * Super Admin company-management behavior can be expanded later without
 * touching this foundation.
 *
 * Reproduces the PWA's *outcome* (creating a company also creates exactly
 * one admin-role login for it) without reproducing its insecure mechanism
 * (the PWA shows the newly created plaintext password once). Here the
 * password is hashed before persistence and the plaintext is never returned,
 * stored, or logged — only the hash and a safe admin profile come back.
 *
 * All persistence is via injected repositories — see
 * src/auth/repositories.mongoose.js for the real, Mongoose-backed wiring
 * used by the HTTP routes; tests inject in-memory fakes.
 */

/**
 * @param {{
 *   company: { name: string, divisions: string[], status?: string, since?: Date, [k: string]: any },
 *   admin: { name: string, username: string, password: string },
 * }} input
 * @param {{
 *   companyRepo: { create: (data: object) => Promise<object> },
 *   userWriteRepo: {
 *     existsByCompanyAndUsername: (companyId: string, username: string) => Promise<boolean>,
 *     create: (data: object) => Promise<object>,
 *   },
 *   passwordHasher: { hashPassword: (plain: string) => Promise<string> },
 * }} deps
 * @returns {Promise<{ company: object, admin: object }>} admin never includes the plaintext password or its hash.
 */
const { DIVISIONS } = require('../models/shared/enums');

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.code = 'ALREADY_EXISTS';
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  return err;
}

function addDaysUTC(date, days) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Company fields exactly as the PWA's company form saves them
 * (`saveCompany`, MEP_PROJECTS_PWA/index.html:1720-1741), mapped to the
 * model's field names. Accepts the PWA/legacy aliases the existing frontend
 * sends (gst -> gstNumber, contactPersons/contacts {n,ph} -> {name,phone}).
 * Unknown fields (protected, since, trialEnd, ...) are never taken from the
 * request.
 *
 * PWA validations: name required; at least one division; Active requires a
 * subscription rate and start date. Rate/start/end only apply to Active
 * (PWA: `subRate: st==="Active" ? ... : 0`, `subStart/subEnd: ... : ""`).
 */
function normalizeCompanyInput(input, existing) {
  const src = input || {};
  const out = {};
  const pick = (key, ...aliases) => {
    for (const k of [key, ...aliases]) if (src[k] !== undefined) return src[k];
    return undefined;
  };
  const str = (v) => (v == null ? '' : String(v));

  const name = pick('name');
  if (name !== undefined) out.name = str(name).trim();
  if (!existing || name !== undefined) {
    if (!out.name) throw badRequest('Name required');
  }
  for (const [key, ...aliases] of [['city'], ['address', 'addr'], ['gstNumber', 'gst'], ['phone'], ['email'], ['tagline']]) {
    const v = pick(key, ...aliases);
    if (v !== undefined) out[key] = str(v);
  }

  const divisions = pick('divisions', 'divs');
  if (divisions !== undefined) {
    if (!Array.isArray(divisions)) throw badRequest('Select at least one division');
    const clean = DIVISIONS.filter((d) => divisions.includes(d));
    if (!clean.length) throw badRequest('Select at least one division');
    out.divisions = clean;
  } else if (!existing) {
    throw badRequest('Select at least one division');
  }

  const contacts = pick('contacts', 'contactPersons');
  if (contacts !== undefined) {
    if (!Array.isArray(contacts)) throw badRequest('contacts must be a list');
    out.contacts = contacts.slice(0, 2).map((c) => ({
      name: str((c && (c.name !== undefined ? c.name : c.n)) || ''),
      phone: str((c && (c.phone !== undefined ? c.phone : c.ph)) || ''),
    }));
  }

  const status = pick('status');
  if (status !== undefined && !['Trial', 'Active', 'Suspended'].includes(status)) {
    throw badRequest('Status must be Active, Suspended, or Trial.');
  }
  const finalStatus = status !== undefined ? status : (existing ? existing.status : 'Trial');
  if (status !== undefined) out.status = status;

  const rate = pick('subscriptionRate', 'subRate');
  const cycle = pick('subscriptionCycle', 'subCycle');
  const start = pick('subscriptionStart', 'subStart');
  const end = pick('subscriptionEnd', 'subEnd');
  if (cycle !== undefined) {
    if (!['Monthly', 'Yearly'].includes(cycle)) throw badRequest('Billing cycle must be Monthly or Yearly.');
    out.subscriptionCycle = cycle;
  }
  if (finalStatus === 'Active') {
    const effRate = rate !== undefined ? Number(rate) || 0 : existing && existing.subscriptionRate;
    const effStart = start !== undefined ? start : existing && existing.subscriptionStart;
    if (!effRate || !effStart) throw badRequest('Set subscription rate and start date for Active status');
    out.subscriptionRate = Number(effRate);
    out.subscriptionStart = new Date(effStart);
    if (!out.subscriptionCycle && !(existing && existing.subscriptionCycle)) out.subscriptionCycle = 'Monthly';
    if (end !== undefined) out.subscriptionEnd = end ? new Date(end) : null;
  } else if (status !== undefined || rate !== undefined || start !== undefined || end !== undefined) {
    out.subscriptionRate = 0;
    out.subscriptionStart = null;
    out.subscriptionEnd = null;
  }
  return out;
}

async function createCompanyWithAdmin({ company: companyInput, admin: adminInput }, deps) {
  const { companyRepo, userWriteRepo, passwordHasher } = deps;

  if (!companyInput || !companyInput.name) {
    throw badRequest('Company name is required.');
  }
  if (!adminInput || !adminInput.username || !adminInput.password) {
    throw badRequest('Set admin Login ID and password');
  }
  const companyFields = normalizeCompanyInput(companyInput, null);

  // PWA FACT (saveCompany, index.html:1722): the admin Login ID must not be
  // in use anywhere on the platform -- checked BEFORE the company is
  // created, so a rejected request never leaves an orphan company behind.
  if (typeof userWriteRepo.existsByUsername === 'function' && (await userWriteRepo.existsByUsername(adminInput.username))) {
    throw conflict('Login ID already in use — choose another');
  }

  // PWA FACT (saveCompany): `since: today()` — the joining DAY, not a clock
  // time, so the 15-day trial below is a whole number of days at any hour.
  const since = addDaysUTC(new Date(), 0);
  const companyData = {
    ...companyFields,
    status: companyFields.status || 'Trial',
    since,
  };
  // PWA FACT: Trial period is 15 days from the joining date.
  companyData.trialEnd = companyData.status === 'Trial' ? addDaysUTC(since, 15) : null;

  const company = await companyRepo.create(companyData);

  // 'admin' is never a PM role, so this call is a documented no-op today —
  // kept so every role assignment in this service path goes through the
  // same division-binding gate, including future PM-role bootstrap paths.
  assertRoleAllowedForCompany('admin', company);

  const alreadyTaken = await userWriteRepo.existsByCompanyAndUsername(company.id, adminInput.username);
  if (alreadyTaken) {
    throw new Error(`Username "${adminInput.username}" is already taken in this company.`);
  }

  const passwordHash = await passwordHasher.hashPassword(adminInput.password);

  // PWA FACT: the admin's display name is Contact 1's name, else "Admin".
  const firstContact = (companyFields.contacts && companyFields.contacts[0] && companyFields.contacts[0].name) || '';
  const adminUser = await userWriteRepo.create({
    companyId: company.id,
    name: adminInput.name || firstContact || 'Admin',
    username: adminInput.username,
    role: 'admin',
    passwordHash,
    active: true,
  });

  return {
    company,
    admin: {
      id: adminUser.id,
      name: adminUser.name,
      username: adminUser.username,
      role: adminUser.role,
      companyId: adminUser.companyId,
      active: adminUser.active !== false,
    },
  };
}

/**
 * Super Admin edit of a company (PWA `saveCompany(id)` edit branch,
 * index.html:1731-1736): the same fields as create, a switch INTO Trial
 * restarts a 15-day trial, and the company admin's Login ID / password can
 * be changed from the same form.
 */
async function updateCompany(companyId, body, deps) {
  const existing = await deps.companyRepo.findById(companyId);
  if (!existing) {
    const err = new Error('Company not found.');
    err.status = 404;
    throw err;
  }
  const src = body || {};
  const patch = normalizeCompanyInput(src, existing);
  if (patch.status === 'Trial' && existing.status !== 'Trial') {
    patch.trialEnd = addDaysUTC(new Date(), 15);
  }

  const adminInput = src.admin || {};
  if (adminInput.username || adminInput.password) {
    const users = deps.userWriteRepo.listByCompany ? await deps.userWriteRepo.listByCompany(companyId) : [];
    const admin = users.find((u) => u.role === 'admin');
    if (admin) {
      const userPatch = {};
      if (adminInput.username && adminInput.username !== admin.username) {
        if (typeof deps.userWriteRepo.existsByUsername === 'function'
          && (await deps.userWriteRepo.existsByUsername(adminInput.username, admin.id))) {
          throw conflict('Login ID already in use — choose another');
        }
        userPatch.username = adminInput.username;
      }
      if (adminInput.password) userPatch.passwordHash = await deps.passwordHasher.hashPassword(adminInput.password);
      if (Object.keys(userPatch).length) {
        await deps.userWriteRepo.updateByIdAndCompany(companyId, admin.id, userPatch);
        if (userPatch.passwordHash && deps.sessionRepo && deps.sessionRepo.revokeAllForUser) {
          await deps.sessionRepo.revokeAllForUser(admin.id);
        }
      }
    }
  }

  const updated = Object.keys(patch).length ? await deps.companyRepo.updateFields(companyId, patch) : existing;
  // Keep a Super-Admin-assigned subscription consistent with the company's
  // division list when divisions are edited here.
  if (patch.divisions && deps.subscriptionRepo) {
    const sub = await deps.subscriptionRepo.findByCompany(companyId);
    if (sub && sub.status !== 'cancelled' && sub.status !== 'expired') {
      const allowed = (sub.planSnapshot && sub.planSnapshot.availableDivisions) || patch.divisions;
      const nextDivs = patch.divisions.filter((d) => allowed.includes(d));
      if (nextDivs.length) await deps.subscriptionRepo.update(sub.id, { purchasedDivisions: nextDivs });
    }
  }
  return updated;
}

/**
 * Super Admin "Client Business" figures per company — PWA `coStats(id)`
 * (MEP_PROJECTS_PWA/index.html:1424-1445), used by superDash, vUsage,
 * vCompanies and dlUsage. Read-only, super only (enforced by the route).
 */
async function getPlatformUsage(deps) {
  const companies = await deps.companyRepo.listAll();
  const rows = [];
  for (const c of companies) {
    const id = c.id;
    // eslint-disable-next-line no-await-in-loop
    const [enq, sos, prj, svc, amc, pay, users] = await Promise.all([
      deps.enquiryRepo.listByCompany(id),
      deps.salesOrderRepo.listByCompany(id),
      deps.projectRepo.listByCompany(id),
      deps.serviceCallRepo.listByCompany(id),
      deps.contractRepo.listByCompany(id),
      deps.paymentRepo.listByCompany(id),
      deps.userWriteRepo.listByCompany ? deps.userWriteRepo.listByCompany(id) : [],
    ]);
    const paidSum = (b) => (b.partPayments || []).reduce((x, d) => x + (Number(d.amount) || 0), 0);
    const coll = pay.reduce((a, b) => a + (paidSum(b) || (b.status === 'Received' ? b.amount || 0 : 0)), 0);
    const billed = pay.reduce((a, b) => a + (b.amount || 0), 0);
    rows.push({
      companyId: id,
      enq: enq.length,
      enqOpen: enq.filter((x) => x.status === 'Open').length,
      enqVal: enq.reduce((a, b) => a + (b.estimatedValue || 0), 0),
      sos: sos.length,
      sales: sos.reduce((a, b) => a + (b.totalCost || 0), 0),
      prj: prj.length,
      ongoing: prj.filter((x) => x.status === 'Ongoing').length,
      done: prj.filter((x) => x.status !== 'Ongoing').length,
      hvac: prj.filter((x) => x.division === 'HVAC').length,
      solar: prj.filter((x) => x.division === 'Solar').length,
      mep: prj.filter((x) => x.division === 'MEP').length,
      svc: svc.length,
      svcOpen: svc.filter((x) => x.status !== 'Completed').length,
      amc: amc.length,
      users: users.length,
      billed,
      coll,
      out: billed - coll,
    });
  }
  return rows;
}

module.exports = { createCompanyWithAdmin, updateCompany, normalizeCompanyInput, getPlatformUsage };

/**
 * FIX-6-03 (B2 -- Company deletion/cascade).
 *
 * PWA FACT (`delCompany`, MEP_PROJECTS_PWA/index.html:1811-1817):
 *   - Only reachable by the `super` role -- "Companies" is a nav item that
 *     exists ONLY in the `super` role's menu (index.html:1290); no other
 *     role can even open the Companies list this action lives on.
 *   - Confirmation: a browser `confirm("Remove company and all its data?")`
 *     gate before anything happens (a UI-layer concern -- the server-side
 *     equivalent is simply requiring an explicit call to this endpoint;
 *     there is no server-side "confirm" primitive to reproduce).
 *   - Hard delete: the Company record itself is removed immediately, no
 *     soft-delete/status flag.
 *   - Cascade: exactly 8 collections are purged by company id --
 *     `["users","enquiries","sos","projects","svcCalls","contracts",
 *     "payments","notifs"]` (that literal array, read directly from the
 *     PWA source).
 *   - NOT cascaded (verified by the SAME literal array above -- these
 *     collection names are simply absent from it): Inventory data
 *     (categories/locations/items/issues/transactions) and Checklist
 *     Templates. This is preserved exactly, not "fixed" -- inventing a
 *     wider cascade than the PWA demonstrates would violate the absolute
 *     parity rule, even though leaving Inventory/ChecklistTemplate records
 *     orphaned looks like an oversight in the PWA itself.
 *   - The PWA also guards `id===1` ("Cannot remove the primary company in
 *     demo") -- that guard is specific to the PWA's own hardcoded demo
 *     company id 1 in its localStorage-only demo mode and has no equivalent
 *     concept in a real multi-tenant Mongo deployment (there is no
 *     "always-id-1" company); this is OPEN/NOT DETERMINABLE as a concept to
 *     port 1:1 and is intentionally NOT reproduced as an arbitrary
 *     "first company" special case, which would be an invented rule the PWA
 *     itself does not generalize (a demo-mode literal, not a business rule).
 *
 * Approved infrastructure-only differences: (1) the whole cascade runs
 * inside `withTransaction` so a failure partway through cannot leave the
 * Company gone but its data behind (or vice versa) -- the PWA's synchronous
 * in-memory array filters have no equivalent atomicity concern because
 * there is no concurrent writer and no partial-failure mode to guard
 * against; (2) tenant scoping is by the server-derived `companyId`
 * (ObjectId), never a client-supplied value.
 */
async function deleteCompany(companyId, actorAuth, deps) {
  const { ServiceError } = require('../errors');
  if (!actorAuth || actorAuth.role !== 'super') {
    throw new ServiceError('Only the super role may delete a company.', 'FORBIDDEN', 403);
  }
  const { companyRepo, userWriteRepo, enquiryRepo, salesOrderRepo, projectRepo, serviceCallRepo, contractRepo, paymentRepo, notificationRepo, withTransaction } = deps;
  const company = await companyRepo.findById(companyId);
  if (!company) {
    throw new ServiceError('Company not found.', 'NOT_FOUND', 404);
  }

  return withTransaction(deps, async (txnDeps) => {
    const { session } = txnDeps;
    // PWA FACT: exactly these 8 collections, in the PWA's own order.
    await userWriteRepo.deleteManyByCompany(companyId, session);
    await enquiryRepo.deleteManyByCompany(companyId, session);
    await salesOrderRepo.deleteManyByCompany(companyId, session);
    await projectRepo.deleteManyByCompany(companyId, session);
    await serviceCallRepo.deleteManyByCompany(companyId, session);
    await contractRepo.deleteManyByCompany(companyId, session);
    await paymentRepo.deleteManyByCompany(companyId, session);
    await notificationRepo.deleteManyByCompany(companyId, session);
    if (txnDeps.dailyTaskRepo && typeof txnDeps.dailyTaskRepo.deleteManyByCompany === 'function') {
      await txnDeps.dailyTaskRepo.deleteManyByCompany(companyId, session);
    }
    // Owner decision (30 Oct 2026): photographs of a project's work live in
    // their own collection, so deleting the projects does not take them.
    // Guarded like dailyTaskRepo above, so a caller wired without this
    // repository still deletes everything it does know about.
    if (txnDeps.projectPhotoRepo && typeof txnDeps.projectPhotoRepo.deleteManyByCompany === 'function') {
      await txnDeps.projectPhotoRepo.deleteManyByCompany(companyId, session);
    }
    // NEW-APP-only record (no PWA counterpart): the company's subscription
    // must not outlive the company.
    if (txnDeps.subscriptionRepo && typeof txnDeps.subscriptionRepo.deleteByCompany === 'function') {
      await txnDeps.subscriptionRepo.deleteByCompany(companyId, session);
    }
    await companyRepo.delete(companyId, session);
    return { deletedCompanyId: companyId };
  });
}

module.exports.deleteCompany = deleteCompany;


/**
 * Company Profile (Stage 7) — the company admin edits their OWN company's
 * document-branding fields (used by quotation and AMC document generation).
 *
 * Only the profile fields listed below are writable here; tenant-control
 * fields (name, divisions, status, subscription*, since, protected) stay
 * Super-Admin-only via PATCH /api/companies/:id and the subscription API.
 * bankDetails / authorizedPerson are written per sub-field so a partial
 * payload never wipes the sub-fields it omits.
 */
const PROFILE_STRING_FIELDS = Object.freeze([
  'displayName', 'subtitle', 'tagline', 'phone', 'email', 'website',
  'gstNumber', 'logoBase64', 'quotationPrefix',
  // Owner request (22 Oct 2026): the company WhatsApp number every client
  // message is sent from (service reports, AMC letters, quotations).
  'whatsappNumber',
]);
const PROFILE_BANK_FIELDS = Object.freeze(['bankName', 'accountNumber', 'ifscCode', 'branch', 'accountType']);
const PROFILE_AUTH_PERSON_FIELDS = Object.freeze([
  'name', 'designation', 'signatureBase64', 'stampBase64', 'contactPhone', 'contactEmail',
]);

function profileError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'INVALID_PROFILE';
  return err;
}

async function updateMyCompanyProfile(companyId, body, deps) {
  if (!companyId) {
    const err = new Error('This account has no company profile.');
    err.status = 400;
    throw err;
  }
  const existing = await deps.companyRepo.findById(companyId);
  if (!existing) {
    const err = new Error('Company not found.');
    err.status = 404;
    throw err;
  }

  const patch = {};
  for (const f of PROFILE_STRING_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] !== null && typeof body[f] !== 'string') throw profileError(`${f} must be text.`);
    patch[f] = body[f] == null ? '' : body[f];
  }
  if (patch.whatsappNumber !== undefined) {
    const digits = patch.whatsappNumber.replace(/[\s()+-]/g, '');
    if (digits && !/^\d{10,13}$/.test(digits)) {
      throw profileError('WhatsApp number must be 10 to 13 digits, e.g. 7447333377 or 917447333377.');
    }
    patch.whatsappNumber = digits;
  }
  if (patch.quotationPrefix !== undefined) {
    patch.quotationPrefix = patch.quotationPrefix.trim();
    if (!patch.quotationPrefix) throw profileError('Quotation prefix cannot be empty.');
  }
  for (const [group, fields] of [['bankDetails', PROFILE_BANK_FIELDS], ['authorizedPerson', PROFILE_AUTH_PERSON_FIELDS]]) {
    const value = body[group];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) throw profileError(`${group} must be an object.`);
    for (const f of fields) {
      if (value[f] === undefined) continue;
      if (value[f] !== null && typeof value[f] !== 'string') throw profileError(`${group}.${f} must be text.`);
      patch[`${group}.${f}`] = value[f] == null ? '' : value[f];
    }
  }

  if (Object.keys(patch).length === 0) return existing;
  return deps.companyRepo.updateFields(companyId, patch);
}

module.exports.updateMyCompanyProfile = updateMyCompanyProfile;
module.exports.PROFILE_STRING_FIELDS = PROFILE_STRING_FIELDS;
