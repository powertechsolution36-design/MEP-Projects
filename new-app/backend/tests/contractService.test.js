'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/contractService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin One', ...overrides };
}

function baseProject(overrides) {
  return {
    id: 'proj1',
    companyId: 'co1',
    division: 'HVAC',
    name: 'Tower Chiller Plant',
    customer: 'Ravi Kumar',
    capacity: '20 TR',
    status: 'Completed',
    ...overrides,
  };
}

function baseContract(overrides) {
  return {
    id: 'c1',
    companyId: 'co1',
    customer: 'Ravi Kumar',
    phone: '9000000001',
    email: 'ravi@example.com',
    site: 'Tower Chiller Plant',
    capacity: '20 TR',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    amcType: 'Quarterly',
    category: 'AMC',
    amount: 5000,
    scheduledVisits: [
      { month: '2026-01', completedDate: null },
      { month: '2026-04', completedDate: null },
      { month: '2026-07', completedDate: null },
      { month: '2026-10', completedDate: null },
    ],
    originatingProjectId: null,
    ...overrides,
  };
}

/* ================= pure algorithm checks ================= */

test('generateScheduledVisits — Monthly=12 visits/1mo, Half-Yearly=2 visits/6mo, Quarterly=4 visits/3mo', () => {
  const start = new Date('2026-01-01');
  const monthly = service.generateScheduledVisits(start, 'Monthly');
  assert.equal(monthly.length, 12);
  assert.deepEqual(monthly.map((v) => v.month), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
  ]);
  monthly.forEach((v) => assert.equal(v.completedDate, null));

  const halfYearly = service.generateScheduledVisits(start, 'Half-Yearly');
  assert.equal(halfYearly.length, 2);
  assert.deepEqual(halfYearly.map((v) => v.month), ['2026-01', '2026-07']);

  const quarterly = service.generateScheduledVisits(start, 'Quarterly');
  assert.equal(quarterly.length, 4);
  assert.deepEqual(quarterly.map((v) => v.month), ['2026-01', '2026-04', '2026-07', '2026-10']);

  // unrecognized amcType falls back to Quarterly's 4/3mo, matching the PWA's own ternary-chain fallback
  const fallback = service.generateScheduledVisits(start, 'Something-Else');
  assert.equal(fallback.length, 4);
  assert.deepEqual(fallback.map((v) => v.month), ['2026-01', '2026-04', '2026-07', '2026-10']);
});

test('generateScheduledVisits — visits rolling across a year boundary (e.g. Nov start, Quarterly)', () => {
  const visits = service.generateScheduledVisits(new Date('2025-11-15'), 'Quarterly');
  assert.deepEqual(visits.map((v) => v.month), ['2025-11', '2026-02', '2026-05', '2026-08']);
});

test('computeOneYearWarrantyEndDate — start+1yr-1day inclusive rule (2026-01-01 -> 2026-12-31, not 2027-01-01)', () => {
  const end = service.computeOneYearWarrantyEndDate(new Date('2026-01-01'));
  assert.equal(end.toISOString().slice(0, 10), '2026-12-31');
});

test('computeContractStatus — Expired / Expiring Soon (45-day threshold) / Active', () => {
  const refDate = new Date('2026-06-01T00:00:00Z');
  assert.equal(service.computeContractStatus(baseContract({ endDate: new Date('2026-05-31') }), refDate), 'Expired');
  // end - 45 days = 2026-06-01 exactly the ref date -> Expiring Soon (>= threshold)
  assert.equal(service.computeContractStatus(baseContract({ endDate: new Date('2026-07-16') }), refDate), 'Expiring Soon');
  assert.equal(service.computeContractStatus(baseContract({ endDate: new Date('2026-12-31') }), refDate), 'Active');
});

test('computeContractStatus — null endDate (blank manual `end`) reads as Expired unconditionally (Decision 8)', () => {
  assert.equal(service.computeContractStatus(baseContract({ endDate: null })), 'Expired');
});

test('computePmDueIndexes — not done AND month <= current month; completed visits excluded; future visits never due', () => {
  const refDate = new Date('2026-07-15T00:00:00Z');
  const contract = baseContract({
    scheduledVisits: [
      { month: '2026-01', completedDate: new Date('2026-01-10') }, // done -> never due again
      { month: '2026-04', completedDate: null }, // past, not done -> due (overdue)
      { month: '2026-07', completedDate: null }, // current month, not done -> due
      { month: '2026-10', completedDate: null }, // future -> never due
    ],
  });
  assert.deepEqual(service.computePmDueIndexes(contract, refDate), [1, 2]);
});

test('computePmDueIndexes — Expired contract still surfaces overdue visits (Decision 11, DO NOT FIX)', () => {
  const refDate = new Date('2026-07-15T00:00:00Z');
  const contract = baseContract({
    endDate: new Date('2026-02-01'), // already Expired at refDate
    scheduledVisits: [{ month: '2026-01', completedDate: null }],
  });
  assert.equal(service.computeContractStatus(contract, refDate), 'Expired');
  assert.deepEqual(service.computePmDueIndexes(contract, refDate), [0]);
});

/* ================= Project -> Warranty Contract conversion ================= */

