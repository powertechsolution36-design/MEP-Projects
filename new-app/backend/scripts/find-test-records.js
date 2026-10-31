'use strict';

/**
 * READ-ONLY. Finds the records left behind by testing (owner request,
 * 31 Oct 2026), so they can be reviewed before anything is deleted.
 *
 * It never writes, updates or deletes. Nothing it does can change the
 * database; running it twice changes nothing and costs nothing.
 *
 *   cd /var/www/mep-new-app/backend
 *   node scripts/find-test-records.js
 *
 * WHAT IT LOOKS FOR. Every string field of every business collection, for
 * the word "test" in any case. That is a wide net on purpose — the owner
 * asked for anything with "test" in it — so the report separates two very
 * different kinds of match:
 *
 *   NAMED    the word is in something that names the record: the client,
 *            the site, the project, the person, a username. These are
 *            almost always the test records you are looking for.
 *
 *   MENTION  the word is only in free text — a remark, a service report, a
 *            discussion note, a checklist result. A real completed visit
 *            whose engineer wrote "tested the unit for an hour", or whose
 *            checklist says "Cooling Testing", lands here. DELETING THESE
 *            WOULD DESTROY REAL WORK. They are listed so you can see them,
 *            and they are kept out of the delete list unless you move them
 *            in by hand.
 *
 * It writes the full detail to a JSON file beside itself and prints a
 * readable summary. Phone numbers and e-mail addresses are masked in what
 * is printed, so the summary can be shared without handing anybody a client
 * list; the JSON on the server keeps everything.
 *
 * Exit code 0 = nothing found, 2 = candidates found, 1 = error.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { getConfig } = require('../src/config/env');

const NEEDLE = /test/i;

/**
 * The collections worth scanning, and the fields in each that NAME the
 * record. Anything else that matches is a mention, not a name.
 *
 * Deliberately absent: users (deleting a staff login is a different job,
 * done on the Users screen), companies, counters, sessions, templates and
 * the inventory catalogues — a test record there is not what was asked
 * about, and a counter is not a record at all.
 */
const COLLECTIONS = [
  { name: 'contracts', label: 'AMC / Warranty clients', nameFields: ['customer', 'site', 'contactPerson'] },
  { name: 'serviceCalls', label: 'Service calls (complaints and PM visits)', nameFields: ['customer', 'site'] },
  { name: 'projects', label: 'Projects', nameFields: ['projectName', 'customer', 'site', 'clientName'] },
  { name: 'enquiries', label: 'Enquiries', nameFields: ['clientName', 'customer', 'projectOrReference', 'personName'] },
  { name: 'salesOrders', label: 'Sales orders', nameFields: ['clientName', 'customer', 'projectOrReference', 'personName'] },
  { name: 'payments', label: 'Payments', nameFields: ['projectOrReference', 'personName'] },
  { name: 'quotations', label: 'Quotations', nameFields: ['clientName', 'customer', 'projectOrReference', 'personName', 'site'] },
  { name: 'customeraccounts', label: 'Customer logins', nameFields: ['name'] },
  { name: 'portalinvites', label: 'Portal invite links', nameFields: ['label', 'customer'] },
  { name: 'servicecallattachments', label: 'Complaint photographs', nameFields: ['filename'] },
  { name: 'projectphotos', label: 'Project photographs', nameFields: ['filename', 'caption'] },
  { name: 'dailyTasks', label: 'Daily tasks', nameFields: ['title', 'text'] },
  { name: 'notifications', label: 'Notifications', nameFields: ['text'] },
];

/** Fields never worth reading out, and never a reason to delete anything. */
const SKIP_FIELDS = new Set(['_id', 'companyId', 'passwordHash', 'token', 'data', 'clientSignatureImage', 'logoBase64', 'signatureBase64', 'stampBase64', 'p256dh', 'auth', 'endpoint']);

const MASK_FIELDS = /phone|mobile|email|whatsapp/i;

