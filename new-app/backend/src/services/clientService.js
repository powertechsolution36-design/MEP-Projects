'use strict';

const { ServiceError } = require('../errors');
const { buildContacts } = require('./shared/contacts');

/**
 * The client directory (owner request, 16 Nov 2026 — see models/Client.js).
 *
 * Three jobs:
 *   · keep the list, so a client is typed once and picked thereafter;
 *   · record a client the app meets while doing real work, so the list
 *     builds itself rather than waiting to be filled in;
 *   · bring the AMC / PM clients in, so the list starts with the ones we
 *     already have instead of empty.
 */

// Owner decision (16 Nov 2026): "everyone except engineer or service
// engineer". Those two work at a site; the client directory is office work.
const CLIENT_ROLES = Object.freeze([
  'admin', 'sales', 'finance', 'service_mgr', 'inventory', 'hvac_pm', 'solar_pm', 'mep_pm',
]);
const MAX_FIELD = 200;

function assertCompanyContext(auth) {
  if (!auth || !auth.companyId) {
    throw new ServiceError('A company context is required.', 'FORBIDDEN', 403);
  }
}

function assertMayUseClients(auth, what) {
  assertCompanyContext(auth);
  if (!CLIENT_ROLES.includes(auth.role)) {
    throw new ServiceError(`Role "${auth.role}" is not permitted to ${what}.`, 'FORBIDDEN', 403);
  }
}

/** Lowercased and space-collapsed, so "ABC  Pvt Ltd" and "abc pvt ltd" meet. */
function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Digits only, so 98200-11223 and +91 98200 11223 are the same number. */
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const trim = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_FIELD) : '');

/** The fields a caller may set, tidied. `contacts` is handled separately. */
function buildFields(input, existing = {}) {
  const out = {};
  for (const key of ['companyName', 'clientName', 'gst', 'address', 'email', 'phone', 'designation']) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = trim(input[key]);
  }
  if (input && Object.prototype.hasOwnProperty.call(input, 'notes')) {
    out.notes = typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '';
  }
  if (input && Object.prototype.hasOwnProperty.call(input, 'active')) out.active = input.active !== false;

  const contacts = buildContacts(input && input.contacts);
  if (contacts !== undefined) out.contacts = contacts;

  const companyName = out.companyName !== undefined ? out.companyName : existing.companyName;
  const clientName = out.clientName !== undefined ? out.clientName : existing.clientName;
  out.normalizedName = normalizeName(companyName || clientName);
  return out;
}

async function listClients(auth, { search } = {}, deps) {
  assertMayUseClients(auth, 'see the client list');
  const all = await deps.clientRepo.listByCompany(auth.companyId);
  const q = normalizeName(search);
  if (!q) return all;
  const digits = normalizePhone(search);
  return all.filter((c) => {
    const blob = normalizeName([c.companyName, c.clientName, c.gst, c.address, c.email,
      ...(c.contacts || []).map((p) => `${p.name} ${p.designation}`)].join(' '));
    if (blob.includes(q)) return true;
    if (!digits) return false;
    const numbers = [c.phone, ...(c.contacts || []).map((p) => p.phone)].map(normalizePhone);
    return numbers.some((n) => n && n.includes(digits));
  });
}

async function getClient(id, auth, deps) {
  assertMayUseClients(auth, 'open a client');
  const client = await deps.clientRepo.findById(auth.companyId, id);
  if (!client) throw new ServiceError('Client not found.', 'NOT_FOUND', 404);
  return client;
}

async function createClient(input, auth, deps) {
  assertMayUseClients(auth, 'add a client');
  const fields = buildFields(input || {});
  if (!fields.companyName && !fields.clientName) {
    throw new ServiceError('A client needs a company name or a client name.', 'VALIDATION_ERROR', 400);
  }
  return deps.clientRepo.create({
    companyId: auth.companyId,
    source: 'manual',
    active: true,
    contacts: [],
    ...fields,
  });
}

