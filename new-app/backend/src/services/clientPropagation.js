'use strict';

/**
 * When a client is corrected, every record that copied their details is
 * corrected with them.
 *
 * OWNER REQUEST (18 Nov 2026): "In admin, in client if I change client name
 * or address it should change the name, address or any information it
 * should change the name everywhere in AMC/PM, Sales order, Payment,
 * Projects and Quotation."
 *
 * Every one of those records carries the customer's details as somebody
 * typed them, because that is how the company has always worked — nothing
 * reads back through the client record at display time. So a client renamed
 * on the Clients screen stayed renamed only there, and the register, the
 * AMC list and the quotation all went on showing the old spelling.
 *
 * ================= THE TWO RULES THAT MAKE THIS SAFE =================
 *
 * 1. A FIELD IS ONLY REWRITTEN WHEN IT STILL HOLDS THE OLD VALUE.
 *
 *    This is the whole safety of the thing. A sales order whose site
 *    address was typed for that job keeps it; one that was filled from the
 *    client follows the client. A service call whose site is a different
 *    branch is left alone. Nothing anybody typed deliberately is lost,
 *    because the only thing replaced is the exact value the client used to
 *    say — and the comparison ignores case and spacing, so "ABC Industries"
 *    matches "abc  industries".
 *
 *    It also means a second edit is harmless: once a record says the new
 *    name, it no longer matches the old one and is simply skipped.
 *
 * 2. WHAT HAS LEFT THE OFFICE IS NEVER REWRITTEN.
 *
 *    Owner's decision (18 Nov 2026), asked and answered: a quotation that is
 *    not a Draft has been sent, and a payment that has been collected is
 *    history. Rewriting either would leave our copy saying something
 *    different from the PDF already in the customer's hands. Those are
 *    reported as left alone, never changed quietly.
 *
 * WHICH RECORDS ARE CONSIDERED: the ones linked to this client by id, and
 * the older ones that match on name or on the last ten digits of a phone
 * number — the same matching the client's own page uses, so what the page
 * shows as theirs is exactly what an edit reaches. Owner's decision, asked
 * and answered: linked AND matched, because almost every record predates
 * the client link and "only linked" would correct nothing.
 *
 * NOT TOUCHED, deliberately: a contract's or a call's `site`, a sales
 * order's `projectName` and `siteAddress`, a project's `name`, a payment's
 * `personName` — unless they still hold the client's own old value, which
 * is rule 1 doing its job. A site is not an address and a project is not a
 * customer; the rule distinguishes them without needing a list of
 * exceptions.
 *
 * PERMISSION: none is checked here. This runs inside updateClient, which
 * has already decided the caller may edit clients, and it is a correction
 * to the company's own records rather than a new way to read them. It
 * deliberately sweeps the whole company rather than a division-scoped list:
 * correcting half the records and leaving the rest stale would be worse
 * than not correcting them at all.
 */

/*
 * clientService requires this module and this module needs its two
 * normalizers, so they are fetched at call time rather than at load time.
 * Node caches the module, so this costs nothing per call, and it keeps ONE
 * definition of what "the same name" and "the same number" mean — the same
 * one the client's own page matches its records with.
 */
const clients = () => require('./clientService');
const normalizeName = (v) => clients().normalizeName(v);
const normalizePhone = (v) => clients().normalizePhone(v);

/** Is this field still holding the value the client used to have? */
const sameName = (value, was) => Boolean(was) && normalizeName(value) === normalizeName(was);
const samePhone = (value, was) => {
  const a = normalizePhone(value);
  const b = normalizePhone(was);
  return a.length >= 10 && a === b;
};
const sameText = (value, was) =>
  Boolean(was) && String(value || '').trim().toLowerCase() === String(was).trim().toLowerCase();

/**
 * What this client is called, for records that keep one name. The firm when
 * there is one, the person otherwise — the same choice the Clients list and
 * the pickers make, so a record follows the name the team actually sees.
 */
const displayName = (client) => String(
  (client && (client.companyName || client.clientName)) || ''
).trim();

/**
 * The before-and-after of one client edit, reduced to the handful of values
 * other records could be holding. A field whose value did not change is
 * dropped here and never considered again.
 */
function changeSet(before, after) {
  const pairs = {
    name: [displayName(before), displayName(after)],
    phone: [String(before.phone || '').trim(), String(after.phone || '').trim()],
    email: [String(before.email || '').trim(), String(after.email || '').trim()],
    address: [String(before.address || '').trim(), String(after.address || '').trim()],
    gst: [String(before.gst || '').trim(), String(after.gst || '').trim()],
  };
  const out = {};
  for (const [key, [was, now]] of Object.entries(pairs)) {
    // Nothing is cleared by this: emptying a client's phone does not wipe
    // the number off their records, because a blank is not a correction.
    if (was && now && was !== now) out[key] = { was, now };
  }
  return out;
}

/**
 * The patch for one record: each field it copies, the old value to look for
 * and how to compare. Returns {} when this record holds none of them any
 * more, which is the usual answer.
 */
function patchFor(record, fields, change) {
  const patch = {};
  for (const [path, { from, how }] of Object.entries(fields)) {
    const moved = change[from];
    if (!moved) continue;
    const current = record[path];
    const matches = how === 'phone' ? samePhone(current, moved.was)
      : how === 'name' ? sameName(current, moved.was)
        : sameText(current, moved.was);
    if (matches) patch[path] = moved.now;
  }
  return patch;
}

