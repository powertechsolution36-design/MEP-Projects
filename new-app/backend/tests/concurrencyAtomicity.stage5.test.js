'use strict';

/**
 * STAGE 5 -- CONCURRENCY / ATOMICITY VERIFICATION
 *
 * Real concurrent-request tests against the actual, unmodified service
 * layer (src/services/*.js), using ./concurrencyHarness.js's simulated-
 * MongoDB-transaction store (see that file's header for exactly what it
 * does and does not model, and why -- no live mongod is reachable in this
 * environment). Every test below issues genuine `Promise.all([...])`
 * concurrent calls into the service functions; none of them is a
 * code-reading assertion.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAtomicStore } = require('./concurrencyHarness');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const enquiryService = require('../src/services/enquiryService');
const inventoryService = require('../src/services/inventoryService');
const contractService = require('../src/services/contractService');
const serviceCallService = require('../src/services/serviceCallService');
const checklistTemplateService = require('../src/services/checklistTemplateService');
const projectService = require('../src/services/projectService');
const userService = require('../src/services/userService');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin One', ...overrides };
}

/* ============== 1. Enquiry -> SalesOrder ============== */

test('CONCURRENCY: Enquiry->SalesOrder -- two simultaneous conversions of the same Enquiry produce exactly one SalesOrder', async () => {
  const store = createAtomicStore({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'Test Co', segment: 'HVAC', phone: '9', estimatedValue: 1000, status: 'Open', followUpLog: [] }],
    users: [{ id: 'u1', name: 'Sales One', role: 'sales', companyId: 'co1' }],
  });
  const salesAuth = auth({ role: 'sales' });
  const payload = { contacts: [{ name: 'X' }], paymentMilestones: [{ description: 'Advance', amount: 500 }] };

  const results = await Promise.allSettled([
    enquiryService.convertEnquiryToSalesOrder('enq1', payload, salesAuth, store),
    enquiryService.convertEnquiryToSalesOrder('enq1', payload, salesAuth, store),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one conversion must succeed');
  assert.equal(rejected.length, 1, 'exactly one conversion must be rejected');
  // The loser can be rejected either by the outer pre-check (DUPLICATE_CONVERSION,
  // if it re-reads after the winner committed) or by the atomic markWonIfOpen
  // guard inside the transaction finding the Enquiry no longer Open
  // (ENQUIRY_NOT_OPEN) -- both are the SAME authoritative atomic guard family
  // (enquiryService.js's own comment: "the authoritative, race-safe guards are
  // still the atomic operations inside the transaction"); either is correct.
  assert.ok(
    ['DUPLICATE_CONVERSION', 'ENQUIRY_NOT_OPEN'].includes(rejected[0].reason.code),
    `expected DUPLICATE_CONVERSION or ENQUIRY_NOT_OPEN, got ${rejected[0].reason.code}`
  );
  assert.equal(store.state.salesOrders.length, 1, 'no duplicate SalesOrder persisted');
  assert.equal(store.state.projects.length, 1, 'no duplicate Project persisted (fused into the same cascade)');
  const enq = store.state.enquiries.find((e) => e.id === 'enq1');
  assert.equal(enq.status, 'Won');
  assert.equal(enq.followUpLog.length, 1, 'Won transition logged exactly once, not twice');
});

/* ============== 2. Inventory Issue ============== */

test('CONCURRENCY: Inventory Issue -- available=10, two concurrent Issue(7) requests: exactly one succeeds, stock never negative/phantom', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 10 } }],
    users: [{ id: 'u_eng', companyId: 'co1', role: 'engineer', name: 'Eng One' }],
  });
  const a = auth({ role: 'inventory' });
  const issueInput = { itemId: 'item1', quantity: 7, fromLocationId: 'loc1', staffId: 'u_eng', site: 'Site A' };

  const results = await Promise.allSettled([
    inventoryService.issueMaterial(issueInput, a, store),
    inventoryService.issueMaterial(issueInput, a, store),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'only one Issue of 7 can be satisfied from a stock of 10');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'INSUFFICIENT_STOCK');

  const item = store.state.inventoryItems.find((i) => i.id === 'item1');
  assert.equal(item.stockByLocation.loc1, 3, 'stock must be exactly 10-7=3, never negative, never double-decremented');
  assert.equal(store.state.inventoryIssues.length, 1, 'exactly one Issue record created');
});