async function updateClient(id, input, auth, deps) {
  assertMayUseClients(auth, 'edit a client');
  const existing = await deps.clientRepo.findById(auth.companyId, id);
  if (!existing) throw new ServiceError('Client not found.', 'NOT_FOUND', 404);
  const fields = buildFields(input || {}, existing);
  if (!fields.normalizedName) {
    throw new ServiceError('A client needs a company name or a client name.', 'VALIDATION_ERROR', 400);
  }
  return deps.clientRepo.update(auth.companyId, id, fields);
}

async function deleteClient(id, auth, deps) {
  // Only an admin throws a client away; everyone else can edit but not erase.
  assertMayUseClients(auth, 'remove a client');
  if (auth.role !== 'admin') {
    throw new ServiceError('Only an admin can remove a client.', 'FORBIDDEN', 403);
  }
  const existing = await deps.clientRepo.findById(auth.companyId, id);
  if (!existing) throw new ServiceError('Client not found.', 'NOT_FOUND', 404);
  await deps.clientRepo.deleteById(auth.companyId, id);
  return { deletedClientId: String(id) };
}

/**
 * Record a client the app has just met, if it does not know them already.
 *
 * Owner decision (16 Nov 2026): a name typed on a new enquiry or quotation
 * joins the list by itself, so the dropdown fills from real work instead of
 * waiting for somebody to curate it.
 *
 * Deliberately forgiving: this is a side effect of someone else's save, so
 * it never throws and never blocks. A client already on file is left exactly
 * as it is -- the enquiry does not get to overwrite details somebody
 * maintained on the client's own screen.
 */
async function rememberClient(input, auth, deps) {
  try {
    if (!deps || !deps.clientRepo || !auth || !auth.companyId) return null;
    const name = trim(input && (input.companyName || input.clientName));
    if (!name) return null;
    const normalizedName = normalizeName(input.companyName || input.clientName);
    const known = await deps.clientRepo.findByNormalizedName(auth.companyId, normalizedName);
    if (known) return known;
    return await deps.clientRepo.create({
      companyId: auth.companyId,
      companyName: trim(input.companyName),
      clientName: trim(input.clientName),
      normalizedName,
      gst: trim(input.gst),
      address: trim(input.address),
      email: trim(input.email),
      phone: trim(input.phone),
      designation: '',
      contacts: buildContacts(input.contacts) || [],
      notes: '',
      source: input.source || 'manual',
      active: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[clientService.rememberClient]', err && err.message);
    return null;
  }
}

/**
 * Bring the AMC / PM clients into the list (owner decision, 16 Nov 2026:
 * "seed it from the AMC list once").
 *
 * Run as often as you like: a client already on the list is left alone, so
 * this also picks up AMC clients registered since the last run. Nothing on
 * the contracts is changed — they are read, not moved.
 */
async function importFromContracts(auth, deps) {
  assertMayUseClients(auth, 'import the AMC clients');
  const contracts = await deps.contractRepo.listByCompany(auth.companyId);
  let added = 0;
  let alreadyKnown = 0;
  for (const c of contracts) {
    const name = trim(c.customer);
    if (!name) continue;
    /* eslint-disable no-await-in-loop */
    const normalizedName = normalizeName(name);
    const known = await deps.clientRepo.findByNormalizedName(auth.companyId, normalizedName);
    if (known) { alreadyKnown += 1; continue; }
    await deps.clientRepo.create({
      companyId: auth.companyId,
      companyName: name,
      clientName: '',
      normalizedName,
      gst: '',
      address: trim(c.site),
      email: '',
      phone: trim(c.phone),
      designation: '',
      contacts: buildContacts(c.contacts) || [],
      notes: '',
      source: 'amc',
      active: true,
    });
    added += 1;
    /* eslint-enable no-await-in-loop */
  }
  return { added, alreadyKnown, seen: contracts.length };
}

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  rememberClient,
  importFromContracts,
  CLIENT_ROLES,
  normalizeName,
  normalizePhone,
};
