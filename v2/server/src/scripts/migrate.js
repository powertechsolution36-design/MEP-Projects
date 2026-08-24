/**
 * Migration: preserve existing users from v1, wipe everything else.
 * Run once when upgrading from v1 to v2.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');

async function migrate() {
  await connectDB();
  console.log('Migration v1 -> v2');
  const db = mongoose.connection.db;
  // Wipe all except users and companies
  const preserve = new Set(['users', 'companies']);
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    if (preserve.has(c.name)) {
      console.log(`  PRESERVE: ${c.name}`);
      continue;
    }
    if (c.name.startsWith('system.')) continue;
    await db.collection(c.name).drop().catch(() => {});
    console.log(`  DROPPED: ${c.name}`);
  }
  console.log('Migration complete. Users and companies preserved; other data wiped.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
