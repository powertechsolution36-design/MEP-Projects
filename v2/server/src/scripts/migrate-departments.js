/**
 * Migration: Backfill designation + department for all existing users
 * based on their legacy role field.
 *
 * Run: node src/scripts/migrate-departments.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const User = require('../models/User');

async function main() {
  await connectDB();
  console.log('[migrate] Connected. Starting department backfill...');

  const users = await User.find({}).lean();
  console.log(`[migrate] Found ${users.length} users`);

  let updated = 0, skipped = 0;
  for (const u of users) {
    if (u.designation && u.department) { skipped++; continue; }
    const map = User.ROLE_TO_DESDEP[u.role];
    if (!map) { console.log(`[migrate] Skipped ${u.un}: unknown role "${u.role}"`); skipped++; continue; }
    await User.updateOne({ _id: u._id }, { $set: { designation: map.designation, department: map.department } });
    updated++;
    console.log(`[migrate] ✓ ${u.un} → ${map.designation} / ${map.department}`);
  }

  console.log(`\n[migrate] Done. Updated: ${updated}, Skipped: ${skipped}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
