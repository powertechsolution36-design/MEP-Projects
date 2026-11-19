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
 * IT ALSO REPORTS. Before anything else it lists EVERY project and how many
 * points it has, because "not all projects showing" has two different causes
 * and they need telling apart: a project with NO points (this script fills
 * it) and a project whose division has a Checklist Template with fewer
 * points than the standard list (the template won, and emptying or deleting
 * it on the Checklist Template screen is the fix — not this script).
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

/** A project has no checklist when the array is missing or holds nothing. */
const isEmpty = (p) => !Array.isArray(p.checklist) || p.checklist.length === 0;

/**
 * What every project's checklist looks like, as lines to print.
 *
 * Owner, 19 Nov 2026: "not all projects showing". Two different causes wear
 * the same face and have to be told apart:
 *   · a project with NO points — this script fills it;
 *   · a project whose division has a Checklist Template with fewer points
 *     than the standard list — the template won the fallback chain, and the
 *     fix is to empty or delete it on the Checklist Template screen, not to
 *     run this.
 *
 * Exported so it can be tested against real shapes rather than trusted.
 * Reads only; it is handed plain objects and returns plain text.
 */
function describeProjects(all) {
  const lines = [];
  const standardCount = (division) => (LEGACY_CHECKLIST_FALLBACK[division] || []).length;
  for (const p of all) {
    const n = Array.isArray(p.checklist) ? p.checklist.length : 0;
    const want = standardCount(p.division);
    const from = p.checklistTemplateName ? `template "${p.checklistTemplateName}"` : 'the standard points';
    const note = isEmpty(p) ? 'EMPTY — this script fills it'
      : n === want ? 'ok'
        : `${n} points from ${from}, not the ${want} standard — left alone, see below`;
    lines.push(`  ${String(n).padStart(3)} pts  ${p.name || '(unnamed)'} [${p.division || 'no division'}] — ${note}`);
  }
  const empty = all.filter(isEmpty);
  const odd = all.filter((p) => !isEmpty(p) && p.checklist.length !== standardCount(p.division));
  return { lines, empty, odd };
}

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

  // EVERY project and how many points it has. Reads only; nothing is
  // written here (owner, 19 Nov 2026: "not all projects showing").
  const all = await projects.find({}).toArray();
  const { lines, empty, odd } = describeProjects(all);

  console.log(`${all.length} project${all.length === 1 ? '' : 's'} in all:\n`);
  for (const line of lines) console.log(line);

  if (odd.length) {
    console.log(`\n${odd.length} project(s) have a checklist that is not the standard one.`);
    console.log('Those came from a Checklist Template for their division, and this script');
    console.log('does NOT replace them: points already ticked, remarked or signed off would');
    console.log('be lost. To have new projects take the standard points instead, empty or');
    console.log('delete that template on the Checklist Template screen. To change one of');
    console.log('these projects, apply a template to it on the project itself.');
  }
  console.log('');

  if (empty.length === 0) {
    console.log('No project is missing its checklist. Nothing to fill.');
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

module.exports = { describeProjects, isEmpty, freshPoint };

/*
 * Run only when this file IS the command. Required as a module — which is
 * how its reporting is tested against real shapes — it connects to nothing
 * and writes nothing.
 */
if (require.main === module) {
  main().catch(async (err) => {
    console.error('Failed:', err && err.message ? err.message : err);
    try { await mongoose.disconnect(); } catch (_) { /* already closed */ }
    process.exit(1);
  });
}