function mask(value) {
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

/** Every string inside a document, with the path that got there. */
function walk(value, prefix, out, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (NEEDLE.test(value)) out.push({ path: prefix, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${prefix}[${i}]`, out, depth + 1));
    return;
  }
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_FIELDS.has(k)) continue;
      walk(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  }
}

/**
 * Is this record NAMED "test", or does it only MENTION it?
 *
 * The whole safety of the exercise is this one function: a record whose
 * client, site or project is called "test" is a test record; a record whose
 * engineer wrote "tested and working" is somebody's real visit.
 */
function classify(doc, nameFields) {
  const hits = [];
  walk(doc, '', hits);
  if (!hits.length) return { kind: 'none', hits };
  const named = hits.some((h) => nameFields.includes(h.path));
  return { kind: named ? 'named' : 'mention', hits };
}

/** A short, human line that says which record this is. */
function describe(doc, nameFields) {
  const bits = [];
  for (const f of nameFields) if (doc[f]) bits.push(String(doc[f]));
  if (doc.complaintNumber) bits.unshift(`PSC-${doc.complaintNumber}`);
  if (doc.quotationNumber) bits.unshift(String(doc.quotationNumber));
  if (doc.orderNumber) bits.unshift(`SO-${doc.orderNumber}`);
  return bits.length ? bits.join(' · ') : '(no name on this record)';
}

async function main() {
  const { mongoUri, dbName } = getConfig();
  if (!mongoUri) {
    console.error('MONGODB_URI is not set. Run this from the application directory, where .env is.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { dbName });
  // Said plainly, because deleting from the wrong database is the one
  // mistake that cannot be undone. The connection string itself is never
  // printed — it carries the password.
  console.log(`Database: ${mongoose.connection.name}\n`);

  const report = { generatedAt: new Date().toISOString(), database: mongoose.connection.name, named: [], mentions: [] };

  for (const c of COLLECTIONS) {
    let docs;
    try {
      // eslint-disable-next-line no-await-in-loop
      docs = await mongoose.connection.db.collection(c.name).find({}).toArray();
    } catch {
      continue; // a collection that does not exist yet is not an error
    }

    for (const doc of docs) {
      const { kind, hits } = classify(doc, c.nameFields);
      if (kind === 'none') continue;
      const entry = {
        collection: c.name,
        label: c.label,
        id: String(doc._id),
        companyId: doc.companyId ? String(doc.companyId) : null,
        describe: describe(doc, c.nameFields),
        createdAt: doc.createdAt || doc.registeredDate || null,
        matched: hits.map((h) => ({
          field: h.path,
          text: MASK_FIELDS.test(h.path) ? mask(h.value) : String(h.value).slice(0, 120),
        })),
      };
      (kind === 'named' ? report.named : report.mentions).push(entry);
    }
  }

  const out = path.join(__dirname, `test-records-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  const group = (rows) => rows.reduce((m, r) => { (m[r.label] = m[r.label] || []).push(r); return m; }, {});

  console.log('═══ NAMED — the record itself is called "test" ═══');
  console.log('These are the ones you almost certainly want gone.\n');
  const named = group(report.named);
  for (const [label, rows] of Object.entries(named)) {
    console.log(`${label} — ${rows.length}`);
    for (const r of rows) {
      const when = r.createdAt ? String(new Date(r.createdAt).toISOString().slice(0, 10)) : '—';
      console.log(`   ${when}  ${r.describe}`);
      console.log(`             ${r.id}`);
    }
    console.log('');
  }
  if (!report.named.length) console.log('   (none)\n');

  console.log('═══ MENTION — "test" appears only in free text ═══');
  console.log('A real visit whose report says "tested", a checklist item');
  console.log('"Cooling Testing", a note. READ THESE BEFORE DELETING ANY.\n');
  const mentions = group(report.mentions);
  for (const [label, rows] of Object.entries(mentions)) {
    console.log(`${label} — ${rows.length}`);
    for (const r of rows.slice(0, 40)) {
      const where = r.matched.map((m) => `${m.field}="${m.text}"`).slice(0, 2).join('  ');
      console.log(`   ${r.describe}`);
      console.log(`             ${where}`);
      console.log(`             ${r.id}`);
    }
    if (rows.length > 40) console.log(`   … and ${rows.length - 40} more, all in the JSON file`);
    console.log('');
  }
  if (!report.mentions.length) console.log('   (none)\n');

  console.log('───────────────────────────────────────────────');
  console.log(`NAMED   ${report.named.length}`);
  console.log(`MENTION ${report.mentions.length}`);
  console.log(`\nFull detail: ${out}`);
  console.log('Nothing has been deleted. This script cannot delete anything.');

  await mongoose.disconnect();
  process.exit(report.named.length + report.mentions.length ? 2 : 0);
}

/* The classifying is pure and is tested on its own (tests/testRecords.test.js);
   only the database half needs a database. */
module.exports = { walk, describe, classify, NEEDLE, COLLECTIONS, mask };

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Failed:', err && err.message);
    try { await mongoose.disconnect(); } catch { /* already down */ }
    process.exit(1);
  });
}