/** The people on a record follow the client's people, by the same rule. */
function contactsPatch(record, change) {
  const rows = Array.isArray(record.contacts) ? record.contacts : [];
  if (rows.length === 0) return null;
  let touched = false;
  const next = rows.map((c) => {
    const row = { ...c };
    if (change.name && sameName(row.name, change.name.was)) { row.name = change.name.now; touched = true; }
    if (change.phone && samePhone(row.phone, change.phone.was)) { row.phone = change.phone.now; touched = true; }
    return row;
  });
  return touched ? next : null;
}

/* ------------------------------------------------------------------ *
 * What each kind of record copies from the client
 * ------------------------------------------------------------------ */

const COPIES = {
  contracts: { customer: { from: 'name', how: 'name' }, phone: { from: 'phone', how: 'phone' }, email: { from: 'email', how: 'text' }, site: { from: 'address', how: 'text' } },
  salesOrders: { projectName: { from: 'name', how: 'name' }, siteAddress: { from: 'address', how: 'text' } },
  projects: { customer: { from: 'name', how: 'name' }, name: { from: 'name', how: 'name' } },
  quotations: { customerName: { from: 'name', how: 'name' }, customerPhone: { from: 'phone', how: 'phone' }, customerEmail: { from: 'email', how: 'text' }, customerAddress: { from: 'address', how: 'text' }, customerGst: { from: 'gst', how: 'text' } },
  payments: { personName: { from: 'name', how: 'name' }, phone: { from: 'phone', how: 'phone' } },
  serviceCalls: { customer: { from: 'name', how: 'name' }, phone: { from: 'phone', how: 'phone' }, site: { from: 'address', how: 'text' } },
};

/** How to recognise this client on each kind of record. */
const IDENTITY = {
  contracts: (r) => ({ clientId: r.clientId, names: [r.customer], phones: [r.phone] }),
  salesOrders: (r) => ({ clientId: r.clientId, names: [r.projectName, ...(r.contacts || []).map((c) => c.name)], phones: (r.contacts || []).map((c) => c.phone) }),
  projects: (r) => ({ clientId: r.clientId, names: [r.customer, r.name], phones: [] }),
  quotations: (r) => ({ clientId: r.clientId, names: [r.customerName], phones: [r.customerPhone] }),
  payments: (r) => ({ clientId: r.clientId, names: [r.personName], phones: [r.phone] }),
  serviceCalls: (r) => ({ clientId: r.clientId, names: [r.customer], phones: [r.phone] }),
};

/**
 * Has this one left the office? A quotation that is not a Draft has been
 * sent; a payment that has been received, or part-received, has been
 * collected against. Both keep the wording they went out with.
 */
const SENT = {
  quotations: (r) => r.status && r.status !== 'Draft',
  payments: (r) => r.status === 'Received' || (Array.isArray(r.partPayments) && r.partPayments.length > 0),
};

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

/** Reads and writes for each kind, so the sweep itself stays one loop. */
function wiring(deps) {
  return {
    contracts: { list: () => deps.contractRepo.listByCompany, write: (c, id, p) => deps.contractRepo.update(c, id, p) },
    salesOrders: { list: () => deps.salesOrderRepo.listByCompany, write: (c, id, p) => deps.salesOrderRepo.update(c, id, p) },
    projects: { list: () => deps.projectRepo.listByCompany, write: (c, id, p) => deps.projectRepo.update(c, id, p) },
    quotations: { list: () => deps.quotationRepo.listByCompany, write: (c, id, p) => deps.quotationRepo.updateFields(c, id, p) },
    payments: { list: () => deps.paymentRepo.listByCompany, write: (c, id, p) => deps.paymentRepo.update(c, id, p) },
    serviceCalls: { list: () => deps.serviceCallRepo.listByCompany, write: (c, id, p) => deps.serviceCallRepo.update(c, id, p) },
  };
}

/**
 * Correct every record that still carries this client's old details.
 *
 * `before` is the client as it was, `after` as it now is; `keys` is the
 * client's match keys (clientService.clientMatchKeys) built from the record
 * as it WAS, so a record holding the old name is still recognised as theirs.
 *
 * Returns { updated: {kind: n}, leftAlone: {kind: n}, changed: [field] } —
 * a report, so the screen can say what happened instead of the team finding
 * out later. It never throws: a client edit that saved must not be undone
 * by a follow-on correction failing, so a kind that cannot be swept is
 * reported as 0 and the rest still run.
 */
async function propagateClientChange({ before, after, keys, companyId }, deps) {
  const change = changeSet(before, after);
  const changed = Object.keys(change);
  const report = { changed, updated: {}, leftAlone: {}, failed: [] };
  if (changed.length === 0) return report;

  const { matchReason } = clients();
  const parts = wiring(deps);

  for (const [kind, { list, write }] of Object.entries(parts)) {
    const listFn = list();
    if (typeof listFn !== 'function') continue;
    let updated = 0;
    let leftAlone = 0;
    try {
      const rows = await listFn.call(null, companyId);
      for (const row of rows || []) {
        if (!matchReason(keys, IDENTITY[kind](row))) continue;
        const patch = patchFor(row, COPIES[kind], change);
        const contacts = contactsPatch(row, change);
        if (contacts) patch.contacts = contacts;
        if (Object.keys(patch).length === 0) continue;
        if (SENT[kind] && SENT[kind](row)) { leftAlone += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        await write(companyId, row.id, patch);
        updated += 1;
      }
    } catch (err) {
      report.failed.push({ kind, reason: err && err.message ? err.message : String(err) });
    }
    if (updated) report.updated[kind] = updated;
    if (leftAlone) report.leftAlone[kind] = leftAlone;
  }
  return report;
}

module.exports = {
  propagateClientChange,
  changeSet,
  patchFor,
  contactsPatch,
  displayName,
  COPIES,
  IDENTITY,
  SENT,
};
