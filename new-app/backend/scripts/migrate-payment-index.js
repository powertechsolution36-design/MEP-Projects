'use strict';
/**
 * One-time migration: fix the unique index on `payments`.
 *
 * WHY. The index on (companyId, salesOrderId, milestoneIndex) was declared
 * `sparse: true` to mean "only SO-linked payments". A COMPOUND sparse index
 * does not mean that: MongoDB keys a document when ANY of the indexed fields
 * is present, and `companyId` always is (salesOrderId/milestoneIndex are
 * `default: null`, so present-and-null rather than missing). Every manual
 * payment therefore keyed as (companyId, null, null), and a company's SECOND
 * manual payment was rejected with "A payment record already exists for this
 * sales order milestone."
 *
 * The model now declares a PARTIAL index instead, which keys only the rows
 * whose salesOrderId is a real ObjectId. Mongoose cannot apply that on its
 * own: an index with the same key pattern but different options already
 * exists, so createIndex fails with IndexOptionsConflict (85) and the old,
 * broken index silently stays. This drops it and builds the correct one.
 *
 * Run ON THE SERVER, from new-app/backend, with the app's own environment:
 *
 *   set -a; source .env; set +a
 *   node scripts/migrate-payment-index.js              # dry run, changes nothing
 *   node scripts/migrate-payment-index.js --commit     # apply
 *
 * Safe to run twice: if the correct index is already in place it does nothing.
 */

const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/db/connection');

const COMMIT = process.argv.includes('--commit');
const KEY = { companyId: 1, salesOrderId: 1, milestoneIndex: 1 };
const WANTED = { salesOrderId: { $type: 'objectId' } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  await connectToDatabase();
  const db = mongoose.connection.db;
  console.log(`\nDatabase: ${db.databaseName}   mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);

  const col = db.collection('payments');
  const before = await col.indexes();
  const target = before.find((i) => same(i.key, KEY));

  console.log('\nCurrent indexes on `payments`:');
  for (const i of before) {
    console.log(`  ${i.name}  key=${JSON.stringify(i.key)}`
      + `${i.unique ? ' unique' : ''}${i.sparse ? ' SPARSE' : ''}`
      + `${i.partialFilterExpression ? ' partial=' + JSON.stringify(i.partialFilterExpression) : ''}`);
  }

  if (!target) {
    console.log('\nThe milestone index is absent. Nothing to drop; it will be created.');
  } else if (same(target.partialFilterExpression, WANTED) && !target.sparse) {
    console.log(`\nAlready correct (${target.name}). Nothing to do.`);
    await mongoose.connection.close();
    return;
  } else {
    console.log(`\nStale index found: ${target.name}`
      + `${target.sparse ? ' (sparse — this is the bug)' : ''}`);
  }

  // How many manual payments exist now, so the effect is visible either way.
  const manual = await col.countDocuments({ salesOrderId: null });
  console.log(`Manual payments (salesOrderId null) currently stored: ${manual}`);

  if (!COMMIT) {
    console.log('\nWould drop the stale index and create:');
    console.log(`  key=${JSON.stringify(KEY)} unique partialFilterExpression=${JSON.stringify(WANTED)}`);
    console.log('\nDry run only — nothing changed. Re-run with --commit to apply.\n');
    await mongoose.connection.close();
    return;
  }

  if (target) {
    await col.dropIndex(target.name);
    console.log(`Dropped ${target.name}`);
  }
  await col.createIndex(KEY, { unique: true, partialFilterExpression: WANTED });
  console.log('Created the partial unique index.');

  console.log('\nIndexes now:');
  for (const i of await col.indexes()) {
    console.log(`  ${i.name}  key=${JSON.stringify(i.key)}`
      + `${i.unique ? ' unique' : ''}${i.sparse ? ' SPARSE' : ''}`
      + `${i.partialFilterExpression ? ' partial=' + JSON.stringify(i.partialFilterExpression) : ''}`);
  }
  console.log('\nDone.\n');
  await mongoose.connection.close();
})().catch(async (err) => {
  console.error('\nERROR:', err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
