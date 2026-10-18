'use strict';

/**
 * READ-ONLY pre-deployment check for the username-only login change.
 *
 * Login is now username + password with no company ID (owner decision),
 * which requires usernames to be unique across the whole platform. Users
 * created before this change were only unique per company. This script
 * lists every username shared by more than one account so they can be
 * renamed by an administrator BEFORE the new login screen goes live (until
 * then those people get "More than one account uses this username").
 *
 * It never writes, updates or deletes anything. It prints usernames,
 * company ids and roles only — never password hashes.
 *
 *   MONGODB_URI=... MONGODB_DB_NAME=... node scripts/check-duplicate-usernames.js
 *
 * Exit code 0 = no duplicates, 2 = duplicates found, 1 = error.
 */

const mongoose = require('mongoose');
const { getConfig } = require('../src/config/env');

async function main() {
  const { mongoUri, dbName } = getConfig();
  if (!mongoUri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(mongoUri, { dbName });
  try {
    // Plain projection + in-process grouping (no aggregation operators), so
    // it runs on any MongoDB-compatible server. Usernames match exactly, as
    // login does.
    const rows = await mongoose.connection.db.collection('users')
      .find({}, { projection: { _id: 0, username: 1, companyId: 1, role: 1 } }).toArray();
    const byName = new Map();
    for (const r of rows) {
      const list = byName.get(r.username) || [];
      list.push(r);
      byName.set(r.username, list);
    }
    const dups = [...byName.entries()].filter(([, list]) => list.length > 1)
      .map(([name, accounts]) => ({ _id: name, n: accounts.length, accounts }))
      .sort((x, y) => String(x._id).localeCompare(String(y._id)));
    if (!dups.length) {
      console.log(`OK: every username in "${dbName}" is unique across the platform.`);
      return 0;
    }
    console.log(`Found ${dups.length} username(s) used by more than one account in "${dbName}":`);
    for (const d of dups) {
      console.log(`- ${d._id} (${d.n} accounts)`);
      for (const a of d.accounts) console.log(`    company ${a.companyId || '(none)'}  role ${a.role}  username "${a.username}"`);
    }
    return 2;
  } finally {
    await mongoose.disconnect();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('Check failed:', err.message);
  process.exit(1);
});