/* ============== 3. Inventory Return (the Stage 5 finding) ============== */

test('CONCURRENCY: Inventory Return -- two concurrent Return(7) requests against a balance of 10 must not both succeed / must not phantom-credit stock', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 0 } }],
    inventoryIssues: [{ id: 'iss1', companyId: 'co1', itemId: 'item1', quantityIssued: 10, quantityReturned: 0, quantityUsed: 0, staffId: 'u_eng', fromLocationId: 'loc1', site: 'Site A', status: 'Issued' }],
    users: [{ id: 'u_eng', companyId: 'co1', role: 'engineer', name: 'Eng One' }],
  });
  const a = auth({ role: 'inventory' });
  const returnInput = { quantity: 7, toLocationId: 'loc1' };

  const results = await Promise.allSettled([
    inventoryService.acceptReturn('iss1', returnInput, a, store),
    inventoryService.acceptReturn('iss1', returnInput, a, store),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const item = store.state.inventoryItems.find((i) => i.id === 'item1');
  const issue = store.state.inventoryIssues.find((i) => i.id === 'iss1');

  console.log('RETURN RACE RESULT: fulfilled=%d stock=%d quantityReturned=%d', fulfilled.length, item.stockByLocation.loc1, issue.quantityReturned);

  assert.ok(issue.quantityReturned <= 10, `quantityReturned must never exceed the original quantityIssued (10); got ${issue.quantityReturned}`);
  assert.equal(item.stockByLocation.loc1, issue.quantityReturned, `credited stock (${item.stockByLocation.loc1}) must equal quantityReturned (${issue.quantityReturned}) -- no phantom stock`);
  if (fulfilled.length === 1) {
    assert.equal(issue.quantityReturned, 7);
    assert.equal(item.stockByLocation.loc1, 7);
  }
});

/* ============== 4. Inventory Mark Used ============== */

test('CONCURRENCY: Inventory Mark Used -- two concurrent MarkUsed(7) against a balance of 10 must not double count beyond the balance, and never touches stock', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 0 } }],
    inventoryIssues: [{ id: 'iss1', companyId: 'co1', itemId: 'item1', quantityIssued: 10, quantityReturned: 0, quantityUsed: 0, staffId: 'u_eng', fromLocationId: 'loc1', site: 'Site A', status: 'Issued' }],
    users: [{ id: 'u_eng', companyId: 'co1', role: 'engineer', name: 'Eng One' }],
  });
  const a = auth({ role: 'inventory' });
  const input = { quantity: 7 };

  const results = await Promise.allSettled([
    inventoryService.markUsed('iss1', input, a, store),
    inventoryService.markUsed('iss1', input, a, store),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const issue = store.state.inventoryIssues.find((i) => i.id === 'iss1');
  const item = store.state.inventoryItems.find((i) => i.id === 'item1');

  console.log('MARK-USED RACE RESULT: fulfilled=%d quantityUsed=%d stock=%d', fulfilled.length, issue.quantityUsed, item.stockByLocation.loc1);

  assert.ok(issue.quantityUsed <= 10, `quantityUsed must never exceed quantityIssued (10); got ${issue.quantityUsed}`);
  assert.equal(item.stockByLocation.loc1, 0, 'Mark Used must NEVER touch stock (Decision 24) -- stock stays exactly as it was');
  // Ground truth: if both concurrent Mark-Used(7) calls actually succeeded,
  // the TRUE total marked-used is 14, which must be reflected (or the
  // second must have been rejected as exceeding the balance) -- it must
  // never silently record only 7 while having accepted two 7-unit actions.
  if (fulfilled.length === 2) {
    assert.equal(issue.quantityUsed, 14, `two accepted Mark-Used(7) actions must sum to 14 in the issue ledger; got ${issue.quantityUsed} (a lost update)`);
  } else {
    assert.equal(fulfilled.length, 1);
    assert.equal(issue.quantityUsed, 7);
  }
});

