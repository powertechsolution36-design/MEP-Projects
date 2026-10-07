'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/serviceCallService');
const contractService = require('../src/services/contractService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin One', ...overrides };
}

function baseCompany(overrides) {
  return { id: 'co1', name: 'Cool Breeze Systems', phone: '9876543210', email: 'info@coolbreeze.example', ...overrides };
}

function baseContract(overrides) {
  return {
    id: 'c1',
    companyId: 'co1',
    customer: 'Ravi Kumar',
    phone: '9000000001',
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

function engineerUser(overrides) {
  return { id: 'eng1', companyId: 'co1', name: 'Suresh Engineer', role: 'service_eng', ...overrides };
}

function baseStore(seed) {
  return createEnquiryFakeStore({ companies: [baseCompany()], ...seed });
}

/* ================= Entity creation: Complaint ================= */

test('registerComplaint — creates Registered Complaint with exact PWA-fact object shape, notifies service_mgr+admin, returns msgReg customer message', async () => {
  const store = baseStore();
  const { serviceCall, customerMessage } = await service.registerComplaint(
    { customer: 'Priya', phone: '9998887776', site: 'Flat 4B', complaint: 'AC not cooling' },
    auth({ role: 'service_mgr' }),
    store
  );
  assert.equal(serviceCall.type, 'Complaint');
  assert.equal(serviceCall.status, 'Registered');
  assert.equal(serviceCall.customer, 'Priya');
  assert.equal(serviceCall.phone, '9998887776');
  assert.equal(serviceCall.site, 'Flat 4B');
  assert.equal(serviceCall.complaintDescription, 'AC not cooling');
  assert.equal(serviceCall.engineerId, null);
  assert.equal(serviceCall.report, null);
  assert.equal(serviceCall.clientSignatureImage, null);
  assert.equal(serviceCall.contractId, null);
  assert.equal(serviceCall.complaintNumber, 1);

  assert.equal(store.state.notifications.length, 1);
  assert.deepEqual(store.state.notifications[0].targetRoles, ['service_mgr', 'admin']);
  assert.equal(store.state.notifications[0].text, `New complaint registered: PSC-1 — Priya (Flat 4B)`);

  assert.match(customerMessage, /Thank you for contacting Cool!/);
  assert.match(customerMessage, /Service call registration no – PSC 1/);
});

test('registerComplaint — customer name is the ONLY enforced field; blank/missing customer rejected', async () => {
  const store = baseStore();
  await assert.rejects(
    () => service.registerComplaint({ customer: '  ' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.registerComplaint({}, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  // phone/site/complaint all optional
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  assert.equal(serviceCall.phone, '');
  assert.equal(serviceCall.site, '');
  assert.equal(serviceCall.complaintDescription, '');
});

test('registerComplaint — role gate: only admin/service_mgr (§18/§19)', async () => {
  const store = baseStore();
  await assert.rejects(
    () => service.registerComplaint({ customer: 'X' }, auth({ role: 'service_eng' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  await assert.rejects(
    () => service.registerComplaint({ customer: 'X' }, auth({ role: 'engineer' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

/* ================= Entity creation: PM ================= */

test('schedulePM — creates Scheduled PM ServiceCall, pre-fills customer/phone/site from Contract, sets contractId, notifies, returns msgPM message', async () => {
  const store = baseStore({ contracts: [baseContract()] });
  const { serviceCall, customerMessage } = await service.schedulePM(
    'c1',
    { date: '2026-04-10', time: '10:00 AM' },
    auth({ role: 'service_mgr' }),
    store
  );
  assert.equal(serviceCall.type, 'PM');
  assert.equal(serviceCall.status, 'Scheduled');
  assert.equal(serviceCall.customer, 'Ravi Kumar'); // pre-filled from contract
  assert.equal(serviceCall.phone, '9000000001');
  assert.equal(serviceCall.site, 'Tower Chiller Plant');
  assert.equal(serviceCall.complaintDescription, ''); // PWA FACT: always blank for PM
  assert.equal(serviceCall.contractId, 'c1');
  assert.equal(new Date(serviceCall.appointmentDate).toISOString().slice(0, 10), '2026-04-10');
  assert.equal(serviceCall.appointmentTime, '10:00 AM');

  assert.equal(store.state.notifications[0].text, `PM scheduled: PSC-1 — Ravi Kumar (Tower Chiller Plant)`);
  assert.match(customerMessage, /Service call registration no – PSC 1/);
  assert.match(customerMessage, /Service call date – 2026-04-10/);
  assert.match(customerMessage, /Service call time – 10:00 AM/);
});

test('schedulePM — caller-supplied customer/phone/site override the Contract pre-fill', async () => {
  const store = baseStore({ contracts: [baseContract()] });
  const { serviceCall } = await service.schedulePM('c1', { customer: 'Edited Name', date: '2026-04-10' }, auth(), store);
  assert.equal(serviceCall.customer, 'Edited Name');
});

test('schedulePM — Contract must exist (PWA FACT: `if(c)` existence check), but no validity/expiry check is added', async () => {
  const store = baseStore();
  await assert.rejects(() => service.schedulePM('missing', {}, auth(), store), (err) => err.code === 'NOT_FOUND');

  const expired = baseStore({ contracts: [baseContract({ endDate: new Date('2000-01-01') })] });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), expired);
  assert.equal(serviceCall.status, 'Scheduled'); // no expiry gate
});

test('schedulePM — role gate: only admin/service_mgr', async () => {
  const store = baseStore({ contracts: [baseContract()] });
  await assert.rejects(
    () => service.schedulePM('c1', {}, auth({ role: 'service_eng' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('schedulePM — no duplicate-PM-call guard: scheduling twice against the same Contract is allowed (§7/§14/Explicitly Forbidden Redesign #7)', async () => {
  const store = baseStore({ contracts: [baseContract()] });
  await service.schedulePM('c1', {}, auth(), store);
  await service.schedulePM('c1', {}, auth(), store);
  const all = await store.serviceCallRepo.listByCompany('co1');
  assert.equal(all.length, 2);
  assert.ok(all.every((s) => s.contractId === 'c1'));
});

/* ================= PSC numbering ================= */

test('PSC numbering — separate, per-company, monotonic counter, distinct from the durable id', async () => {
  const store = baseStore();
  const first = await service.registerComplaint({ customer: 'A' }, auth(), store);
  const second = await service.registerComplaint({ customer: 'B' }, auth(), store);
  assert.equal(first.serviceCall.complaintNumber, 1);
  assert.equal(second.serviceCall.complaintNumber, 2);
  assert.notEqual(first.serviceCall.id, second.serviceCall.id);
});

test('PSC numbering — per-company: two companies each start their own PSC sequence at 1 (Decision 3, narrowing the PWA\'s accidental global sharing)', async () => {
  const store = createEnquiryFakeStore({ companies: [baseCompany({ id: 'co1' }), baseCompany({ id: 'co2' })] });
  const co1First = await service.registerComplaint({ customer: 'A' }, auth({ companyId: 'co1' }), store);
  const co2First = await service.registerComplaint({ customer: 'B' }, auth({ companyId: 'co2' }), store);
  assert.equal(co1First.serviceCall.complaintNumber, 1);
  assert.equal(co2First.serviceCall.complaintNumber, 1);
});

test('PSC numbering — concurrent creation requests never collide (atomic counter, no duplicate PSC)', async () => {
  const store = baseStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => service.registerComplaint({ customer: `Customer ${i}` }, auth(), store))
  );
  const pscs = results.map((r) => r.serviceCall.complaintNumber).sort((a, b) => a - b);
  assert.deepEqual(pscs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(pscs).size, 10); // no duplicates
});

/* ================= Assignment ================= */

test('assignEngineer — valid candidate role transitions Registered -> Assigned, sets date/time, notifies ["*"]', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya' }, auth(), store);
  const updated = await service.assignEngineer(
    serviceCall.id,
    { engineerId: 'eng1', date: '2026-05-01', time: '02:00 PM' },
    auth({ role: 'service_mgr' }),
    store
  );
  assert.equal(updated.engineerId, 'eng1');
  assert.equal(updated.status, 'Assigned');
  assert.equal(updated.appointmentTime, '02:00 PM');

  const assignNotif = store.state.notifications.find((n) => n.text.includes('assigned to Suresh Engineer'));
  assert.ok(assignNotif);
  assert.deepEqual(assignNotif.targetRoles, ['*']);
  assert.match(assignNotif.text, /for 2026-05-01 02:00 PM/);
});

test('assignEngineer — service_mgr is itself a valid engineer candidate (§19/Decision 5, DO NOT narrow)', async () => {
  const store = baseStore({ users: [{ id: 'mgr1', companyId: 'co1', name: 'Manager Mike', role: 'service_mgr' }] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const updated = await service.assignEngineer(serviceCall.id, { engineerId: 'mgr1' }, auth(), store);
  assert.equal(updated.engineerId, 'mgr1');
});

test('assignEngineer — invalid role candidate is rejected (e.g. hvac_pm is NOT a Service Call engineer candidate)', async () => {
  const store = baseStore({ users: [{ id: 'pm1', companyId: 'co1', name: 'PM Guy', role: 'hvac_pm' }] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await assert.rejects(
    () => service.assignEngineer(serviceCall.id, { engineerId: 'pm1' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});

test('assignEngineer — unknown engineerId is rejected', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await assert.rejects(
    () => service.assignEngineer(serviceCall.id, { engineerId: 'ghost' }, auth(), store),
    (err) => err.code === 'ENGINEER_NOT_FOUND'
  );
});

test('assignEngineer — PM-type calls never transition to "Assigned" (DO NOT FIX, §7/§21 item 7)', async () => {
  const store = baseStore({ contracts: [baseContract()], users: [engineerUser()] });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), store);
  assert.equal(serviceCall.status, 'Scheduled');
  const updated = await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  assert.equal(updated.status, 'Scheduled'); // stays Scheduled even with an engineer now set
  assert.equal(updated.engineerId, 'eng1');
});

test('assignEngineer — clearing the engineer (blank) suppresses the notification and does not downgrade status', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const assigned = await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  assert.equal(assigned.status, 'Assigned');
  const notifCountAfterAssign = store.state.notifications.length;

  const cleared = await service.assignEngineer(assigned.id, { engineerId: null }, auth(), store);
  assert.equal(cleared.engineerId, null);
  assert.equal(cleared.status, 'Assigned'); // PWA FACT: no downgrade back to Registered
  assert.equal(store.state.notifications.length, notifCountAfterAssign); // no new notification fired
});

test('assignEngineer — repeated identical assignment re-fires the notification every time, no dedup (DO NOT FIX, §7/§21 item 8)', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  const assignNotifs = store.state.notifications.filter((n) => n.text.includes('assigned to'));
  assert.equal(assignNotifs.length, 2);
});

test('assignEngineer — role gate: only admin/service_mgr may assign', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await assert.rejects(
    () => service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth({ role: 'service_eng' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('assignEngineer — cannot reassign a Completed Service Call', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'data:image/png;base64,AAA' }, auth(), store);
  await assert.rejects(
    () => service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store),
    (err) => err.code === 'INVALID_STATUS_TRANSITION'
  );
});

/* ================= Draft report ================= */

test('saveReportDraft — persists a whole report object, blank signature never touched, no notification fired', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  const notifCount = store.state.notifications.length;

  const updated = await service.saveReportDraft(
    serviceCall.id,
    { make: 'Daikin', model: 'FTKF50', amount: 500, checklistResults: { 'Cooling Testing': 'OK' } },
    auth({ role: 'service_eng', userId: 'eng1' }),
    store
  );
  assert.equal(updated.report.make, 'Daikin');
  assert.equal(updated.report.amount, 500);
  assert.equal(updated.report.checklistResults['Cooling Testing'], 'OK');
  assert.equal(updated.clientSignatureImage, null); // never touched by a draft save
  assert.equal(updated.status, 'Assigned'); // draft never changes status (still whatever assignment left it at)
  assert.equal(store.state.notifications.length, notifCount); // no notification for a draft
});

test('saveReportDraft — allowed with an entirely blank checklist/report and no engineer assigned (§9/§21 item 6/10)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const updated = await service.saveReportDraft(serviceCall.id, {}, auth(), store);
  assert.deepEqual(updated.report.checklistResults, {});
  assert.equal(updated.report.make, '');
});

test('saveReportDraft — whole-object replace: a second draft save wipes fields not resubmitted', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.saveReportDraft(serviceCall.id, { make: 'Daikin', model: 'X1' }, auth(), store);
  const second = await service.saveReportDraft(serviceCall.id, { model: 'X2' }, auth(), store);
  assert.equal(second.report.make, ''); // NOT merged forward from the first draft
  assert.equal(second.report.model, 'X2');
});

test('saveReportDraft — rejects a checklist key outside the fixed six (Decision 1, INFRASTRUCTURE-ONLY)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, { checklistResults: { 'Bogus Item': 'OK' } }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});

test('saveReportDraft — negative report amount is NOT rejected (§13/§21 item 13, DO NOT FIX)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const updated = await service.saveReportDraft(serviceCall.id, { amount: -500 }, auth(), store);
  assert.equal(updated.report.amount, -500);
});

test('saveReportDraft — gate: not the assigned engineer, not a manager -> forbidden', async () => {
  const store = baseStore({ users: [engineerUser(), engineerUser({ id: 'eng2', name: 'Other Eng' })] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, {}, auth({ role: 'service_eng', userId: 'eng2' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  // the assigned engineer themselves may
  const asOwner = await service.saveReportDraft(serviceCall.id, { make: 'X' }, auth({ role: 'service_eng', userId: 'eng1' }), store);
  assert.equal(asOwner.report.make, 'X');
});

test('saveReportDraft — cannot edit a Completed Service Call\'s report', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig-data' }, auth(), store);
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, { make: 'X' }, auth(), store),
    (err) => err.code === 'INVALID_STATUS_TRANSITION'
  );
});

/* ================= Signature / completion guard ================= */

test('completeServiceCall — missing/blank signature blocks completion (the SOLE hard guard)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await assert.rejects(
    () => service.completeServiceCall(serviceCall.id, {}, auth(), store),
    (err) => err.code === 'MISSING_SIGNATURE'
  );
  await assert.rejects(
    () => service.completeServiceCall(serviceCall.id, { signature: '' }, auth(), store),
    (err) => err.code === 'MISSING_SIGNATURE'
  );
});

test('completeServiceCall — no other completion guard exists: blank checklist/report, no engineer, no appointment date/time all still complete successfully', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const { serviceCall: completed } = await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  assert.equal(completed.status, 'Completed');
  assert.equal(completed.engineerId, null);
});

/* ================= Completion workflow ================= */

test('completeServiceCall — normal Complaint completion: signature persisted, status Completed, service_mgr+admin notified, msgDone customer message', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya' }, auth(), store);
  const result = await service.completeServiceCall(
    serviceCall.id,
    { signature: 'data:image/png;base64,AAA', make: 'Daikin', amount: 0 },
    auth({ role: 'service_mgr', name: 'Manager Mary' }),
    store
  );
  assert.equal(result.completedNow, true);
  assert.equal(result.serviceCall.status, 'Completed');
  assert.equal(result.serviceCall.clientSignatureImage, 'data:image/png;base64,AAA');
  assert.equal(result.serviceCall.report.make, 'Daikin');

  const completionNotif = store.state.notifications.find((n) => n.text.includes('completed by'));
  assert.ok(completionNotif);
  assert.deepEqual(completionNotif.targetRoles, ['service_mgr', 'admin']);
  assert.equal(completionNotif.text, `PSC-${serviceCall.complaintNumber} completed by Manager Mary — Priya`);

  assert.match(result.customerMessage, /Congratulations your call is attended and solved successfully/);
  assert.match(result.customerMessage, new RegExp(`PSC-${serviceCall.complaintNumber}`)); // msgDone uses the hyphen form
});

test('completeServiceCall — completed-by name prefers the assigned engineer\'s name over the completing actor\'s (PWA FACT: s.eng||U.name)', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth({ role: 'service_mgr', name: 'Manager Mary' }), store);
  const completionNotif = store.state.notifications.find((n) => n.text.includes('completed by'));
  assert.match(completionNotif.text, /completed by Suresh Engineer/);
});

test('completeServiceCall — normal PM completion: Contract due[0] slot stamped, msgPMdone customer message', async () => {
  const store = baseStore({ contracts: [baseContract({ scheduledVisits: [{ month: '2020-01', completedDate: null }] })] });
  const { serviceCall } = await service.schedulePM('c1', { date: '2026-04-10', time: '10:00 AM' }, auth(), store);
  const result = await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  assert.equal(result.serviceCall.status, 'Completed');

  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.ok(contract.scheduledVisits[0].completedDate);

  assert.match(result.customerMessage, /Congratulations, your AC system is serviced/);
  assert.match(result.customerMessage, /Service call date – 2026-04-10/);
});

test('completeServiceCall — assigned engineer (only) may complete their own call; a different engineer may not', async () => {
  const store = baseStore({ users: [engineerUser(), engineerUser({ id: 'eng2', name: 'Other Eng' })] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);
  await assert.rejects(
    () => service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth({ role: 'service_eng', userId: 'eng2' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const completed = await service.completeServiceCall(
    serviceCall.id,
    { signature: 'sig' },
    auth({ role: 'service_eng', userId: 'eng1' }),
    store
  );
  assert.equal(completed.serviceCall.status, 'Completed');
});

/* ================= Chargeable Payment ================= */

test('completeServiceCall — Chargeable + amount>0 creates a Payment with the exact locked field mapping, notifies finance', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya', phone: '999', site: 'Flat 4B' }, auth(), store);
  await service.completeServiceCall(
    serviceCall.id,
    { signature: 'sig', serviceType: 'Chargeable', amount: 1500 },
    auth(),
    store
  );
  assert.equal(store.state.payments.length, 1);
  const payment = store.state.payments[0];
  assert.equal(payment.companyId, 'co1');
  assert.equal(payment.projectOrReference, `Flat 4B (PSC-${serviceCall.complaintNumber})`);
  assert.equal(payment.personName, 'Priya');
  assert.equal(payment.phone, '999');
  assert.equal(payment.amount, 1500);
  assert.equal(payment.remark, 'Chargeable service call');
  assert.equal(payment.status, 'Pending');
  assert.equal(payment.salesOrderId, null);

  const financeNotif = store.state.notifications.find((n) => n.targetRoles.includes('finance'));
  assert.ok(financeNotif);
  assert.match(financeNotif.text, /Chargeable service PSC-\d+ completed — ₹ 1,500 to collect from Priya/);
});

test('completeServiceCall — Chargeable + amount=0 does NOT create a Payment', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig', serviceType: 'Chargeable', amount: 0 }, auth(), store);
  assert.equal(store.state.payments.length, 0);
});

test('completeServiceCall — non-Chargeable serviceType never creates a Payment, even with a positive amount', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig', serviceType: 'AMC', amount: 999 }, auth(), store);
  assert.equal(store.state.payments.length, 0);
});

test('completeServiceCall — negative Chargeable amount is not rejected but also does not create a Payment (amount>0 is the exact condition)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const result = await service.completeServiceCall(
    serviceCall.id,
    { signature: 'sig', serviceType: 'Chargeable', amount: -100 },
    auth(),
    store
  );
  assert.equal(result.serviceCall.report.amount, -100);
  assert.equal(store.state.payments.length, 0);
});

test('completeServiceCall — atomic rollback: a failing Payment write rolls back the ServiceCall status AND the Contract PM-slot stamp', async () => {
  const store = baseStore({ contracts: [baseContract({ scheduledVisits: [{ month: '2020-01', completedDate: null }] })] });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), store);

  const originalCreate = store.paymentRepo.create;
  store.paymentRepo.create = async () => {
    throw new Error('simulated Payment write failure');
  };
  try {
    await assert.rejects(() =>
      service.completeServiceCall(serviceCall.id, { signature: 'sig', serviceType: 'Chargeable', amount: 500 }, auth(), store)
    );
  } finally {
    store.paymentRepo.create = originalCreate;
  }

  const reloaded = await store.serviceCallRepo.findById('co1', serviceCall.id);
  assert.equal(reloaded.status, 'Scheduled'); // rolled back, not left "Completed" with no Payment
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.equal(contract.scheduledVisits[0].completedDate, null); // rolled back too
  assert.equal(store.state.payments.length, 0);
});

test('completeServiceCall — a retried/duplicate completion request never creates a second Payment or re-stamps the Contract slot (Decision 7/10, concurrency-safe idempotency WITHOUT a rejection guard)', async () => {
  const store = baseStore({ contracts: [baseContract({ scheduledVisits: [{ month: '2020-01', completedDate: null }, { month: '2020-02', completedDate: null }] })] });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), store);

  const first = await service.completeServiceCall(
    serviceCall.id,
    { signature: 'sig', serviceType: 'Chargeable', amount: 500 },
    auth(),
    store
  );
  assert.equal(first.completedNow, true);
  assert.equal(store.state.payments.length, 1);

  // Simulate a network retry of the exact same completion request.
  const second = await service.completeServiceCall(
    serviceCall.id,
    { signature: 'sig', serviceType: 'Chargeable', amount: 500 },
    auth(),
    store
  );
  assert.equal(second.completedNow, false); // idempotent no-op -- NOT rejected with an error
  assert.equal(second.serviceCall.status, 'Completed');
  assert.equal(store.state.payments.length, 1); // still exactly one Payment
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.ok(contract.scheduledVisits[0].completedDate);
  assert.equal(contract.scheduledVisits[1].completedDate, null); // second slot NOT also stamped by the retry

  const completionNotifs = store.state.notifications.filter((n) => n.text.includes('completed by'));
  assert.equal(completionNotifs.length, 1); // no duplicate completion notification either
});

test('completeServiceCall — concurrent simultaneous completion requests: only one wins, no duplicate Payment', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  const [a, b] = await Promise.all([
    service.completeServiceCall(serviceCall.id, { signature: 'sig', serviceType: 'Chargeable', amount: 100 }, auth(), store),
    service.completeServiceCall(serviceCall.id, { signature: 'sig', serviceType: 'Chargeable', amount: 100 }, auth(), store),
  ]);
  const completedNowCount = [a, b].filter((r) => r.completedNow).length;
  assert.equal(completedNowCount, 1);
  assert.equal(store.state.payments.length, 1);
});

/* ================= Contract PM linkage / due-slot quirk ================= */

test('completeServiceCall — Contract PM linkage: a Complaint (no contractId) never touches any Contract', async () => {
  const store = baseStore({ contracts: [baseContract()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.ok(contract.scheduledVisits.every((v) => v.completedDate === null));
});

test('completeServiceCall — due[0] quirk preserved: completion stamps the slot that is FIRST DUE AT COMPLETION TIME, not necessarily the slot the PM call was originally scheduled against (DO NOT FIX, Decision 4/§15)', async () => {
  // Two overdue slots exist. The PM ServiceCall is scheduled once, but by
  // completion time due[0] is recomputed fresh -- exactly matching
  // contractService.completePmVisitForContract's own already-tested
  // behavior (this test asserts the ServiceCall-side integration calls it
  // exactly as built, not a ServiceCall-specific reimplementation).
  const store = baseStore({
    contracts: [
      baseContract({
        scheduledVisits: [
          { month: '2020-01', completedDate: null }, // due[0]
          { month: '2020-04', completedDate: null },
        ],
      }),
    ],
  });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.ok(contract.scheduledVisits[0].completedDate); // due[0] stamped
  assert.equal(contract.scheduledVisits[1].completedDate, null); // NOT the "originating" concept -- there is none
});

test('completeServiceCall — Contract PM linkage: no-op when nothing is currently due (all slots already done or future)', async () => {
  const store = baseStore({ contracts: [baseContract({ scheduledVisits: [{ month: '2099-01', completedDate: null }] })] });
  const { serviceCall } = await service.schedulePM('c1', {}, auth(), store);
  const result = await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  assert.equal(result.serviceCall.status, 'Completed'); // ServiceCall still completes normally
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.equal(contract.scheduledVisits[0].completedDate, null);
});

test('completeServiceCall — year-boundary due-slot behavior matches contractService.computePmDueIndexes exactly (reused, not reimplemented)', async () => {
  const refDate = new Date('2026-01-15T00:00:00Z');
  const contract = { scheduledVisits: [{ month: '2025-12', completedDate: null }, { month: '2026-01', completedDate: null }, { month: '2026-02', completedDate: null }] };
  assert.deepEqual(contractService.computePmDueIndexes(contract, refDate), [0, 1]);
});

test('completeServiceCall — two PM ServiceCalls against the same Contract: out-of-order completion re-stamps whatever is due[0] at each completion time (mechanical consequence of the shared quirk, not a ServiceCall-specific rule)', async () => {
  const store = baseStore({
    contracts: [
      baseContract({
        scheduledVisits: [
          { month: '2020-01', completedDate: null },
          { month: '2020-02', completedDate: null },
        ],
      }),
    ],
  });
  const pmA = await service.schedulePM('c1', {}, auth(), store);
  const pmB = await service.schedulePM('c1', {}, auth(), store);
  await service.completeServiceCall(pmA.serviceCall.id, { signature: 'sig' }, auth(), store);
  await service.completeServiceCall(pmB.serviceCall.id, { signature: 'sig' }, auth(), store);
  const contract = await store.contractRepo.findById('co1', 'c1');
  assert.ok(contract.scheduledVisits[0].completedDate);
  assert.ok(contract.scheduledVisits[1].completedDate); // both slots end up stamped, one per completion
});

/* ================= Authorization ================= */

test('Authorization — completed-report read path has NO additional role gate beyond tenant scoping (§19/§23 item 15)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  // 'finance' and 'sales' have no menu access to Service Calls at all in the
  // PWA, yet the completed-report VIEW itself has no role gate -- only
  // company-tenant scoping (mandatory infra fix, §20).
  const asFinance = await service.getServiceCall(serviceCall.id, auth({ role: 'finance' }), store);
  assert.equal(asFinance.status, 'Completed');
  const asSales = await service.getServiceCall(serviceCall.id, auth({ role: 'sales' }), store);
  assert.equal(asSales.status, 'Completed');
});

test('Authorization — cross-tenant direct detail access is blocked (mandatory infra fix, §20, the PWA\'s vCall() weakness NOT reproduced)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth({ companyId: 'co1' }), store);
  await assert.rejects(
    () => service.getServiceCall(serviceCall.id, auth({ companyId: 'co2' }), store),
    (err) => err.code === 'NOT_FOUND'
  );
});

test('Authorization — listServiceCalls/getOpenServiceCalls/exportServiceCallsCsv are company-scoped', async () => {
  const storeA = baseStore();
  const storeB = baseStore();
  await service.registerComplaint({ customer: 'A' }, auth({ companyId: 'co1' }), storeA);
  // simulate a second company's data living in the same underlying store
  storeA.state.serviceCalls.push({
    id: 'other-co-call', companyId: 'co2', complaintNumber: 1, type: 'Complaint', customer: 'Other Co',
    phone: '', site: '', appointmentDate: null, appointmentTime: '', complaintDescription: '', status: 'Registered',
    engineerId: null, registeredDate: new Date(), report: null, clientSignatureImage: null, contractId: null,
  });
  const list = await service.listServiceCalls(auth({ companyId: 'co1', role: 'admin' }), {}, storeA);
  assert.ok(list.every((s) => s.companyId === 'co1'));
  void storeB;
});

/* ================= Search / list / report ================= */

test('listServiceCalls — nine-field substring search, case-insensitive, newest-inserted-first (reversed insertion order, §17/§18)', async () => {
  const store = baseStore();
  const { serviceCall: first } = await service.registerComplaint({ customer: 'Alpha Corp', site: 'North Site' }, auth(), store);
  const { serviceCall: second } = await service.registerComplaint({ customer: 'Beta LLC', site: 'South Site', phone: '8887776665' }, auth(), store);

  const all = await service.listServiceCalls(auth(), {}, store);
  assert.deepEqual(all.map((s) => s.id), [second.id, first.id]); // reversed -- newest first

  const byCustomer = await service.listServiceCalls(auth(), { filters: { q: 'beta' } }, store);
  assert.deepEqual(byCustomer.map((s) => s.id), [second.id]);

  const byPhone = await service.listServiceCalls(auth(), { filters: { q: '8887776665' } }, store);
  assert.deepEqual(byPhone.map((s) => s.id), [second.id]);
});

test('listServiceCalls — search by engineer name (resolved from engineerId) and by PSC number', async () => {
  const store = baseStore({ users: [engineerUser()] });
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), store);

  const byEngineer = await service.listServiceCalls(auth(), { filters: { q: 'suresh' } }, store);
  assert.equal(byEngineer.length, 1);

  const byPsc = await service.listServiceCalls(auth(), { filters: { q: String(serviceCall.complaintNumber) } }, store);
  assert.equal(byPsc.length, 1);
});

test('listServiceCalls — includes ALL statuses, including Completed (Register shows everything, §17)', async () => {
  const store = baseStore();
  const { serviceCall } = await service.registerComplaint({ customer: 'X' }, auth(), store);
  await service.completeServiceCall(serviceCall.id, { signature: 'sig' }, auth(), store);
  const all = await service.listServiceCalls(auth(), {}, store);
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'Completed');
});

test('listServiceCalls — role gate: only admin/service_mgr may view the register (§18)', async () => {
  const store = baseStore();
  await assert.rejects(
    () => service.listServiceCalls(auth({ role: 'service_eng' }), {}, store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('getOpenServiceCalls — excludes Completed calls only (§17)', async () => {
  const store = baseStore();
  const { serviceCall: open } = await service.registerComplaint({ customer: 'Open One' }, auth(), store);
  const { serviceCall: toComplete } = await service.registerComplaint({ customer: 'Will Complete' }, auth(), store);
  await service.completeServiceCall(toComplete.id, { signature: 'sig' }, auth(), store);

  const rows = await service.getOpenServiceCalls(auth(), store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, open.id);
});

test('exportServiceCallsCsv — exact 22-column header, Client Signed Yes/No flag, TOTAL row sums every report amount regardless of serviceType (§17/Explicitly Forbidden Redesign #11)', async () => {
  const store = baseStore();
  const { serviceCall: chargeable } = await service.registerComplaint({ customer: 'A' }, auth(), store);
  await service.completeServiceCall(chargeable.id, { signature: 'sig', serviceType: 'Chargeable', amount: 1000 }, auth(), store);
  const { serviceCall: amc } = await service.registerComplaint({ customer: 'B' }, auth(), store);
  await service.completeServiceCall(amc.id, { signature: 'sig', serviceType: 'AMC', amount: 250 }, auth(), store);

  const csv = await service.exportServiceCallsCsv(auth(), {}, store);
  const lines = csv.split('\n');
  assert.equal(
    lines[0],
    'PSC No,Type,Registered On,Customer,Phone,Site,Appt Date,Appt Time,Engineer,Status,Complaint,Make,Model,Capacity,Unit Type,Material Used,Service Done,Service Type,Amount,Engineer Remark,Customer Remark,Client Signed'
  );
  assert.ok(csv.includes('Yes')); // Client Signed flag, not raw signature data
  assert.ok(!csv.includes('data:image'));
  const totalLine = lines[lines.length - 1];
  const totalFields = totalLine.split(',');
  assert.equal(totalFields.length, 19); // 'TOTAL CALLS' + count + 16 blanks + amount (PWA FACT literal shape, §17)
  assert.equal(totalFields[0], 'TOTAL CALLS');
  assert.equal(totalFields[1], '2');
  assert.ok(totalFields.slice(2, 18).every((f) => f === ''));
  assert.equal(totalFields[18], '1250'); // 1000 (Chargeable) + 250 (AMC) -- NOT narrowed to Chargeable-only
});

test('exportServiceCallsCsv — role gate: only admin/service_mgr', async () => {
  const store = baseStore();
  await assert.rejects(
    () => service.exportServiceCallsCsv(auth({ role: 'engineer' }), {}, store),
    (err) => err.code === 'FORBIDDEN'
  );
});

/* ================= No delete/cancel/reopen (§21 item 14 / §23 item 13) ================= */

test('ServiceCall module exposes no delete/cancel/reopen function', () => {
  assert.equal(service.deleteServiceCall, undefined);
  assert.equal(service.cancelServiceCall, undefined);
  assert.equal(service.reopenServiceCall, undefined);
  assert.equal(service.removeServiceCall, undefined);
});

/* ================= Checklist fixed set / money() formatter ================= */

test('CHECKLIST_KEYS — exactly the six fixed SVC_CHK labels, in order (§9)', () => {
  assert.deepEqual(service.CHECKLIST_KEYS, ['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning']);
});

test('money() — exact PWA formula: "" for null/undefined, "₹ 0" for zero, en-IN grouped otherwise', () => {
  assert.equal(service.money(undefined), '');
  assert.equal(service.money(null), '');
  assert.equal(service.money(0), '₹ 0');
  assert.equal(service.money(1500), '₹ 1,500');
  assert.equal(service.money(1234567), '₹ 12,34,567');
});

test('msgReg/msgDone punctuation inconsistency preserved verbatim: "PSC " (space) vs "PSC-" (hyphen, msgDone only) (§16/§17, DO NOT FIX)', () => {
  const company = baseCompany();
  assert.match(service.msgReg(5, company), /PSC 5(?!-)/);
  assert.match(service.msgDone(5, company), /PSC-5/);
  assert.match(service.msgPM(5, '2026-01-01', '10 AM', company), /PSC 5(?!-)/);
  assert.match(service.msgPMdone(5, '2026-01-01', '10 AM', company), /PSC 5(?!-)/);
});