test('convertProjectToContract — eligible conversion produces exact Warranty values, blank contact, amount=0, 4 quarterly visits, Project -> In Service, notification, no Payment/ServiceCall', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  const contract = await service.convertProjectToContract('proj1', auth({ role: 'service_mgr' }), store);

  assert.equal(contract.category, 'Warranty');
  assert.equal(contract.amount, 0);
  assert.equal(contract.amcType, 'Quarterly');
  assert.equal(contract.phone, '');
  assert.equal(contract.email, '');
  assert.equal(contract.customer, 'Ravi Kumar');
  assert.equal(contract.site, 'Tower Chiller Plant');
  assert.equal(contract.capacity, '20 TR');
  assert.equal(contract.originatingProjectId, 'proj1');
  assert.equal(contract.scheduledVisits.length, 4);

  const expectedEnd = service.computeOneYearWarrantyEndDate(contract.startDate);
  assert.equal(new Date(contract.endDate).toISOString().slice(0, 10), expectedEnd.toISOString().slice(0, 10));

  const project = await store.projectRepo.findById('co1', 'proj1');
  assert.equal(project.status, 'In Service');

  assert.equal(store.state.notifications.length, 1);
  assert.deepEqual(store.state.notifications[0].targetRoles, ['service_mgr', 'admin']);
  assert.match(store.state.notifications[0].text, /Commissioning approved: "Tower Chiller Plant" converted to Service project — 1 year warranty, quarterly PM scheduled\./);

  assert.equal(store.state.payments.length, 0); // Decision 1: never a Payment
  // No ServiceCall collection exists in this fake store at all -- confirms no ServiceCall side effect is even attempted.
  assert.equal(store.state.svcCalls, undefined);
});

test('convertProjectToContract — ineligible project (not Completed, or division MEP) is rejected', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ status: 'Ongoing' })] });
  await assert.rejects(
    () => service.convertProjectToContract('proj1', auth({ role: 'admin' }), store),
    (err) => err.code === 'NOT_ELIGIBLE'
  );

  const store2 = createEnquiryFakeStore({ projects: [baseProject({ division: 'MEP' })] });
  await assert.rejects(
    () => service.convertProjectToContract('proj1', auth({ role: 'admin' }), store2),
    (err) => err.code === 'NOT_ELIGIBLE'
  );
});

