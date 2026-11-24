'use strict';

const { ServiceError } = require('../errors');
const { ROLE_DIVISION_MAP } = require('../auth/roleDivision');
const { DIVISIONS } = require('../models/shared/enums');
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
// Mirrors the gate on quotationRoutes, which the quotation service itself
// does not carry.
const QUOTATION_VIEW_ROLES = Object.freeze(['admin', 'sales', 'finance']);

/**
 * Which divisions a client is ours for, and who may see them.
 *
 * Owner request (24 Nov 2026): "now Solar is able to see all the clients —
 * these are all AC clients. Add division, so Solar will see only solar
 * clients and HVAC will see theirs; or if a client has both HVAC and
 * solar, or all three, can select multiple division."
 *
 * A client with NO divisions is visible to everyone. That is deliberate
 * and it matters: every client on file today is untagged, and hiding all
 * of them from the Solar Manager the moment this ships would repeat the
 * 19 Nov project-assignment mistake, which emptied every Manager's list
 * overnight. The directory narrows as it is tagged, not before.
 */
function readDivisions(value) {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const raw of list) {
    const d = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!d) continue;
    if (!DIVISIONS.includes(d)) {
      throw new ServiceError(`Division must be one of: ${DIVISIONS.join(', ')}.`, 'VALIDATION_ERROR', 400);
    }
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** The division this login is confined to, or null when it sees them all. */
function divisionScope(auth) {
  return ROLE_DIVISION_MAP[auth && auth.role] || null;
}

/** Is this client one that login may see? Untagged is everybody's. */
function visibleToDivision(client, auth) {
  const mine = divisionScope(auth);
  if (!mine) return true;
  const tagged = (client && client.divisions) || [];
  return tagged.length === 0 || tagged.includes(mine);
}

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

/** At most this many old names or numbers are kept for matching. */
const MAX_FORMER = 10;

/**
 * Add what the client used to be called to what we already remember,
 * normalized, without duplicates, newest last and oldest dropped first.
 */
function remember(kept, values, normalize) {
  const out = [...(kept || [])];
  for (const value of values) {
    const key = normalize(value);
    if (!key) continue;
    if (normalize === normalizePhone && key.length < 10) continue;
    if (out.includes(key)) continue;
    out.push(key);
  }
  return out.slice(-MAX_FORMER);
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

  // Which sides of the business they are ours for (24 Nov 2026).
  const divisions = readDivisions(input && input.divisions);
  if (divisions !== undefined) out.divisions = divisions;

  /*
   * The client's other addresses (owner request, 23 Nov 2026, with his own
   * correction: "Nana Peth is Address not Site, it is a place in Pune").
   * Left out of the request, the list is left as it is. Sent, it replaces
   * the list: a row with no address is dropped, the same place twice is
   * kept once, and nothing else about the client is touched. The AMC
   * records stay one per address — this is the directory saying where the
   * firm is, not a contract.
   */
  if (input && Object.prototype.hasOwnProperty.call(input, 'otherAddresses')) {
    const rows = Array.isArray(input.otherAddresses) ? input.otherAddresses : [];
    const seen = new Set();
    const places = [];
    for (const row of rows) {
      const address = trim(typeof row === 'string' ? row : (row && row.address));
      if (!address) continue;
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ address, label: trim(row && row.label) });
    }
    if (places.length > 25) {
      throw new ServiceError('A client has at most 25 addresses.', 'VALIDATION_ERROR', 400);
    }
    out.otherAddresses = places;
  }

  const companyName = out.companyName !== undefined ? out.companyName : existing.companyName;
  const clientName = out.clientName !== undefined ? out.clientName : existing.clientName;
  out.normalizedName = normalizeName(companyName || clientName);
  return out;
}

