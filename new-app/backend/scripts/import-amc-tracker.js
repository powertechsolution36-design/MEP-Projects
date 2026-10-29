'use strict';
/**
 * AMC Service Tracker workbook -> Contract records, including the HISTORICAL
 * completed-service dates.
 *
 * Run ON THE SERVER, from new-app/backend, with the app's own environment:
 *
 *   set -a; source .env; set +a
 *   node scripts/import-amc-tracker.js --company "<exact name>"            # dry run
 *   node scripts/import-amc-tracker.js --company "<exact name>" --commit   # apply
 *
 * What it does, in the application's own data model:
 *   - a row with no matching contract is CREATED through
 *     contractService.createManualContract (validation, tenant scoping, and
 *     the generated visit schedule);
 *   - its historical completions are then stamped onto that schedule with
 *     contractRepo.setVisitCompleted — the same single-field write the app
 *     uses when an engineer completes a PM visit;
 *   - a row that already matches a contract is RECONCILED: only missing
 *     completions are added. No other field is touched, and a completion
 *     already recorded is never overwritten, even if the workbook differs.
 *
 * Safe by default: dry run unless --commit, and idempotent — running it twice
 * creates no duplicate contract and writes no completion twice.
 *
 * It creates no ServiceCalls, payments, notifications or inventory movements.
 */

const path = require('path');
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const COMMIT = argv.includes('--commit');
const COMPANY_NAME = arg('--company');
const COMPANY_ID = arg('--companyId');
const DATA_PATH = arg('--data') || path.join(__dirname, 'amc-tracker-data.json');

const { connectToDatabase } = require('../src/db/connection');
const contractService = require('../src/services/contractService');
const repos = require('../src/repositories/businessRepositories.mongoose');
const Company = require('../src/models/Company');
const { planAmcImport } = require('./amcImportPlan');

async function resolveCompany() {
  if (COMPANY_ID) {
    const c = await Company.findById(COMPANY_ID).lean();
    if (!c) throw new Error(`No company with id ${COMPANY_ID}`);
    return c;
  }
  const all = await Company.find({}, { name: 1 }).lean();
  if (!COMPANY_NAME) {
    throw new Error('Pass --company "<exact company name>" (or --companyId). Companies present:\n'
      + all.map((c) => `   - ${c.name}  (${c._id})`).join('\n'));
  }
  const hit = all.filter((c) => String(c.name).trim().toLowerCase() === COMPANY_NAME.trim().toLowerCase());
  if (hit.length === 1) return hit[0];
  if (!hit.length) {
    throw new Error(`No company named "${COMPANY_NAME}". Companies present:\n`
      + all.map((c) => `   - ${c.name}  (${c._id})`).join('\n'));
  }
  throw new Error(`"${COMPANY_NAME}" matches ${hit.length} companies — use --companyId.`);
}

