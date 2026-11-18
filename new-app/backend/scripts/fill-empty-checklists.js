'use strict';

/**
 * Give the projects that have NO checklist the standard points for their
 * division (owner request, 18 Nov 2026: "the 13 checklists sholud be shown
 * default for any project afterwards they can edit").
 *
 * WHY THESE PROJECTS ARE EMPTY. A project takes its checklist when the
 * sales order creates it, down this chain: the division's default template,
 * then any template for the division, then the standard points. A template
 * with NO points in it — one started on the Checklist Template screen and
 * left empty — is still a template, so it won that chain and the project
 * was created with nothing. salesOrderCascade.js now passes an empty
 * template over, so every project made from here on is fine. This script is
 * for the ones already made.
 *
 * DRY RUN BY DEFAULT. It prints what it would do and writes nothing:
 *
 *   cd /var/www/mep-new-app/backend
 *   node scripts/fill-empty-checklists.js
 *
 * Only with --apply does it write:
 *
 *   node scripts/fill-empty-checklists.js --apply
 *
 * WHAT IT TOUCHES. Only projects whose `checklist` is missing or empty, and
 * only that one field plus `checklistTemplateName` (left as ''). A project
 * that has ANY point — one point or thirty, ticked or not — is never
 * touched, so nothing anybody has filled in can be lost. Nothing else in
 * the project, and no other collection, is read or written.
 *
 * Every point is written fresh: not done, not signed, no date, no approval,
 * no photographs. They are the starting points, exactly as a new project
 * gets them, and the team edits them on the project afterwards.
 *
 * Running it twice is safe: the second run finds nothing to do, because the
 * projects it filled are no longer empty.
 *
 * Exit code 0 = nothing to do or applied cleanly, 2 = a dry run that found
 * work, 1 = error.
 */

const mongoose = require('mongoose');
const { getConfig } = require('../src/config/env');
const { loadEnvFile } = require('./lib/loadEnvFile');
const { LEGACY_CHECKLIST_FALLBACK } = require('../src/models/shared/legacyChecklists');

const APPLY = process.argv.includes('--apply');

/** A point as a brand-new project gets it. */
const freshPoint = (t) => ({
  text: t.text,
  signResponsibility: t.signResponsibility,
  done: false,
  completedDate: null,
  pmSigned: false,
  remark: '',
  photos: [],
  targetDate: null,
  approval: null,
});

async function main() {
  // The script is run by hand, with no shell that has sourced .env.
  // Nothing from it is ever printed.
  loadEnvFile();
  const { mongoUri, dbName } = getConfig();
  if (!mongoUri) {
    console.error('MONGODB_URI is not set, and backend/.env does not supply it.');
    console.error('Run this from the backend directory of the installed application.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { dbName });
  // Said plainly: writing to the wrong database is the one mistake that
  // cannot be undone. The connection string is never printed.
  console.log(`Database: ${mongoose.connection.name}`);
  console.log(APPLY ? 'Mode:     APPLY — projects will be written\n' : 'Mode:     dry run — nothing will be written\n');

  const projects = mongoose.connection.db.collection('projects');
  const empty = await projects.find({
    $or: [{ checklist: { $exists: false } }, { checklist: { $size: 0 } }],
  }).toArray();

  if (empty.length === 0) {
    console.log('Every project already has a checklist. Nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`${empty.length} project${empty.length === 1 ? '' : 's'} with no checklist:\n`);
  let written = 0;
  const noStandard = [];

  for (const p of empty) {
    const standard = LEGACY_CHECKLIST_FALLBACK[p.division];
    const name = p.name || '(unnamed)';
    if (!standard || standard.length === 0) {
      // A project whose division has no standard list — nothing honest to
      // put in it, so it is reported rather than guessed at.
      noStandard.push(`${name} [${p.division || 'no division'}]`);
      console.log(`  —  ${name} [${p.division || 'no division'}] — no standard list for this division, left alone`);
      continue;
    }
    console.log(`  ${APPLY ? '->' : '  '} ${name} [${p.division}] — ${standard.length} points`);
    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await projects.updateOne(
        { _id: p._id },
        { $set: { checklist: standard.map(freshPoint), checklistTemplateName: '' } }
      );
      written += 1;
    }
  }

  console.log('');
  if (APPLY) {
    console.log(`Filled ${written} project${written === 1 ? '' : 's'}.`);
  } else {
    console.log(`Would fill ${empty.length - noStandard.length} project(s). Nothing was written.`);
    console.log('Run it again with --apply to write.');
  }
  if (noStandard.length) {
    console.log(`\nLeft alone for want of a standard list: ${noStandard.join(', ')}`);
  }

  await mongoose.disconnect();
  process.exit(APPLY ? 0 : 2);
}

main().catch(async (err) => {
  console.error('Failed:', err && err.message ? err.message : err);
  try { await mongoose.disconnect(); } catch (_) { /* already closed */ }
  process.exit(1);
});