/* ============== 5. Inventory Transfer ============== */

test('CONCURRENCY: Inventory Transfer -- two concurrent Transfer(7) from a source with 10 units: exactly one succeeds, source/dest ledger consistent', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }, { id: 'loc2', companyId: 'co1', name: 'Site Store' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 10, loc2: 0 } }],
  });
  const a = auth({ role: 'inventory' });
  const input = { itemId: 'item1', fromLocationId: 'loc1', toLocationId: 'loc2', quantity: 7 };

  const results = await Promise.allSettled([
    inventoryService.transferStock(input, a, store),
    inventoryService.transferStock(input, a, store),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const item = store.state.inventoryItems.find((i) => i.id === 'item1');
  assert.equal(fulfilled.length, 1, 'only one Transfer of 7 can be satisfied from a source of 10');
  assert.equal(item.stockByLocation.loc1, 3);
  assert.equal(item.stockByLocation.loc2, 7);
  assert.equal(item.stockByLocation.loc1 + item.stockByLocation.loc2, 10, 'total quantity conserved across locations');
});

/* ============== 6. Inventory Adjustment ============== */

test('CONCURRENCY: Inventory Adjustment -- two concurrent negative adjustments do not overshoot below zero', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 10 } }],
  });
  const a = auth({ role: 'inventory' });
  const input = { type: 'Adjustment', quantity: -7, locationId: 'loc1' };
  const results = await Promise.allSettled([
    inventoryService.adjustStock('item1', input, a, store),
    inventoryService.adjustStock('item1', input, a, store),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const item = store.state.inventoryItems.find((i) => i.id === 'item1');
  assert.equal(fulfilled.length, 1);
  assert.equal(item.stockByLocation.loc1, 3);
});

/* ============== 7. Inventory Purchase / Opening Stock ============== */

test('CONCURRENCY: Inventory Purchase (positive Adjustment) -- two concurrent +5 purchases both land, no lost update', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'cat1', companyId: 'co1', name: 'Pipes' }],
    inventoryLocations: [{ id: 'loc1', companyId: 'co1', name: 'Godown' }],
    inventoryItems: [{ id: 'item1', companyId: 'co1', name: 'Copper Pipe', unit: 'Nos', categoryId: 'cat1', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { loc1: 0 } }],
  });
  const a = auth({ role: 'inventory' });
  const input = { type: 'Purchase In', quantity: 5, locationId: 'loc1' };
  const results = await Promise.allSettled([
    inventoryService.adjustStock('item1', input, a, store),
    inventoryService.adjustStock('item1', input, a, store),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const item = store.state.inventoryItems.find((i) => i.id === 'item1');
  assert.equal(fulfilled.length, 2, 'two independent +5 purchases both succeed (no stock ceiling)');
  assert.equal(item.stockByLocation.loc1, 10, 'both +5 purchases landed -- no lost update');
  assert.equal(store.state.inventoryTransactions.length, 2);
});

/* ============== 8. Project -> Contract (locked "not guarded" decision) ============== */