test('convertProjectToContract — role gate: only service_mgr/admin may convert (Decision 6/10)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  await assert.rejects(
    () => service.convertProjectToContract('proj1', auth({ role: 'engineer' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('convertProjectToContract — duplicate conversion is NOT blocked (Decision 9): no "already has a Contract" uniqueness guard exists — converting the same eligible project twice (e.g. re-marked Completed by an admin between conversions, exactly as Decision 10\'s eligibility re-check requires) produces two independent Contracts, never a DUPLICATE_CONVERSION-style rejection', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  const first = await service.convertProjectToContract('proj1', auth({ role: 'admin' }), store);
  // Decision 10's eligibility re-check reuses the PWA's own UI-visible condition
  // (status==="Completed"), and conversion itself always flips status to "In
  // Service" -- so a genuine second conversion requires the project to be
  // eligible again (e.g. re-marked Completed), simulated here directly. The
  // point under test is that NO uniqueness/"already converted" guard exists
  // beyond that shared eligibility condition (Decision 9) -- unlike Enquiry's
  // deliberately-added Won-transition guard (OPEN_DECISIONS.md #19), which
  // this module explicitly does NOT mirror.
  await store.projectRepo.update('co1', 'proj1', { status: 'Completed' });
  const second = await service.convertProjectToContract('proj1', auth({ role: 'admin' }), store);
  assert.notEqual(first.id, second.id);
  const all = await store.contractRepo.listByCompany('co1');
  assert.equal(all.length, 2);
  assert.ok(all.every((c) => c.originatingProjectId === 'proj1'));
});

/* ================= Manual AMC creation ================= */

test('createManualContract — exact fields, defaults (start=today, amcType=Quarterly, category=AMC, amount=0), schedule from own start, no notification, no Payment', async () => {
  const store = createEnquiryFakeStore();
  const contract = await service.createManualContract(
    { site: 'Warehouse 3', customer: 'Deepa', phone: '900', email: 'd@x.com', capacity: '5 TR', start: '2026-02-01', amcType: 'Monthly', category: 'Warranty', amount: 12000 },
    auth({ role: 'service_mgr' }),
    store
  );
  assert.equal(contract.site, 'Warehouse 3');
  assert.equal(contract.customer, 'Deepa');
  assert.equal(contract.amcType, 'Monthly');
  assert.equal(contract.category, 'Warranty'); // label-only, Decision 15 -- no behavioral difference tested elsewhere
  assert.equal(contract.amount, 12000);
  assert.equal(contract.scheduledVisits.length, 12);
  assert.equal(contract.scheduledVisits[0].month, '2026-02');
  assert.equal(contract.originatingProjectId, null);
  assert.equal(store.state.notifications.length, 0); // Decision 7: manual creation never notifies
  assert.equal(store.state.payments.length, 0); // Decision 1
});

test('createManualContract — defaults: no start given -> today; no amcType/category -> Quarterly/AMC; non-numeric amount -> 0', async () => {
  const store = createEnquiryFakeStore();
  const contract = await service.createManualContract({ site: 'Site X' }, auth({ role: 'admin' }), store);
  assert.equal(contract.amcType, 'Quarterly');
  assert.equal(contract.category, 'AMC');
  assert.equal(contract.amount, 0);
  assert.equal(contract.customer, '');
  assert.equal(contract.phone, '');
  assert.equal(contract.email, '');
  assert.equal(contract.scheduledVisits.length, 4);
});

test('createManualContract — blank/omitted `end` is accepted with NO fallback (Decision 8) and reads as Expired', async () => {
  const store = createEnquiryFakeStore();
  const contract = await service.createManualContract({ site: 'Site Y', start: '2026-01-01' }, auth({ role: 'admin' }), store);
  assert.equal(contract.endDate, null);
  assert.equal(service.computeContractStatus(contract), 'Expired');
});

test('createManualContract — site is the ONLY enforced field; blank site is rejected', async () => {
  const store = createEnquiryFakeStore();
  await assert.rejects(
    () => service.createManualContract({ site: '  ' }, auth({ role: 'admin' }), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.createManualContract({}, auth({ role: 'admin' }), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});

test('createManualContract — duplicate manual contracts are NOT blocked (audit §18 #10)', async () => {
  const store = createEnquiryFakeStore();
  const input = { site: 'Same Site', customer: 'Same Customer', start: '2026-01-01' };
  await service.createManualContract(input, auth({ role: 'admin' }), store);
  await service.createManualContract(input, auth({ role: 'admin' }), store);
  const all = await store.contractRepo.listByCompany('co1');
  assert.equal(all.length, 2);
});

test('createManualContract — role gate: only admin/service_mgr may create manually (Decision 6)', async () => {
  const store = createEnquiryFakeStore();
  await assert.rejects(
    () => service.createManualContract({ site: 'X' }, auth({ role: 'sales' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

/* ================= Search / list ================= */

test('listContracts — ten-field substring search, case-insensitive, no sorting beyond natural (insertion) order', async () => {
  const store = createEnquiryFakeStore({
    contracts: [
      baseContract({ id: 'c1', customer: 'Alpha Corp', site: 'North Site' }),
      baseContract({ id: 'c2', customer: 'Beta LLC', site: 'South Site', phone: '8887776665' }),
    ],
  });
  const all = await service.listContracts(auth({ role: 'engineer' }), {}, store);
  assert.deepEqual(all.map((c) => c.id), ['c1', 'c2']); // natural order, not reversed (unlike Project)

  const byCustomer = await service.listContracts(auth(), { filters: { q: 'beta' } }, store);
  assert.deepEqual(byCustomer.map((c) => c.id), ['c2']);

  const byPhone = await service.listContracts(auth(), { filters: { q: '8887776665' } }, store);
  assert.deepEqual(byPhone.map((c) => c.id), ['c2']);
});

test('listContracts — company-scoped (tenant isolation)', async () => {
  const store = createEnquiryFakeStore({
    contracts: [baseContract({ id: 'c1', companyId: 'co1' }), baseContract({ id: 'c2', companyId: 'co2' })],
  });
  const forCo1 = await service.listContracts(auth({ companyId: 'co1' }), {}, store);
  assert.deepEqual(forCo1.map((c) => c.id), ['c1']);
});

test('listContracts — viewing is NOT role-restricted server-side beyond company membership (PWA FACT §2/§13: view is menu-gated only, not division-scoped)', async () => {
  const store = createEnquiryFakeStore({ contracts: [baseContract()] });
  const asEngineer = await service.listContracts(auth({ role: 'engineer' }), {}, store);
  assert.equal(asEngineer.length, 1);
});

/* ================= Dashboard: PM-Due panel / Renewal-Opportunities ================= */

test('getPmDuePanel — one row per {contract,visitIndex} due pair; a contract with 2 due visits appears twice; Expired contracts included', async () => {
  const refIso = new Date().toISOString().slice(0, 7);
  const store = createEnquiryFakeStore({
    contracts: [
      baseContract({
        id: 'c1',
        endDate: new Date('2020-01-01'), // long Expired
        scheduledVisits: [
          { month: '2020-01', completedDate: null },
          { month: '2020-04', completedDate: null },
        ],
      }),
      baseContract({ id: 'c2', scheduledVisits: [{ month: `${refIso}`, completedDate: null }] }),
    ],
  });
  const rows = await service.getPmDuePanel(auth({ role: 'engineer' }), store);
  const c1Rows = rows.filter((r) => r.contractId === 'c1');
  assert.equal(c1Rows.length, 2); // both overdue visits surfaced despite Expired status
  const c2Rows = rows.filter((r) => r.contractId === 'c2');
  assert.equal(c2Rows.length, 1);
  assert.equal(c2Rows[0].overdue, false); // current month, due but not "(overdue)"
});

test('getRenewalOpportunities — every contract whose status is not Active, purely informational', async () => {
  const store = createEnquiryFakeStore({
    contracts: [
      baseContract({ id: 'active', endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }),
      baseContract({ id: 'expired', endDate: new Date('2000-01-01') }),
    ],
  });
  const rows = await service.getRenewalOpportunities(auth(), store);
  assert.deepEqual(rows.map((r) => r.contract.id), ['expired']);
  assert.equal(rows[0].status, 'Expired');
});

/* ================= Reports / CSV export ================= */

/* The header gained one column on 23 Nov 2026 — "Other Sites" — when one
   AMC became able to cover more than one address. The visit columns remain
   the first site's, and the 4-slot truncation is unchanged. */
test('exportContractsCsv — exact header, 4-visit-slot truncation for Monthly (Decision 5), exact totals row', async () => {
  const store = createEnquiryFakeStore({
    contracts: [
      baseContract({
        id: 'c1', amount: 1000,
        scheduledVisits: [
          { month: '2026-01', completedDate: new Date('2026-01-05') },
          { month: '2026-02', completedDate: null },
          { month: '2026-03', completedDate: null },
          { month: '2026-04', completedDate: null },
          { month: '2026-05', completedDate: null }, // 5th visit -- must be truncated from CSV
          { month: '2026-06', completedDate: null },
        ],
      }),
    ],
  });
  const csv = await service.exportContractsCsv(auth({ role: 'admin' }), {}, store);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'AMC / Warranty & PM Report');
  assert.equal(
    lines[1],
    'Customer,Phone,Email,Site,Capacity,Category,AMC Type,Amount,Start,End,Status,PM Due Now,1st Due,1st Done,2nd Due,2nd Done,3rd Due,3rd Done,4th Due,4th Done,Other Sites'
  );
  assert.ok(!csv.includes('2026-05'), 'the 5th scheduled visit must never appear in the CSV export');
  assert.ok(!csv.includes('2026-06'), 'the 6th scheduled visit must never appear in the CSV export');
  const totalLine = lines[lines.length - 1];
  assert.match(totalLine, /^TOTAL,1 contracts,,,,,,1000,,,,\d+ PM due\/overdue$/);
});

test('exportContractsCsv — role gate: only admin/service_mgr may export (Decision 6)', async () => {
  const store = createEnquiryFakeStore({ contracts: [baseContract()] });
  await assert.rejects(
    () => service.exportContractsCsv(auth({ role: 'engineer' }), {}, store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('exportContractsCsv — respects the current search filter (company-scoped + search-text-scoped, not the whole company list)', async () => {
  const store = createEnquiryFakeStore({
    contracts: [baseContract({ id: 'c1', customer: 'Match Me' }), baseContract({ id: 'c2', customer: 'Skip Me' })],
  });
  const csv = await service.exportContractsCsv(auth({ role: 'admin' }), { filters: { q: 'match' } }, store);
  assert.ok(csv.includes('Match Me'));
  assert.ok(!csv.includes('Skip Me'));
  assert.match(csv, /TOTAL,1 contracts/);
});

/* ================= ServiceCall-facing boundary: PM visit completion ================= */

test('completePmVisitForContract — stamps the FIRST currently-due index, recomputed fresh (Decision 4, the single most important DO NOT FIX)', async () => {
  const store = createEnquiryFakeStore({
    contracts: [
      baseContract({
        id: 'c1',
        scheduledVisits: [
          { month: '2020-01', completedDate: null }, // both overdue -- index 0 is "first due"
          { month: '2020-04', completedDate: null },
        ],
      }),
    ],
  });
  const updated = await service.completePmVisitForContract('c1', auth({ role: 'service_mgr' }), store);
  assert.ok(updated.scheduledVisits[0].completedDate);
  assert.equal(updated.scheduledVisits[1].completedDate, null);
});

test('completePmVisitForContract — no-op when nothing is due', async () => {
  const store = createEnquiryFakeStore({
    contracts: [baseContract({ id: 'c1', scheduledVisits: [{ month: '2099-01', completedDate: null }] })],
  });
  const result = await service.completePmVisitForContract('c1', auth({ role: 'admin' }), store);
  assert.equal(result.scheduledVisits[0].completedDate, null);
});

test('completePmVisitForContract — role gate: assigned engineer OR admin/service_mgr (Decision 6, mirroring vCall()\'s isEng/isMgr gate)', async () => {
  const store = createEnquiryFakeStore({
    contracts: [baseContract({ id: 'c1', scheduledVisits: [{ month: '2020-01', completedDate: null }] })],
  });
  await assert.rejects(
    () => service.completePmVisitForContract('c1', auth({ role: 'engineer', userId: 'eng1' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const asAssignedEngineer = await service.completePmVisitForContract(
    'c1', auth({ role: 'engineer', userId: 'eng1' }), store, { assignedEngineerUserId: 'eng1' }
  );
  assert.ok(asAssignedEngineer.scheduledVisits[0].completedDate);
});

/* ================= Contract <-> Payment / ServiceCall boundary sanity ================= */

test('Contract module never creates a Payment or a ServiceCall record, anywhere (Decision 1 / Decision 12)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  await service.convertProjectToContract('proj1', auth({ role: 'admin' }), store);
  await service.createManualContract({ site: 'S', amount: 99999 }, auth({ role: 'admin' }), store);
  assert.equal(store.state.payments.length, 0);
  assert.equal(store.state.svcCalls, undefined); // this fake store has no ServiceCall concept at all
});

test('Contract can be edited but never deleted (Decisions 2-3, narrowed 29 Oct 2026)', () => {
  // Owner decision (29 Oct 2026): editing a client's AMC details is now
  // supported, so editContract is exported deliberately. The rest of the
  // decision stands — there is still no way to delete a Contract, because
  // that would take its service history with it.
  assert.equal(typeof service.editContract, 'function');
  assert.equal(service.updateContract, undefined);
  assert.equal(service.deleteContract, undefined);
  assert.equal(service.removeContract, undefined);
});

/* ================= Tenant isolation ================= */

test('getContract / completePmVisitForContract — cross-company access is rejected (tenant isolation)', async () => {
  const store = createEnquiryFakeStore({ contracts: [baseContract({ id: 'c1', companyId: 'co1' })] });
  await assert.rejects(
    () => service.getContract('c1', auth({ companyId: 'co2' }), store),
    (err) => err.code === 'NOT_FOUND'
  );
  await assert.rejects(
    () => service.completePmVisitForContract('c1', auth({ companyId: 'co2', role: 'admin' }), store),
    (err) => err.code === 'NOT_FOUND'
  );
});

/* ------------------------------------------------------------------ *
 * Owner request (29 Oct 2026): editing a client's AMC details, and
 * correcting one PM visit's completed date.
 * ------------------------------------------------------------------ */

function editableContract(over) {
  return baseContract({
    id: 'ec1', customer: 'Old Name', phone: '900', email: '', site: 'Old Site',
    capacity: '12', amcType: 'Quarterly', category: 'AMC', amount: 1000,
    startDate: '2026-01-01', endDate: '2026-12-31',
    scheduledVisits: [
      { month: '2026-01', completedDate: new Date('2026-01-20') },
      { month: '2026-04', completedDate: null },
      { month: '2026-07', completedDate: null },
      { month: '2026-10', completedDate: null },
    ],
    ...over,
  });
}

test('editContract — changes the client details and leaves the visit history alone', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  const out = await service.editContract('ec1', {
    customer: 'New Name', phone: '9820011223', amount: 2500, category: 'Warranty',
  }, auth(), store);

  assert.equal(out.customer, 'New Name');
  assert.equal(out.phone, '9820011223');
  assert.equal(out.amount, 2500);
  assert.equal(out.category, 'Warranty');
  assert.equal(out.scheduledVisits.length, 4);
  assert.equal(new Date(out.scheduledVisits[0].completedDate).toISOString().slice(0, 10), '2026-01-20',
    'a recorded completion must survive an edit');
});

test('editContract — changing the start date or frequency does NOT regenerate the schedule', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  const out = await service.editContract('ec1',
    { startDate: '2027-05-01', amcType: 'Monthly' }, auth(), store);

  assert.equal(new Date(out.startDate).toISOString().slice(0, 10), '2027-05-01');
  assert.equal(out.amcType, 'Monthly');
  assert.equal(out.scheduledVisits.length, 4, 'the existing schedule stands — regenerating would delete history');
  assert.ok(out.scheduledVisits[0].completedDate);
});

test('editContract — a blank end date is allowed; rubbish is refused', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  const cleared = await service.editContract('ec1', { endDate: '' }, auth(), store);
  assert.equal(cleared.endDate, null);

  await assert.rejects(
    () => service.editContract('ec1', { endDate: 'not-a-date' }, auth(), store),
    (e) => e.code === 'VALIDATION_ERROR' && e.status === 400
  );
});

test('editContract — refuses an out-of-list cover, frequency, amount or empty site', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  for (const bad of [{ category: 'Gold' }, { amcType: 'Weekly' }, { amount: -5 }, { site: '  ' }]) {
    await assert.rejects(
      () => service.editContract('ec1', bad, auth(), store),
      (e) => e.code === 'VALIDATION_ERROR' && e.status === 400,
      JSON.stringify(bad)
    );
  }
});

test('editContract — role gate and tenant isolation', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  await assert.rejects(
    () => service.editContract('ec1', { customer: 'X' }, auth({ role: 'engineer' }), store),
    (e) => e.code === 'FORBIDDEN' && e.status === 403
  );
  await assert.rejects(
    () => service.editContract('ec1', { customer: 'X' }, auth({ companyId: 'co2' }), store),
    (e) => e.code === 'NOT_FOUND' && e.status === 404
  );
  // companyId can never be moved by an edit
  const out = await service.editContract('ec1', { companyId: 'co2', customer: 'Y' }, auth(), store);
  assert.equal(String(out.companyId), 'co1');
});

test('setVisitCompletedDate — records a historical visit, and can clear it again', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });

  const set = await service.setVisitCompletedDate('ec1', 2, '2026-07-19', auth(), store);
  assert.equal(new Date(set.scheduledVisits[2].completedDate).toISOString().slice(0, 10), '2026-07-19');
  assert.equal(set.scheduledVisits[2].month, '2026-07', 'the scheduled month is not moved to the completion date');

  const cleared = await service.setVisitCompletedDate('ec1', 2, null, auth(), store);
  assert.equal(cleared.scheduledVisits[2].completedDate, null);
});

test('setVisitCompletedDate — a visit that does not exist is 404, rubbish is 400, engineer is 403', async () => {
  const store = createEnquiryFakeStore({ contracts: [editableContract()] });
  await assert.rejects(
    () => service.setVisitCompletedDate('ec1', 9, '2026-07-19', auth(), store),
    (e) => e.code === 'NOT_FOUND' && e.status === 404
  );
  await assert.rejects(
    () => service.setVisitCompletedDate('ec1', 0, 'yesterday', auth(), store),
    (e) => e.code === 'VALIDATION_ERROR' && e.status === 400
  );
  await assert.rejects(
    () => service.setVisitCompletedDate('ec1', 0, '2026-07-19', auth({ role: 'engineer' }), store),
    (e) => e.code === 'FORBIDDEN' && e.status === 403
  );
  await assert.rejects(
    () => service.setVisitCompletedDate('ec1', 0, '2026-07-19', auth({ companyId: 'co2' }), store),
    (e) => e.code === 'NOT_FOUND' && e.status === 404
  );
});

/* ---- Contacts at the client (owner request, 5 Nov 2026) ---------------
   A site has a purchase manager, a maintenance in-charge and an owner. The
   contract's single `phone` is still the client's main number. */

test('createManualContract — keeps several contacts, and fills a blank main number from the first one', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Cool Breeze' }] });
  const withMain = await service.createManualContract(
    {
      site: 'KP87 plant',
      customer: 'Intervalve',
      phone: '9000000010',
      contacts: [
        { name: 'Anil Shah', designation: 'Purchase Manager', phone: '9000000011' },
        { name: '', designation: '', phone: '' },
      ],
    },
    auth(),
    store
  );
  assert.equal(withMain.contacts.length, 1);
  assert.equal(withMain.contacts[0].designation, 'Purchase Manager');
  assert.equal(withMain.phone, '9000000010');

  const noMain = await service.createManualContract(
    { site: 'KP88 plant', contacts: [{ name: 'Vikas Pawar', designation: 'Maintenance', phone: '9000000012' }] },
    auth(),
    store
  );
  assert.equal(noMain.phone, '9000000012');
});

test('createManualContract — a contact with a number but no name is refused', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Cool Breeze' }] });
  await assert.rejects(
    () => service.createManualContract(
      { site: 'Nameless', contacts: [{ name: '', designation: 'Purchase', phone: '9000000013' }] },
      auth(),
      store
    ),
    /Every contact needs a name/
  );
});

test('editContract — contacts can be changed, and leaving them out leaves them alone', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze' }],
    contracts: [baseContract({ contacts: [{ name: 'Anil Shah', designation: 'Owner', phone: '9000000014' }] })],
  });

  const untouched = await service.editContract('c1', { capacity: '25 TR' }, auth(), store);
  assert.equal(untouched.contacts.length, 1);

  const changed = await service.editContract(
    'c1',
    { contacts: [{ name: 'Anil Shah', designation: 'Owner', phone: '9000000014' }, { name: 'Sneha D', designation: 'Accounts', phone: '9000000015' }] },
    auth(),
    store
  );
  assert.equal(changed.contacts.length, 2);
  assert.equal(changed.contacts[1].name, 'Sneha D');
});

test('listContracts — a client is found by the name of whoever we deal with there', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze' }],
    contracts: [baseContract({ contacts: [{ name: 'Rupesh Jadhav', designation: 'Purchase', phone: '9000000016' }] })],
  });
  const found = await service.listContracts(auth(), { filters: { q: 'rupesh' } }, store);
  assert.equal(found.length, 1);
  const none = await service.listContracts(auth(), { filters: { q: 'nobody-by-that-name' } }, store);
  assert.equal(none.length, 0);
});

/* ---- Division on an AMC client (owner request, 14 Nov 2026) -------------
   Every contract says which side of the business it belongs to, and a
   division-confined login — the Solar Manager — sees only its own. */

test('createManualContract — the division is stored, and must be one of the three', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Cool Breeze' }] });
  const solar = await service.createManualContract(
    { site: 'Rooftop array', customer: 'Sunrise', division: 'Solar' },
    auth(),
    store
  );
  assert.equal(solar.division, 'Solar');

  await assert.rejects(
    () => service.createManualContract({ site: 'Bad', division: 'Wind' }, auth(), store),
    /Division must be one of/
  );

  // Left out entirely, the field is left OFF the record — nothing is
  // guessed, and nothing blank is written: '' is not one of the three and
  // the schema refuses it (17 Nov 2026, untaggedClientComplaint.test.js).
  const untagged = await service.createManualContract({ site: 'Old client' }, auth(), store);
  assert.ok(!('division' in untagged) || untagged.division === undefined);
});

test('createManualContract — the Solar Manager registers solar clients, and only solar', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Cool Breeze' }] });
  // Its own division is filled in without being chosen.
  const made = await service.createManualContract({ site: 'Array A' }, auth({ role: 'solar_pm' }), store);
  assert.equal(made.division, 'Solar');

  await assert.rejects(
    () => service.createManualContract({ site: 'Chiller', division: 'HVAC' }, auth({ role: 'solar_pm' }), store),
    /can only register Solar clients/
  );
});