async function main() {
  const data = require(DATA_PATH);
  await connectToDatabase();
  const dbName = mongoose.connection.db.databaseName;
  const company = await resolveCompany();
  const companyId = company._id;
  const actorAuth = { companyId, role: 'admin', userId: null };

  // Only this company's contracts are ever considered.
  const existing = await repos.contractRepo.listByCompany(companyId);
  const plan = planAmcImport(data.records, existing);

  console.log(`\nAMC tracker import — ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no changes)'}`);
  console.log(`Database : ${dbName}`);
  console.log(`Company  : ${company.name} (${companyId})`);
  console.log(`Source   : ${data.source} / sheet ${data.sheet}`);
  console.log(`Existing contracts in this company: ${existing.length}\n`);
  console.log('Plan:');
  Object.entries(plan.totals).forEach(([k, v]) => console.log(`  ${k.padEnd(26)} ${v}`));

  if (plan.skipped.length) {
    console.log('\n-- rows skipped (a required field is missing; nothing guessed) --');
    plan.skipped.forEach((s) => console.log(
      `  R${s.row} ${String(s.site).slice(0, 38).padEnd(40)} ${s.reason}`
      + (s.completionsInSource ? `  [${s.completionsInSource} completion(s) not imported]` : '')));
  }
  if (plan.conflicts.length) {
    console.log('\n-- conflicts: reported, NOT changed --');
    plan.conflicts.forEach((c) => console.log(`  R${c.row} ${c.kind}: ${c.detail}`));
  }
  if (plan.updates.length) {
    console.log('\n-- existing contracts: historical completions to add --');
    plan.updates.forEach((u) => console.log(
      `  R${u.row} ${String(u.site).slice(0, 34).padEnd(36)} add=${u.toSet.length} already=${u.alreadyPresent.length}`
      + (u.toSet.length ? '  ' + u.toSet.map((t) => `v${t.visitIndex + 1}(${t.month})=${t.completedDate}`).join(' ') : '')));
  }
  if (plan.creates.length) {
    console.log(`\n-- contracts to create: ${plan.creates.length} --`);
    plan.creates.slice(0, 5).forEach((c) => console.log(
      `  R${c.row} ${String(c.site).slice(0, 34).padEnd(36)} ${c.contract.category}/${c.contract.amcType} `
      + `${c.contract.start}..${c.contract.end || '(blank)'}  completions=${c.completions.length}`));
    if (plan.creates.length > 5) console.log(`  … and ${plan.creates.length - 5} more`);
  }

  if (!COMMIT) {
    console.log('\nDry run only — nothing was written. Re-run with --commit to apply.\n');
    await mongoose.connection.close();
    return;
  }

  let created = 0; let stamped = 0; let failed = 0;
  const lateConflicts = [];

  for (const c of plan.creates) {
    try {
      const made = await contractService.createManualContract({
        site: c.contract.site, customer: c.contract.customer, phone: c.contract.phone,
        email: c.contract.email, capacity: c.contract.capacity,
        start: c.contract.start, end: c.contract.end,
        amcType: c.contract.amcType, category: c.contract.category, amount: c.contract.amount,
      }, actorAuth, repos);
      created += 1;
      const id = made.id || made._id;
      const visits = made.scheduledVisits || [];
      for (const comp of c.completions) {
        const i = comp.slot - 1;
        if (i < 0 || i >= visits.length) {
          lateConflicts.push(`R${c.row} ${c.site}: service ${comp.slot} completed ${comp.completedDate}, `
            + `but the generated schedule has ${visits.length} visits — not stored`);
          continue;
        }
        await repos.contractRepo.setVisitCompleted(companyId, id, i, new Date(comp.completedDate));
        stamped += 1;
      }
      console.log(`  + R${c.row} ${c.site} -> ${id} (${c.completions.length} completion(s))`);
    } catch (err) {
      failed += 1;
      console.log(`  ! R${c.row} ${c.site} FAILED: ${err.message}`);
    }
  }

  for (const u of plan.updates) {
    for (const t of u.toSet) {
      try {
        await repos.contractRepo.setVisitCompleted(companyId, u.contractId, t.visitIndex, new Date(t.completedDate));
        stamped += 1;
      } catch (err) {
        failed += 1;
        console.log(`  ! R${u.row} ${u.site} visit ${t.visitIndex + 1} FAILED: ${err.message}`);
      }
    }
    if (u.toSet.length) console.log(`  ~ R${u.row} ${u.site} -> ${u.toSet.length} completion(s) added`);
  }

  if (lateConflicts.length) {
    console.log('\n-- completions with no matching visit (reported, not stored) --');
    lateConflicts.forEach((l) => console.log('  ' + l));
  }

  console.log(`\nSUMMARY  contracts created: ${created}   completions stamped: ${stamped}`
    + `   failed: ${failed}   conflicts: ${plan.conflicts.length + lateConflicts.length}`
    + `   skipped rows: ${plan.skipped.length}`);
  console.log('Done.\n');
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('\nERROR:', err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