test('CONCURRENCY: Project->Contract -- two concurrent conversions of the SAME eligible Project both succeed (LOCKED Decision 9: intentionally unguarded, matches PWA)', async () => {
  const store = createAtomicStore({
    projects: [{ id: 'proj1', companyId: 'co1', division: 'HVAC', name: 'Chiller Plant', customer: 'X', capacity: '10TR', status: 'Completed' }],
  });
  const a = auth({ role: 'service_mgr' });
  const results = await Promise.allSettled([
    contractService.convertProjectToContract('proj1', a, store),
    contractService.convertProjectToContract('proj1', a, store),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'both conversions succeed -- CONTRACT_DECISION_LOCK.md Decision 9 explicitly forbids adding a duplicate-conversion guard');
  assert.equal(store.state.contracts.length, 2);
  const project = store.state.projects.find((p) => p.id === 'proj1');
  assert.equal(project.status, 'In Service');
});

/* ============== 9. Contract -> ServiceCall -> Payment / due update ============== */

test('CONCURRENCY: ServiceCall completion -- two concurrent completeServiceCall calls: exactly one Completed transition, one Contract due-slot stamp, one Payment (if Chargeable)', async () => {
  const store = createAtomicStore({
    contracts: [{ id: 'c1', companyId: 'co1', customer: 'X', phone: '9', email: '', site: 'Site', capacity: '1TR', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), amcType: 'Quarterly', category: 'AMC', amount: 1000, scheduledVisits: [{ month: '2026-01', completedDate: null }, { month: '2026-04', completedDate: null }, { month: '2026-07', completedDate: null }, { month: '2026-10', completedDate: null }], originatingProjectId: null }],
    serviceCalls: [{ id: 'sc1', companyId: 'co1', type: 'PM', contractId: 'c1', complaintNumber: 1, customer: 'X', phone: '9', site: 'Site', status: 'Assigned', engineerId: 'eng1', appointmentDate: new Date('2026-01-05'), appointmentTime: '10:00' }],
    users: [{ id: 'eng1', companyId: 'co1', role: 'engineer', name: 'Eng One' }],
    companies: [{ id: 'co1', name: 'Test Co' }],
  });
  const a = auth({ role: 'service_eng', userId: 'eng1', name: 'Eng One' });
  const input = { signature: 'data:sig', report: { serviceType: 'Chargeable', amount: 500, notes: 'done' } };

  const results = await Promise.allSettled([
    serviceCallService.completeServiceCall('sc1', input, a, store),
    serviceCallService.completeServiceCall('sc1', input, a, store),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const completedNowCount = succeeded.filter((r) => r.value.completedNow).length;
  assert.equal(completedNowCount, 1, 'exactly one call actually performs the Completed transition (completeIfNotCompleted atomic guard)');

  const sc = store.state.serviceCalls.find((s) => s.id === 'sc1');
  assert.equal(sc.status, 'Completed');
  const contract = store.state.contracts.find((c) => c.id === 'c1');
  const doneVisits = contract.scheduledVisits.filter((v) => v.completedDate);
  assert.equal(doneVisits.length, 1, 'exactly one PM due-slot stamped, not two');
  const payments = store.state.payments.filter((p) => p.projectOrReference && p.projectOrReference.includes('PSC-1'));
  assert.equal(payments.length, 1, 'exactly one Chargeable Payment created, not two');
});

/* ============== 10. Checklist template default ============== */

test('CONCURRENCY: setDefaultTemplate -- two concurrent set-default calls for different templates in the same division: exactly one ends up default, never both/neither', async () => {
  const store = createAtomicStore({
    checklistTemplates: [
      { id: 'tpl1', companyId: 'co1', division: 'HVAC', name: 'A', isDefault: true, items: [] },
      { id: 'tpl2', companyId: 'co1', division: 'HVAC', name: 'B', isDefault: false, items: [] },
    ],
  });
  const a = auth({ role: 'admin' });
  await Promise.allSettled([
    checklistTemplateService.setDefaultTemplate('tpl1', a, store),
    checklistTemplateService.setDefaultTemplate('tpl2', a, store),
  ]);
  const defaults = store.state.checklistTemplates.filter((t) => t.isDefault);
  assert.equal(defaults.length, 1, 'exactly one template is default after the race, never zero or two');
});

/* ============== 11. User creation -- duplicate username ============== */

test('CONCURRENCY: createUser -- two concurrent createUser calls with the same username: exactly one user is persisted (models the real User unique(companyId,username) index, which the plain in-memory fake does not enforce on its own)', async () => {
  const store = createAtomicStore({ companies: [{ id: 'co1', name: 'Test Co' }] });
  const realCreate = store.userWriteRepo.create.bind(store.userWriteRepo);
  store.userWriteRepo.create = async (userData) => {
    const dupe = store.state.users.some((u) => String(u.companyId) === String(userData.companyId) && u.username === userData.username);
    if (dupe) {
      const err = new Error('E11000 duplicate key error (companyId, username)');
      err.code = 11000;
      throw err; // mirrors the REAL unique index backstop -- userService.js does not catch this itself.
    }
    return realCreate(userData);
  };
  const deps = { ...store, passwordHasher: { hashPassword: async (p) => `hashed:${p}`, verifyPassword: async () => true } };
  const a = auth({ role: 'admin' });
  const input = { name: 'New Eng', username: 'neweng', password: 'Passw0rd!', role: 'engineer' };

  const results = await Promise.allSettled([
    userService.createUser(input, a, deps),
    userService.createUser(input, a, deps),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const usersWithName = store.state.users.filter((u) => u.username === 'neweng');
  console.log('USER CREATE RACE: fulfilled=%d persisted=%d rejectionCodes=%o', fulfilled.length, usersWithName.length, results.filter(r=>r.status==='rejected').map(r=>r.reason && r.reason.code));
  assert.equal(usersWithName.length, 1, 'exactly one user with this username must exist -- no duplicate account');
});

/* ============== 12. Cross-company concurrency ============== */

test('CONCURRENCY: cross-company concurrent Inventory Issue -- Company A and Company B operations never interfere', async () => {
  const store = createAtomicStore({
    inventoryCategories: [{ id: 'catA', companyId: 'co1', name: 'Pipes' }, { id: 'catB', companyId: 'co2', name: 'Pipes' }],
    inventoryLocations: [{ id: 'locA', companyId: 'co1', name: 'Godown A' }, { id: 'locB', companyId: 'co2', name: 'Godown B' }],
    inventoryItems: [
      { id: 'itemA', companyId: 'co1', name: 'Pipe A', unit: 'Nos', categoryId: 'catA', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { locA: 10 } },
      { id: 'itemB', companyId: 'co2', name: 'Pipe B', unit: 'Nos', categoryId: 'catB', returnable: true, minimumStockLevel: 0, ratePerUnit: 10, stockByLocation: { locB: 10 } },
    ],
    users: [{ id: 'u_engA', companyId: 'co1', role: 'engineer', name: 'Eng A' }, { id: 'u_engB', companyId: 'co2', role: 'engineer', name: 'Eng B' }],
  });
  const authA = auth({ role: 'inventory', companyId: 'co1' });
  const authB = auth({ role: 'inventory', companyId: 'co2' });

  await Promise.all([
    inventoryService.issueMaterial({ itemId: 'itemA', quantity: 4, fromLocationId: 'locA', staffId: 'u_engA', site: 'Site A' }, authA, store),
    inventoryService.issueMaterial({ itemId: 'itemB', quantity: 6, fromLocationId: 'locB', staffId: 'u_engB', site: 'Site B' }, authB, store),
  ]);

  const itemA = store.state.inventoryItems.find((i) => i.id === 'itemA');
  const itemB = store.state.inventoryItems.find((i) => i.id === 'itemB');
  assert.equal(itemA.stockByLocation.locA, 6, 'Company A stock only affected by Company A operation');
  assert.equal(itemB.stockByLocation.locB, 4, 'Company B stock only affected by Company B operation');
  assert.equal(store.state.inventoryIssues.filter((i) => i.companyId === 'co1').length, 1);
  assert.equal(store.state.inventoryIssues.filter((i) => i.companyId === 'co2').length, 1);

  await assert.rejects(
    () => inventoryService.issueMaterial({ itemId: 'itemB', quantity: 1, fromLocationId: 'locB', staffId: 'u_engA', site: 'X' }, authA, store),
    /NOT_FOUND|not found/i
  );
});

/* ============== 13. Project checklist -- FIX-6-01 (was P2 finding F2, now fixed) ============== */

test('FIX-6-01 CONCURRENCY: setChecklistItemDone -- two concurrent ticks of DIFFERENT items on the SAME project both survive (re-fetch-inside-transaction fix)', async () => {
  const store = createAtomicStore({
    projects: [{
      id: 'proj1', companyId: 'co1', division: 'HVAC', name: 'Test Project', customer: 'X', status: 'Ongoing',
      timelineSet: true, assignedEngineerIds: ['eng1', 'eng2'],
      checklist: [
        { text: 'Item 1', done: false, targetDate: '2099-01-01', completedDate: null, approval: null, pmSigned: false },
        { text: 'Item 2', done: false, targetDate: '2099-01-01', completedDate: null, approval: null, pmSigned: false },
      ],
    }],
  });
  const authEng1 = auth({ role: 'engineer', userId: 'eng1' });
  const authEng2 = auth({ role: 'engineer', userId: 'eng2' });

  const results = await Promise.allSettled([
    projectService.setChecklistItemDone('proj1', 0, true, authEng1, store),
    projectService.setChecklistItemDone('proj1', 1, true, authEng2, store),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'), 'both concurrent ticks should succeed (harness retries on conflict)');

  const project = store.state.projects.find((p) => p.id === 'proj1');
  assert.equal(project.checklist[0].done, true, 'item 0 tick must not be lost');
  assert.equal(project.checklist[1].done, true, 'item 1 tick must not be lost');
  // NOTE: the harness's JSON-clone-on-retry can leave a winning attempt's
  // completedDate as either a raw Date object or an already-JSON-stringified
  // ISO string depending on which attempt actually committed -- normalize
  // through `new Date(...)` rather than `String(...)` so the assertion is
  // robust to both representations (real MongoDB always stores/returns a
  // proper Date either way, so this is a harness quirk, not a functional one).
  assert.equal(new Date(project.checklist[0].completedDate).toISOString().slice(0, 10), todayIso());
  assert.equal(new Date(project.checklist[1].completedDate).toISOString().slice(0, 10), todayIso());
  // Item order and field values (text) must be preserved.
  assert.equal(project.checklist[0].text, 'Item 1');
  assert.equal(project.checklist[1].text, 'Item 2');
  // Both items are now done -- the "all checklist points completed" notification must fire exactly once.
  const allDoneNotifs = store.state.notifications.filter((n) => /All checklist points completed/.test(n.text));
  assert.equal(allDoneNotifs.length, 1, 'the all-done notification must fire exactly once, not zero and not twice');
});

test('FIX-6-01 CONCURRENCY: setChecklistItemDone -- two concurrent ticks of the SAME item resolve to one consistent, non-corrupted state', async () => {
  const store = createAtomicStore({
    projects: [{
      id: 'proj1', companyId: 'co1', division: 'HVAC', name: 'Test Project', customer: 'X', status: 'Ongoing',
      timelineSet: true, assignedEngineerIds: ['eng1', 'eng2'],
      checklist: [
        { text: 'Item 1', done: false, targetDate: '2099-01-01', completedDate: null, approval: null, pmSigned: false },
        { text: 'Item 2', done: false, targetDate: '2099-01-01', completedDate: null, approval: null, pmSigned: false },
      ],
    }],
  });
  const authEng1 = auth({ role: 'engineer', userId: 'eng1' });
  const authEng2 = auth({ role: 'engineer', userId: 'eng2' });

  const results = await Promise.allSettled([
    projectService.setChecklistItemDone('proj1', 0, true, authEng1, store),
    projectService.setChecklistItemDone('proj1', 0, true, authEng2, store),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'));

  const project = store.state.projects.find((p) => p.id === 'proj1');
  assert.equal(project.checklist.length, 2, 'checklist array must not grow/shrink from the concurrent retries');
  assert.equal(project.checklist[0].done, true);
  assert.equal(project.checklist[1].done, false, 'the untouched item must remain untouched');
});