test('listContracts — a division-confined login sees its own; admin may narrow to one', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze' }],
    contracts: [
      baseContract({ id: 'c1', site: 'Array A', division: 'Solar' }),
      baseContract({ id: 'c2', site: 'Chiller plant', division: 'HVAC' }),
      baseContract({ id: 'c3', site: 'Old client' }),
    ],
  });

  const solarEyes = await service.listContracts(auth({ role: 'solar_pm' }), {}, store);
  assert.deepEqual(solarEyes.map((c) => c.id), ['c1']);

  const everything = await service.listContracts(auth(), {}, store);
  assert.equal(everything.length, 3, 'admin sees every client, untagged ones included');

  const narrowed = await service.listContracts(auth(), { filters: { division: 'HVAC' } }, store);
  assert.deepEqual(narrowed.map((c) => c.id), ['c2']);

  // A confined login cannot widen its own view by asking for another division.
  const refused = await service.listContracts(auth({ role: 'solar_pm' }), { filters: { division: 'HVAC' } }, store);
  assert.deepEqual(refused.map((c) => c.id), ['c1']);
});

test('getContract — another division is not found, by id as surely as in the list', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze' }],
    contracts: [baseContract({ id: 'c2', division: 'HVAC' })],
  });
  await assert.rejects(() => service.getContract('c2', auth({ role: 'solar_pm' }), store), /not found/i);
  const asAdmin = await service.getContract('c2', auth(), store);
  assert.equal(asAdmin.id, 'c2');
});

