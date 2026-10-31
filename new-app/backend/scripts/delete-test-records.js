'use strict';

/**
 * Deletes the test records a person has reviewed (owner request,
 * 31 Oct 2026). The second half of scripts/find-test-records.js.
 *
 *   cd /var/www/mep-new-app/backend
 *   node scripts/find-test-records.js                 # read the list
 *   node scripts/delete-test-records.js <file.json>   # shows what it would do
 *   node scripts/delete-test-records.js <file.json> --confirm
 *
 * WHAT IT WILL AND WILL NOT DELETE.
 *
 * It deletes exactly the records in the file's `named` list — the ones whose
 * client, site or project is called "test" — and whatever hangs off them.
 * It does NOT touch the `mentions` list, whatever is in it: those are real
 * records that merely contain the word, and deleting a visit because its
 * engineer wrote "tested and working" would destroy real work. If you have
 * read a mention and want it gone, move that entry into `named` in the JSON
 * file by hand; nothing here will do it for you.
 *
 * Without --confirm it only prints. With --confirm it deletes, and deletion
 * is permanent — Mongo has no recycle bin. TAKE THE BACKUP FIRST:
 *
 *   mongodump --db mep_new_app --out ~/backup-$(date +%F-%H%M)
 *
 * It refuses to run unless that is acknowledged with --backed-up.
 */

const fs = require('fs');
const mongoose = require('mongoose');
const { getConfig } = require('../src/config/env');
const { loadEnvFile } = require('./lib/loadEnvFile');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const CONFIRM = args.includes('--confirm');
const BACKED_UP = args.includes('--backed-up');

/**
 * What hangs off each kind of record. Written out rather than inferred: a
 * cascade that guesses is how a tidy-up takes a real client's history with
 * it. Each entry is [collection, field that points back, how to match].
 */
const DEPENDENTS = {
  contracts: [
    ['serviceCalls', 'contractId'],
    ['customeraccounts', 'contractId'],
    ['portalinvites', 'contractId'],
    ['portalPushSubscriptions', 'contractId'],
  ],
  serviceCalls: [
    ['servicecallattachments', 'serviceCallId'],
  ],
  projects: [
    ['projectphotos', 'projectId'],
  ],
  salesOrders: [
    ['payments', 'salesOrderId'],
  ],
  customeraccounts: [
    ['customersessions', 'accountId'],
    ['portalPushSubscriptions', 'customerAccountId'],
    ['servicecallattachments', 'customerAccountId'],
  ],
};

/** Dependents of dependents — one more level, explicitly. */
const SECOND_LEVEL = { serviceCalls: ['servicecallattachments', 'serviceCallId'] };

const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function main() {
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/delete-test-records.js <test-records-YYYY-MM-DD.json> [--backed-up --confirm]');
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const named = report.named || [];
  if (!named.length) {
    console.log('Nothing in the "named" list. Nothing to do.');
    process.exit(0);
  }

  loadEnvFile();
  const { mongoUri, dbName } = getConfig();
  if (!mongoUri) {
    console.error('MONGODB_URI is not set, and backend/.env does not supply it.');
    process.exit(1);
  }
  await mongoose.connect(mongoUri, { dbName });
  const db = mongoose.connection.db;
  console.log(`Database: ${mongoose.connection.name}`);
  if (report.database && report.database !== mongoose.connection.name) {
    console.error(`\nThat list was taken from "${report.database}", and this is "${mongoose.connection.name}". Refusing.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`List taken: ${report.generatedAt}\n`);

  /* ---- work out everything that would go, before anything goes ---- */
  const plan = new Map(); // collection -> Set of id strings
  const add = (coll, id) => {
    if (!plan.has(coll)) plan.set(coll, new Set());
    plan.get(coll).add(String(id));
  };

  for (const row of named) add(row.collection, row.id);

  // A copy of the entries on purpose: the loop adds to `plan` as it goes.
  for (const [coll, ids] of [...plan.entries()]) {
    for (const [depColl, field] of DEPENDENTS[coll] || []) {
      // eslint-disable-next-line no-await-in-loop
      const deps = await db.collection(depColl).find({ [field]: { $in: [...ids].map(oid) } }).project({ _id: 1 }).toArray();
      for (const d of deps) add(depColl, d._id);

      const second = SECOND_LEVEL[depColl];
      if (second && deps.length) {
        const [secondColl, secondField] = second;
        // eslint-disable-next-line no-await-in-loop
        const more = await db.collection(secondColl)
          .find({ [secondField]: { $in: deps.map((d) => d._id) } }).project({ _id: 1 }).toArray();
        for (const m of more) add(secondColl, m._id);
      }
    }
  }

  console.log('This would delete:\n');
  let total = 0;
  for (const [coll, ids] of plan) {
    console.log(`   ${String(ids.size).padStart(4)}  ${coll}`);
    total += ids.size;
  }
  console.log(`\n   ${String(total).padStart(4)}  records in all`);
  console.log(`\n   ${report.mentions ? report.mentions.length : 0} "mention" records are NOT touched.`);

  if (!CONFIRM) {
    console.log('\nNothing was deleted. Add --backed-up --confirm to do it for real.');
    await mongoose.disconnect();
    process.exit(0);
  }
  if (!BACKED_UP) {
    console.log('\nRefusing: take a backup first, then pass --backed-up as well.');
    console.log('   mongodump --db mep_new_app --out ~/backup-$(date +%F-%H%M)');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\nDeleting…');
  for (const [coll, ids] of plan) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.collection(coll).deleteMany({ _id: { $in: [...ids].map(oid) } });
    console.log(`   ${String(res.deletedCount).padStart(4)}  ${coll}`);
  }

  // A client account that watched a deleted project keeps a dangling id.
  const projectIds = [...(plan.get('projects') || [])].map(oid);
  if (projectIds.length) {
    const r1 = await db.collection('customeraccounts').updateMany({}, { $pull: { linkedProjectIds: { $in: projectIds } } });
    const r2 = await db.collection('portalinvites').updateMany({}, { $pull: { projectIds: { $in: projectIds } } });
    console.log(`   tidied ${r1.modifiedCount} customer login(s) and ${r2.modifiedCount} invite(s) that pointed at a deleted project`);
  }

  console.log('\nDone. This cannot be undone — the backup is the way back.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Failed:', err && err.message);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