async function listClients(auth, { search } = {}, deps) {
  assertMayUseClients(auth, 'see the client list');
  const everyone = await deps.clientRepo.listByCompany(auth.companyId);
  // A division-confined login sees its own clients and the untagged ones.
  const all = everyone.filter((c) => visibleToDivision(c, auth));
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
  // The same rule as the list: a division-confined login cannot reach
  // another division's client by typing its id. Not found, not forbidden —
  // whose client it is is not the business of somebody who may not see it.
  if (!visibleToDivision(client, auth)) {
    throw new ServiceError('Client not found.', 'NOT_FOUND', 404);
  }
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
  /*
   * Keep what they used to be called (owner request, 18 Nov 2026). A
   * quotation already sent deliberately keeps the old name, so without this
   * it would stop being recognised as theirs the moment they are renamed
   * and would fall off their page. Capped, oldest dropped first: this is a
   * matching aid, not a history of the record.
   */
  const was = { names: existing.formerNames || [], phones: existing.formerPhones || [] };
  fields.formerNames = remember(was.names, [existing.companyName, existing.clientName], normalizeName);
  fields.formerPhones = remember(was.phones, [existing.phone], normalizePhone);

  const updated = await deps.clientRepo.update(auth.companyId, id, fields);

  /*
   * Owner request (18 Nov 2026): a client corrected here is corrected
   * everywhere. Every other record carries the customer's details as
   * somebody typed them, so without this the new spelling lived only on
   * this screen while the register, the AMC list and the quotation went on
   * showing the old one.
   *
   * The match keys are built from the client as it WAS, because that is
   * what those records still say. Which records are reached, which fields
   * are replaced and what is deliberately left alone are all in
   * clientPropagation.js.
   *
   * It never throws: the client HAS been saved by this point, and a
   * follow-on correction that fails must not turn a successful save into
   * an error. A failure is reported in `propagated.failed` instead.
   */
  const propagated = await require('./clientPropagation').propagateClientChange(
    {
      before: existing,
      after: updated,
      keys: clientMatchKeys(existing),
      companyId: auth.companyId,
    },
    deps
  );
  return { ...updated, propagated };
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

/* ================= EVERYTHING WE HAVE ON ONE CLIENT =================
   OWNER REQUEST (17 Nov 2026): "in Admin login in client each client should
   hold all their data — all service call, all project, all quotation."
   Extended by the same conversation to their AMC contracts, sales orders
   and payments.

   None of those records stores a client id: each one carries the customer's
   NAME as somebody typed it, because that is how the company has always
   worked. So a client's history is MATCHED, not looked up — by name,
   ignoring case and spacing, or by the last ten digits of a phone number,
   which catches the records where the name was typed differently.

   Two honest limits, stated here so nobody has to rediscover them: two
   different firms sharing a name will pool together, and a record whose
   name AND number were both entered differently will not be found. Records
   raised from now on carry `clientId` as well (quotationService and the
   sales-order cascade), and that is preferred over any guess.

   PERMISSION IS NOT RE-IMPLEMENTED HERE. Each section is fetched through
   that module's own list function, so the role and division rules that
   govern the Service register or the Projects list govern this page too. A
   section the viewer may not see is reported as null rather than empty, so
   the screen can say "not yours to see" instead of "none". This page is a
   different way into records, never a way around them.
   ================================================================== */

/** The names and numbers that identify this client, normalized once. */
function clientMatchKeys(client) {
  const names = new Set(
    [client.companyName, client.clientName, ...(client.contacts || []).map((c) => c.name)]
      .map(normalizeName).filter(Boolean)
  );
  const phones = new Set(
    [client.phone, ...(client.contacts || []).map((c) => c.phone)]
      .map(normalizePhone).filter((d) => d.length >= 10)
  );
  // What they used to be called still finds them (owner request, 18 Nov
  // 2026). Already normalized when they were stored, so they go straight in
  // — a document that kept the old name is still theirs.
  for (const n of client.formerNames || []) if (n) names.add(n);
  for (const p of client.formerPhones || []) if (p && p.length >= 10) phones.add(p);
  return { id: String(client.id || client._id), names, phones };
}

/**
 * Why this record belongs to this client -- 'client', 'name' or 'phone' --
 * or null when it does not. The reason travels with the row so a wrong
 * pairing can be seen rather than puzzled over.
 */
function matchReason(keys, { clientId, names = [], phones = [] }) {
  if (clientId && String(clientId) === keys.id) return 'client';
  if (names.some((n) => n && keys.names.has(normalizeName(n)))) return 'name';
  if (phones.some((p) => {
    const d = normalizePhone(p);
    return d.length >= 10 && keys.phones.has(d);
  })) return 'phone';
  return null;
}

/** Runs one section, reporting null where the viewer is not allowed it. */
async function section(load) {
  try {
    return await load();
  } catch (err) {
    if (err && (err.status === 403 || err.code === 'FORBIDDEN')) return null;
    throw err;
  }
}

/** Keeps only the rows that are this client's, each tagged with why. */
function own(rows, keys, pick) {
  const out = [];
  for (const r of rows || []) {
    const why = matchReason(keys, pick(r));
    if (why) out.push({ row: r, matchedOn: why });
  }
  return out;
}

const short = (v) => (v === undefined || v === null ? null : v);

/**
 * Everything this company holds on one client, as far as the person asking
 * is allowed to see it. Each section is `null` when it is not theirs to
 * see, and an array -- possibly empty -- when it is.
 */
async function getClientRecords(id, auth, deps) {
  const client = await getClient(id, auth, deps);
  const keys = clientMatchKeys(client);

  const serviceCallService = require('./serviceCallService');
  const projectService = require('./projectService');
  const quotationService = require('./quotationService');
  const contractService = require('./contractService');
  const salesOrderService = require('./salesOrderService');
  const paymentService = require('./paymentService');

  const serviceCalls = await section(async () => own(
    await serviceCallService.listServiceCalls(auth, {}, deps), keys,
    (r) => ({ clientId: r.clientId, names: [r.customer], phones: [r.phone] })
  ));

  const projects = await section(async () => own(
    await projectService.listProjects(auth, {}, deps), keys,
    (r) => ({ clientId: r.clientId, names: [r.customer], phones: [] })
  ));

  // Quotations are gated at their router, not in their service, so the
  // same rule is applied here rather than left off.
  const quotations = await section(async () => {
    if (!QUOTATION_VIEW_ROLES.includes(auth.role)) {
      throw new ServiceError(`Role "${auth.role}" is not permitted to view Quotations.`, 'FORBIDDEN', 403);
    }
    return own(
      await quotationService.listQuotations(auth.companyId, {}, deps), keys,
      (r) => ({ clientId: r.clientId, names: [r.customerName], phones: [r.customerPhone] })
    );
  });

  /*
   * Owner request (21 Nov 2026): "in client segment if we click any client
   * then all enquiries of that client and enquiries wise quote can check."
   *
   * Every lead of theirs — open, won and lost alike — each carrying the
   * quotations raised from it, so the quotations are read lead by lead
   * rather than as one undifferentiated pile. An enquiry stores no client
   * id, so they are matched on the site name and the numbers, like the
   * other sections here.
   */
  const enquiryService = require('./enquiryService');
  const enquiries = await section(async () => {
    const scopes = ['open', 'won', 'lost'];
    const rows = [];
    for (const scope of scopes) {
      rows.push(...await enquiryService.listEnquiries(auth, { scope }, deps));
    }
    return own(rows, keys, (r) => ({
      clientId: null,
      names: [r.name, ...(r.contacts || []).map((c) => c.name)],
      phones: [r.phone, ...(r.contacts || []).map((c) => c.phone)],
    }));
  });

  // The quotations, keyed by the lead they came from, read once.
  const quotesByEnquiry = new Map();
  if (enquiries && deps.quotationRepo && deps.quotationRepo.listByCompany) {
    for (const q of await deps.quotationRepo.listByCompany(auth.companyId)) {
      if (!q.enquiryId) continue;
      const key = String(q.enquiryId);
      if (!quotesByEnquiry.has(key)) quotesByEnquiry.set(key, []);
      quotesByEnquiry.get(key).push({
        id: String(q.id), quotationNumber: short(q.quotationNumber),
        status: short(q.status), date: short(q.date), grandTotal: short(q.grandTotal),
      });
    }
    for (const list of quotesByEnquiry.values()) {
      list.sort((a, b) => String(b.quotationNumber || '').localeCompare(String(a.quotationNumber || '')));
    }
  }

  const contracts = await section(async () => own(
    await contractService.listContracts(auth, {}, deps), keys,
    (r) => ({ clientId: r.clientId, names: [r.customer], phones: [r.phone] })
  ));

  const salesOrders = await section(async () => own(
    await salesOrderService.listSalesOrders(auth, {}, deps), keys,
    (r) => ({
      clientId: r.clientId,
      names: (r.contacts || []).map((c) => c.name),
      phones: (r.contacts || []).map((c) => c.phone),
    })
  ));

  const payments = await section(async () => own(
    await paymentService.listPayments(auth, {}, deps), keys,
    (r) => ({ clientId: r.clientId, names: [r.personName], phones: [r.phone] })
  ));

  const trim = (list, shape) => (list === null ? null : list.map(({ row, matchedOn }) => ({ ...shape(row), matchedOn })));

  return {
    client,
    serviceCalls: trim(serviceCalls, (r) => ({
      id: String(r.id), complaintNumber: short(r.complaintNumber), type: short(r.type),
      site: short(r.site), status: short(r.status), division: short(r.division),
      registeredDate: short(r.registeredDate), appointmentDate: short(r.appointmentDate),
      unattended: !!r.unattended,
    })),
    projects: trim(projects, (r) => ({
      id: String(r.id), name: short(r.name), division: short(r.division),
      stage: short(r.stage), status: short(r.status),
      startDate: short(r.startDate), endDate: short(r.endDate),
    })),
    enquiries: trim(enquiries, (r) => ({
      id: String(r.id), name: short(r.name), segment: short(r.segment),
      status: short(r.status), siteType: short(r.siteType),
      estimatedValue: short(r.estimatedValue), lastReviewDate: short(r.lastReviewDate),
      quotations: quotesByEnquiry.get(String(r.id)) || [],
    })),
    quotations: trim(quotations, (r) => ({
      id: String(r.id), quotationNumber: short(r.quotationNumber), division: short(r.division),
      status: short(r.status), date: short(r.date), grandTotal: short(r.grandTotal),
    })),
    contracts: trim(contracts, (r) => ({
      id: String(r.id), site: short(r.site), category: short(r.category), amcType: short(r.amcType),
      division: short(r.division), status: short(r.status),
      startDate: short(r.startDate), endDate: short(r.endDate), amount: short(r.amount),
    })),
    salesOrders: trim(salesOrders, (r) => ({
      id: String(r.id), orderNumber: short(r.orderNumber), projectName: short(r.projectName),
      division: short(r.division), startDate: short(r.startDate), totalCost: short(r.totalCost),
    })),
    payments: trim(payments, (r) => ({
      id: String(r.id), projectOrReference: short(r.projectOrReference), amount: short(r.amount),
      status: short(r.status), receivedDate: short(r.receivedDate), nextCallDate: short(r.nextCallDate),
    })),
  };
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
/**
 * The client this name and number already belong to, if we hold them.
 *
 * Owner report (21 Nov 2026): an AMC record for "Aba walekar" put a SECOND
 * client on the list, beside the one already there under the restaurant's
 * name with the very same phone number — so the same customer sat in the
 * directory twice and an edit to one left the other saying the old thing.
 *
 * Matching the typed name alone could never have caught that: the two names
 * are different, which is exactly why somebody typed the second one. The
 * number is what says they are the same people, and it is the same rule the
 * client's own page uses to gather their records. Former names and former
 * numbers count too, so renaming a client does not start the duplicates
 * again.
 *
 * A number is only trusted when it is a whole one — ten digits. A short or
 * blank number matches nobody, because "" would match everybody.
 */
async function findExistingClient(companyId, { name, phone }, deps) {
  const normalizedName = normalizeName(name);
  if (normalizedName) {
    const byName = await deps.clientRepo.findByNormalizedName(companyId, normalizedName);
    if (byName) return byName;
  }
  const digits = normalizePhone(phone);
  const all = deps.clientRepo.listByCompany ? await deps.clientRepo.listByCompany(companyId) : [];
  if (digits.length === 10) {
    const byPhone = all.find((c) => normalizePhone(c.phone) === digits
      || (c.formerPhones || []).some((p) => normalizePhone(p) === digits));
    if (byPhone) return byPhone;
  }
  if (normalizedName) {
    const byFormerName = all.find((c) => (c.formerNames || []).some((n) => normalizeName(n) === normalizedName));
    if (byFormerName) return byFormerName;
  }
  return null;
}

async function rememberClient(input, auth, deps) {
  try {
    if (!deps || !deps.clientRepo || !auth || !auth.companyId) return null;
    const name = trim(input && (input.companyName || input.clientName));
    if (!name) return null;
    const normalizedName = normalizeName(input.companyName || input.clientName);
    // The same customer under a different spelling is still the same
    // customer — the number settles it. See findExistingClient.
    const known = await findExistingClient(auth.companyId, { name, phone: input.phone }, deps);
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
    const known = await findExistingClient(auth.companyId, { name, phone: c.phone }, deps);
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
  readDivisions,
  visibleToDivision,
  findExistingClient,
  listClients,
  getClient,
  getClientRecords,
  clientMatchKeys,
  matchReason,
  createClient,
  updateClient,
  deleteClient,
  rememberClient,
  importFromContracts,
  CLIENT_ROLES,
  normalizeName,
  normalizePhone,
};