test('editContract — a wrongly tagged client can be corrected', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze' }],
    contracts: [baseContract({ division: 'HVAC' })],
  });
  const fixed = await service.editContract('c1', { division: 'Solar' }, auth(), store);
  assert.equal(fixed.division, 'Solar');
});

/* ===== one AMC over more than one site (owner decision, 23 Nov 2026) =====
   "What if the client has AMC site with 2 different location under 1 AMC —
   example Kapil Agency has a site in Baner and Nana Peth": one contract and
   one amount, with the visits and the machine details held per site. */

test('a contract can cover several sites — one amount, a schedule each', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });

  const made = await service.createManualContract(
    {
      customer: 'Kapil Agency', site: 'Baner', capacity: '12 HP', amount: 60000,
      amcType: 'Quarterly', category: 'AMC', start: '2026-01-01', end: '2026-12-31',
      extraSites: [{ name: 'Nana Peth', capacity: '8 HP', make: 'Daikin' }],
    },
    a,
    store
  );
  assert.equal(made.amount, 60000, 'one AMC, one amount');
  assert.equal(made.site, 'Baner');
  assert.equal(made.extraSites.length, 1);
  assert.equal(made.extraSites[0].name, 'Nana Peth');
  assert.equal(made.extraSites[0].capacity, '8 HP');
  // Each site has a calendar of its own, same term and frequency.
  assert.equal(made.scheduledVisits.length, 4);
  assert.equal(made.extraSites[0].scheduledVisits.length, 4);
  assert.deepEqual(
    made.extraSites[0].scheduledVisits.map((v) => v.month),
    made.scheduledVisits.map((v) => v.month)
  );

  const sites = service.sitesOf(made);
  assert.deepEqual(sites.map((s) => s.name), ['Baner', 'Nana Peth']);
  assert.deepEqual(sites.map((s) => s.index), [0, 1]);
});

