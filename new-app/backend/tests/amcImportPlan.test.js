'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { planAmcImport } = require('../scripts/amcImportPlan');
const DATA = require('../scripts/amc-tracker-data.json');

/* A quarterly schedule as contractService.generateScheduledVisits builds it. */
function visits(months, completed = {}) {
  return months.map((m, i) => ({ month: m, completedDate: completed[i] || null }));
}
function contract(over) {
  return {
    id: 'c1', companyId: 'co1', site: 'BMH Technologies', customer: 'Vivek Jagtap',
    startDate: '2025-12-04', endDate: '2026-12-03', amcType: 'Quarterly', category: 'AMC',
    scheduledVisits: visits(['2025-12', '2026-03', '2026-06', '2026-09']), ...over,
  };
}
function row(over) {
  return {
    sheet: 'AMC', row: 5, srNo: '4', site: 'BMH Technologies', customer: 'Vivek Jagtap',
    phone: '94204 82495', email: '', capacity: '12', start: '2025-12-04', end: '2026-12-03',
    amcType: 'Quarterly', category: 'AMC', amount: 38000, importable: true, missingRequired: [],
    services: [
      { slot: 1, scheduledMonthName: 'December', completedDate: '2025-12-23' },
      { slot: 2, scheduledMonthName: 'March', completedDate: null },
      { slot: 3, scheduledMonthName: 'June', completedDate: '2026-07-02' },
      { slot: 4, scheduledMonthName: 'September', completedDate: null },
    ], ...over,
  };
}

/* 1 ------------------------------------------------------------------ */
test('a populated service date becomes historical completion data on an existing contract', () => {
  const p = planAmcImport([row()], [contract()]);
  assert.equal(p.updates.length, 1);
  assert.deepEqual(p.updates[0].toSet, [
    { slot: 1, visitIndex: 0, month: '2025-12', completedDate: '2025-12-23' },
    { slot: 3, visitIndex: 2, month: '2026-06', completedDate: '2026-07-02' },
  ]);
  assert.equal(p.conflicts.length, 0);
});

test('a populated service date is carried onto a contract that has to be created', () => {
  const p = planAmcImport([row()], []);
  assert.equal(p.creates.length, 1);
  assert.deepEqual(p.creates[0].completions,
    [{ slot: 1, completedDate: '2025-12-23' }, { slot: 3, completedDate: '2026-07-02' }]);
});

/* 2 ------------------------------------------------------------------ */
test('a blank service cell never creates a completed visit', () => {
  const p = planAmcImport([row()], [contract()]);
  const touched = p.updates[0].toSet.map((t) => t.slot);
  assert.ok(!touched.includes(2) && !touched.includes(4), 'blank slots 2 and 4 must be left alone');

  const allBlank = row({ services: [{ slot: 1, scheduledMonthName: 'December', completedDate: null }] });
  const p2 = planAmcImport([allBlank], [contract()]);
  assert.equal(p2.updates.length, 0);
  assert.equal(p2.totals.completionsToAdd, 0);
});

/* 3 ------------------------------------------------------------------ */
test('a completion date is history, never a due date: the visit keeps its own scheduled month', () => {
  // Service 3 was completed 2026-07-02 but the visit is scheduled for 2026-06.
  const p = planAmcImport([row()], [contract()]);
  const third = p.updates[0].toSet.find((t) => t.slot === 3);
  assert.equal(third.month, '2026-06', 'the schedule month must not be moved to the completion date');
  assert.equal(third.completedDate, '2026-07-02');
});

/* 4 ------------------------------------------------------------------ */
test('re-running duplicates nothing: no creates, and no completion written twice', () => {
  const first = planAmcImport([row()], []);
  assert.equal(first.creates.length, 1);

  // The contract now exists with those completions applied.
  const applied = contract({ scheduledVisits: visits(
    ['2025-12', '2026-03', '2026-06', '2026-09'], { 0: '2025-12-23', 2: '2026-07-02' }) });
  const second = planAmcImport([row()], [applied]);
  assert.equal(second.creates.length, 0, 'no duplicate contract');
  assert.equal(second.totals.completionsToAdd, 0, 'no duplicate completion');
  assert.equal(second.updates[0].alreadyPresent.length, 2);
  assert.equal(second.conflicts.length, 0);
});

