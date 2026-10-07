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

test('exportContractsCsv — exact 20-column header, 4-visit-slot truncation for Monthly (Decision 5), exact totals row', async () => {
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
    'Customer,Phone,Email,Site,Capacity,Category,AMC Type,Amount,Start,End,Status,PM Due Now,1st Due,1st Done,2nd Due,2nd Done,3rd Due,3rd Done,4th Due,4th Done'
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

test('Contract has no edit/delete exported function (Decisions 2-3)', () => {
  assert.equal(service.updateContract, undefined);
  assert.equal(service.editContract, undefined);
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