test('the PM due list names the site, and a visit is ticked off on that site alone', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });
  const made = await service.createManualContract(
    {
      customer: 'Kapil Agency', site: 'Baner', amcType: 'Quarterly', category: 'AMC',
      start: '2020-01-01', end: '2020-12-31',
      extraSites: [{ name: 'Nana Peth' }],
    },
    a,
    store
  );

  const due = await service.getPmDuePanel(a, store);
  const mine = due.filter((r) => String(r.contractId) === String(made.id));
  assert.equal(mine.length, 8, 'four visits overdue at each of the two sites');
  assert.deepEqual([...new Set(mine.map((r) => r.site))].sort(), ['Baner', 'Nana Peth']);

  // Tick off the first visit at Nana Peth.
  await service.setVisitCompletedDate(made.id, 0, '2026-11-23', a, store, { siteIndex: 1 });
  const after = await service.getContract(made.id, a, store);
  assert.ok(after.extraSites[0].scheduledVisits[0].completedDate, 'Nana Peth is done');
  assert.equal(after.scheduledVisits[0].completedDate, null, 'Baner is untouched');

  const dueAfter = (await service.getPmDuePanel(a, store))
    .filter((r) => String(r.contractId) === String(made.id));
  assert.equal(dueAfter.length, 7);
  assert.equal(dueAfter.filter((r) => r.site === 'Nana Peth').length, 3);
});