/* 5 ------------------------------------------------------------------ */
test('an existing completed visit is reported, never overwritten', () => {
  const edited = contract({ scheduledVisits: visits(
    ['2025-12', '2026-03', '2026-06', '2026-09'], { 0: '2025-12-30' }) }); // genuinely recorded, differs
  const p = planAmcImport([row()], [edited]);
  const clash = p.conflicts.find((c) => c.kind === 'COMPLETION_DIFFERS');
  assert.ok(clash, 'the difference must be reported');
  assert.equal(clash.stored, '2025-12-30');
  assert.equal(clash.workbook, '2025-12-23');
  assert.ok(!p.updates[0].toSet.some((t) => t.visitIndex === 0), 'slot 1 must not be rewritten');
});

/* 6 ------------------------------------------------------------------ */
test('an ambiguous match is reported and nothing is changed', () => {
  const twin = [contract({ id: 'c1' }), contract({ id: 'c2' })];
  const p = planAmcImport([row()], twin);
  assert.equal(p.updates.length, 0);
  assert.equal(p.creates.length, 0);
  const amb = p.conflicts.find((c) => c.kind === 'AMBIGUOUS_MATCH');
  assert.ok(amb);
  assert.deepEqual(amb.contractIds, ['c1', 'c2']);
});

test('a completion with no matching visit is reported, not squeezed into a free slot', () => {
  const sixth = row({ services: [{ slot: 6, scheduledMonthName: '', completedDate: '2026-07-16' }] });
  const p = planAmcImport([sixth], [contract()]);
  const c = p.conflicts.find((x) => x.kind === 'NO_VISIT_FOR_SLOT');
  assert.ok(c, 'slot 6 against a 4-visit schedule must be reported');
  assert.equal(c.completedDate, '2026-07-16');
  assert.equal(p.totals.completionsToAdd, 0);
});

/* 7 ------------------------------------------------------------------ */
test('tenant isolation: a same-site contract in another company is never matched', () => {
  const otherCompany = contract({ id: 'other', companyId: 'co2' });
  // The script passes only this company's contracts; an empty list is what
  // company co1 sees, so the row is a create, not an update of co2's record.
  const p = planAmcImport([row()], []);
  assert.equal(p.creates.length, 1);
  assert.ok(!JSON.stringify(p).includes(otherCompany.id), "another company's contract must not appear in the plan");
});

/* 8 — the real workbook ---------------------------------------------- */
test('the real workbook: every completion date is accounted for, none invented', () => {
  const recs = DATA.records;
  const inSource = recs.reduce((n, r) => n + r.services.filter((s) => s.completedDate).length, 0);
  assert.equal(inSource, 96, 'the workbook holds 96 completion dates');

  const p = planAmcImport(recs, []); // nothing imported yet
  const planned = p.totals.completionsOnCreate;
  const skippedCompletions = p.skipped.reduce((n, s) => n + s.completionsInSource, 0);
  assert.equal(planned + skippedCompletions, inSource,
    'every completion is either planned or explicitly reported as skipped');

  // Nothing invented: every planned date exists in the workbook.
  const sourceDates = new Set();
  recs.forEach((r) => r.services.forEach((s) => s.completedDate && sourceDates.add(s.completedDate)));
  p.creates.forEach((c) => c.completions.forEach((x) => assert.ok(sourceDates.has(x.completedDate))));
});

/* ------------------------------------------------------------------ *
 * End to end against the in-memory store: the same calls the script
 * makes (createManualContract + contractRepo.setVisitCompleted).
 * ------------------------------------------------------------------ */

const { createEnquiryFakeStore } = require('./enquiryFakes');
const contractService = require('../src/services/contractService');

const auth = { userId: null, companyId: 'co1', role: 'admin' };