test('completing a PM call ticks off the site the engineer went to', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });
  const made = await service.createManualContract(
    {
      customer: 'Kapil Agency', site: 'Baner', amcType: 'Quarterly', category: 'AMC',
      start: '2020-01-01', end: '2020-12-31',
      extraSites: [{ name: 'Nana Peth' }],
    },
    a,
    store
  );

  await service.completePmVisitForContract(made.id, a, store, { siteName: 'Nana Peth' });
  const after = await service.getContract(made.id, a, store);
  assert.ok(after.extraSites[0].scheduledVisits[0].completedDate, 'the visit was at Nana Peth');
  assert.equal(after.scheduledVisits[0].completedDate, null, 'so Baner is still due');

  // A call with no site named, or at a site this contract does not list,
  // falls to the contract's own site exactly as it always did.
  await service.completePmVisitForContract(made.id, a, store, {});
  const after2 = await service.getContract(made.id, a, store);
  assert.ok(after2.scheduledVisits[0].completedDate);
});

test('editing the sites keeps the visits already recorded against them', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });
  const made = await service.createManualContract(
    {
      customer: 'Kapil Agency', site: 'Baner', amcType: 'Quarterly', category: 'AMC',
      start: '2020-01-01', end: '2020-12-31',
      extraSites: [{ name: 'Nana Peth', capacity: '8 HP' }],
    },
    a,
    store
  );
  await service.setVisitCompletedDate(made.id, 0, '2026-11-23', a, store, { siteIndex: 1 });

  // Correcting the capacity must not throw the service history away.
  const edited = await service.editContract(
    made.id,
    { extraSites: [{ name: 'Nana Peth', capacity: '10 HP', make: 'Toshiba' }] },
    a,
    store
  );
  assert.equal(edited.extraSites[0].capacity, '10 HP');
  assert.equal(edited.extraSites[0].make, 'Toshiba');
  assert.ok(edited.extraSites[0].scheduledVisits[0].completedDate, 'the completed visit survived');

  // Leaving the sites out of an edit leaves them alone.
  const again = await service.editContract(made.id, { capacity: '14 HP' }, a, store);
  assert.equal(again.extraSites.length, 1);
  assert.ok(again.extraSites[0].scheduledVisits[0].completedDate);

  // A third site added later starts with a schedule of its own.
  const three = await service.editContract(
    made.id,
    { extraSites: [{ name: 'Nana Peth', capacity: '10 HP' }, { name: 'Hadapsar' }] },
    a,
    store
  );
  assert.deepEqual(three.extraSites.map((x) => x.name), ['Nana Peth', 'Hadapsar']);
  assert.equal(three.extraSites[1].scheduledVisits.length, 4);
  assert.ok(three.extraSites[0].scheduledVisits[0].completedDate);
});

test('renewing an AMC renews every site, and keeps the period just ended', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });
  const made = await service.createManualContract(
    {
      customer: 'Kapil Agency', site: 'Baner', amcType: 'Quarterly', category: 'AMC',
      start: '2020-01-01', end: '2020-12-31',
      extraSites: [{ name: 'Nana Peth' }],
    },
    a,
    store
  );
  await service.setVisitCompletedDate(made.id, 0, '2020-02-01', a, store, { siteIndex: 1 });

  const renewed = await service.renewContract(
    made.id, { startDate: '2021-01-01', endDate: '2021-12-31' }, a, store
  );
  assert.equal(renewed.extraSites.length, 1);
  assert.equal(renewed.extraSites[0].scheduledVisits.length, 4);
  assert.equal(renewed.extraSites[0].scheduledVisits[0].completedDate, null, 'a fresh year');
  // The year just ended is kept, both sites of it.
  const archived = renewed.renewals[renewed.renewals.length - 1];
  assert.equal(archived.siteVisits.length, 1);
  assert.ok(archived.siteVisits[0][0].completedDate, 'Nana Peth’s completed visit is in the history');
});

/*
 * Owner, 23 Nov 2026: "Nana peth is Address not Site, it is a place in
 * Pune." The site is the firm; the address is where it is, and it is what
 * tells two AMC records of the same firm apart.
 */
test('an AMC record keeps the address the site is at, and it can be corrected', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const a = auth({ role: 'admin' });

  const baner = await service.createManualContract(
    {
      customer: 'Rohit Gupta', site: 'Kapil Agencies Moto Central', address: 'Baner',
      amcType: 'Quarterly', category: 'AMC', amount: 46079,
      start: '2026-07-09', end: '2027-07-08',
    },
    a,
    store
  );
  const nanaPeth = await service.createManualContract(
    {
      customer: 'Rohit Gupta', site: 'Kapil Agencies Moto Central', address: 'Nana Peth',
      amcType: 'Quarterly', category: 'AMC', amount: 46079,
      start: '2026-07-09', end: '2027-07-08',
    },
    a,
    store
  );
  assert.equal(baner.address, 'Baner');
  assert.equal(nanaPeth.address, 'Nana Peth');
  // Two records of the same firm, told apart by where they are.
  assert.equal(baner.site, nanaPeth.site);
  assert.notEqual(String(baner.id), String(nanaPeth.id));

  const fixed = await service.editContract(baner.id, { address: 'Baner, Pune 411045' }, a, store);
  assert.equal(fixed.address, 'Baner, Pune 411045');
  assert.equal(fixed.site, 'Kapil Agencies Moto Central', 'the firm is untouched');
});