/** Mirrors the apply loop in scripts/import-amc-tracker.js. */
async function applyPlan(plan, store) {
  let stamped = 0; const unstorable = [];
  for (const c of plan.creates) {
    const made = await contractService.createManualContract({
      site: c.contract.site, customer: c.contract.customer, phone: c.contract.phone,
      email: c.contract.email, capacity: c.contract.capacity,
      start: c.contract.start, end: c.contract.end,
      amcType: c.contract.amcType, category: c.contract.category, amount: c.contract.amount,
    }, auth, store);
    const visits = made.scheduledVisits || [];
    for (const comp of c.completions) {
      const i = comp.slot - 1;
      if (i < 0 || i >= visits.length) { unstorable.push({ row: c.row, slot: comp.slot }); continue; }
      await store.contractRepo.setVisitCompleted('co1', made.id, i, new Date(comp.completedDate));
      stamped += 1;
    }
  }
  for (const u of plan.updates) {
    for (const t of u.toSet) {
      await store.contractRepo.setVisitCompleted('co1', u.contractId, t.visitIndex, new Date(t.completedDate));
      stamped += 1;
    }
  }
  return { stamped, unstorable };
}

test('end to end: the whole workbook imports, completions land on the schedule, nothing is invented', async () => {
  const store = createEnquiryFakeStore({});
  const recs = DATA.records;

  const plan1 = planAmcImport(recs, await store.contractRepo.listByCompany('co1'));
  const r1 = await applyPlan(plan1, store);

  const after = await store.contractRepo.listByCompany('co1');
  assert.equal(after.length, 56, '56 importable rows become 56 contracts');

  const stored = [];
  after.forEach((c) => (c.scheduledVisits || []).forEach((v) => v.completedDate
    && stored.push(new Date(v.completedDate).toISOString().slice(0, 10))));
  assert.equal(stored.length, r1.stamped);

  // Every stored date really is in the workbook.
  const sourceDates = new Set();
  recs.forEach((r) => r.services.forEach((s) => s.completedDate && sourceDates.add(s.completedDate)));
  stored.forEach((d) => assert.ok(sourceDates.has(d), `${d} must come from the workbook`));

  // 96 in the sheet = stored + inside skipped rows + any slot with no visit.
  const inSkipped = plan1.skipped.reduce((n, s) => n + s.completionsInSource, 0);
  assert.equal(stored.length + inSkipped + r1.unstorable.length, 96,
    'every completion is stored, skipped with its row, or reported as unstorable');
  assert.deepEqual(r1.unstorable, [{ row: 50, slot: 6 }],
    'only Swasthya\'s 6th service has no visit on a 4-visit quarterly schedule');

  /* ---- run it a second time: nothing should change ---- */
  const plan2 = planAmcImport(recs, await store.contractRepo.listByCompany('co1'));
  assert.equal(plan2.creates.length, 0, 'no duplicate contracts on a re-run');
  assert.equal(plan2.totals.completionsToAdd, 0, 'no completion written twice');
  assert.equal(plan2.totals.completionsAlreadyPresent, stored.length);
  const r2 = await applyPlan(plan2, store);
  assert.equal(r2.stamped, 0);
  const after2 = await store.contractRepo.listByCompany('co1');
  assert.equal(after2.length, 56, 'still 56 contracts');
});

test('end to end: an engineer-recorded completion survives a later import run', async () => {
  const store = createEnquiryFakeStore({});
  const recs = DATA.records.filter((r) => r.row === 5); // BMH Technologies
  await applyPlan(planAmcImport(recs, []), store);

  const [c] = await store.contractRepo.listByCompany('co1');
  // Staff correct visit 1 by hand afterwards.
  await store.contractRepo.setVisitCompleted('co1', c.id, 0, new Date('2025-12-30'));

  const plan = planAmcImport(recs, await store.contractRepo.listByCompany('co1'));
  const clash = plan.conflicts.find((x) => x.kind === 'COMPLETION_DIFFERS');
  assert.ok(clash, 'the hand-made correction must be reported as a conflict');
  await applyPlan(plan, store);

  const [again] = await store.contractRepo.listByCompany('co1');
  assert.equal(new Date(again.scheduledVisits[0].completedDate).toISOString().slice(0, 10),
    '2025-12-30', 'the correction stands; the workbook does not overwrite it');
});
