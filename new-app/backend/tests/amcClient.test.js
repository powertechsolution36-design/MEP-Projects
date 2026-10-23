'use strict';

/**
 * AMC client record (owner request, 22 Oct 2026):
 *   - every service report records parts repaired/replaced and gas filled;
 *   - a complaint can be linked to an AMC/Warranty client (even after the
 *     AMC has expired) or registered as Chargeable;
 *   - each client has one page with its whole history and the totals;
 *   - AMC payment, renewal on the same record, and the AMC letter;
 *   - client messages go out through the service manager's device, which
 *     holds the company WhatsApp number.
 * In-memory fakes only — nothing is sent anywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/serviceCallService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const FILLED_REPORT = {
  serviceDescription: 'Serviced unit',
  checklistResults: Object.fromEntries(service.CHECKLIST_KEYS.map((k) => [k, 'Done'])),
};
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

function auth(overrides) {
  return { userId: 'mgr', companyId: 'co1', role: 'service_mgr', name: 'Mukund', ...overrides };
}

function contract(overrides) {
  return {
    id: 'c1',
    companyId: 'co1',
    customer: 'Salvation Army',
    phone: '9000000001',
    site: 'Vishrantwadi',
    capacity: '12 TR',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    amcType: 'Quarterly',
    category: 'AMC',
    amount: 24000,
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

function store(seed) {
  return createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC'], status: 'Active', whatsappNumber: '7447333377' }],
    users: [
      { id: 'mgr', companyId: 'co1', role: 'service_mgr', name: 'Mukund' },
      { id: 'adm', companyId: 'co1', role: 'admin', name: 'Suhas' },
      { id: 'eng1', companyId: 'co1', role: 'service_eng', name: 'Anas' },
    ],
    ...seed,
  });
}

/* ================= 1. Parts and gas on the service report ================= */

test('service report — parts repaired/replaced and gas filled are recorded', async () => {
  const s = store();
  const { serviceCall } = await service.registerComplaint({ customer: 'Walk-in', site: 'Baner' }, auth(), s);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), s);
  const { serviceCall: done } = await service.completeServiceCall(serviceCall.id, {
    ...FILLED_REPORT,
    partsWork: [
      { part: 'Run capacitor 45uF', action: 'Replaced', remark: 'Bulged' },
      { part: 'Indoor PCB', action: 'Repaired' },
      { part: '   ', action: 'Repaired' }, // blank row is dropped, not rejected
    ],
    gasFilled: true,
    gasType: 'R32',
    gasQtyKg: '0.8',
    clientSignatureImage: SIGNATURE,
  }, auth({ userId: 'eng1', role: 'service_eng', name: 'Anas' }), s);

  assert.deepEqual(done.report.partsWork, [
    { part: 'Run capacitor 45uF', action: 'Replaced', remark: 'Bulged' },
    { part: 'Indoor PCB', action: 'Repaired', remark: '' },
  ]);
  assert.equal(done.report.gasFilled, true);
  assert.equal(done.report.gasType, 'R32');
  assert.equal(done.report.gasQtyKg, 0.8);
});

test('service report — a part must say Repaired or Replaced; gas details are cleared when no gas was filled', async () => {
  const s = store();
  const { serviceCall } = await service.registerComplaint({ customer: 'Walk-in' }, auth(), s);
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, { ...FILLED_REPORT, partsWork: [{ part: 'Fan motor' }] }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR' && /Fan motor/.test(e.message)
  );
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, { ...FILLED_REPORT, gasFilled: true, gasType: 'Helium' }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.saveReportDraft(serviceCall.id, { ...FILLED_REPORT, gasFilled: true, gasQtyKg: -2 }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR'
  );
  const draft = await service.saveReportDraft(
    serviceCall.id,
    { ...FILLED_REPORT, gasFilled: false, gasType: 'R32', gasQtyKg: 3 },
    auth(),
    s
  );
  assert.deepEqual([draft.report.gasFilled, draft.report.gasType, draft.report.gasQtyKg], [false, '', 0]);
});

test('a complaint linked to an AMC client does NOT tick off a scheduled AMC visit; a PM visit does', async () => {
  const s = store({ contracts: [contract()] });

  // A complaint linked to the client (set directly here; the registration
  // path is covered further down).
  const { serviceCall } = await service.registerComplaint({ customer: 'Salvation Army' }, auth(), s);
  s.state.serviceCalls.find((c) => c.id === serviceCall.id).contractId = 'c1';
  await service.completeServiceCall(serviceCall.id, { ...FILLED_REPORT, clientSignatureImage: SIGNATURE }, auth(), s);
  assert.equal(
    s.state.contracts[0].scheduledVisits.filter((v) => v.completedDate).length, 0,
    'fixing a breakdown is not one of the contracted visits'
  );

  // A PM visit on the same client does tick one off.
  const { serviceCall: pm } = await service.schedulePM('c1', { appointmentDate: '2026-04-10', appointmentTime: '10:00' }, auth(), s);
  await service.completeServiceCall(pm.id, { ...FILLED_REPORT, clientSignatureImage: SIGNATURE }, auth(), s);
  assert.equal(s.state.contracts[0].scheduledVisits.filter((v) => v.completedDate).length, 1);
});

/* ================= 2. Complaint for an AMC / Warranty client, or Chargeable ================= */

const contractService = require('../src/services/contractService');

test('complaint for an active AMC client — linked, filled in from the client, covered by AMC', async () => {
  const s = store({ contracts: [contract({ endDate: new Date(Date.now() + 200 * 86400000) })] });
  const { serviceCall } = await service.registerComplaint({ contractId: 'c1', complaintDescription: 'No cooling' }, auth(), s);
  assert.equal(String(serviceCall.contractId), 'c1');
  assert.equal(serviceCall.coverage, 'AMC');
  assert.deepEqual([serviceCall.customer, serviceCall.phone, serviceCall.site], ['Salvation Army', '9000000001', 'Vishrantwadi']);
  // The report defaults to AMC rather than Chargeable.
  const { serviceCall: done } = await service.completeServiceCall(serviceCall.id, { ...FILLED_REPORT, clientSignatureImage: SIGNATURE }, auth(), s);
  assert.equal(done.report.serviceType, 'AMC');
  assert.equal(s.state.payments.length, 0, 'a covered call raises no payment');
});

test('complaint for a client whose AMC has EXPIRED — still kept under that client, but chargeable', async () => {
  const s = store({ contracts: [contract({ endDate: new Date('2025-03-31') })] });
  const { serviceCall } = await service.registerComplaint({ contractId: 'c1' }, auth(), s);
  assert.equal(String(serviceCall.contractId), 'c1', 'the expired client keeps the call on its history');
  assert.equal(serviceCall.coverage, 'AMC expired');
  const { serviceCall: done } = await service.completeServiceCall(
    serviceCall.id, { ...FILLED_REPORT, amount: 1500, clientSignatureImage: SIGNATURE }, auth(), s
  );
  assert.equal(done.report.serviceType, 'Chargeable');
  assert.equal(s.state.payments.length, 1, 'the charge goes to Finance as usual');
  assert.equal(s.state.payments[0].amount, 1500);
});

test('warranty client — covered by Warranty; no client picked — Chargeable as before', async () => {
  const s = store({ contracts: [contract({ id: 'w1', category: 'Warranty', endDate: new Date(Date.now() + 100 * 86400000) })] });
  const { serviceCall: w } = await service.registerComplaint({ contractId: 'w1' }, auth(), s);
  assert.equal(w.coverage, 'Warranty');
  assert.equal(service.defaultServiceType(w), 'Warranty');

  const { serviceCall: walkIn } = await service.registerComplaint({ customer: 'Walk-in Customer', phone: '9111111111' }, auth(), s);
  assert.equal(walkIn.contractId, null);
  assert.equal(walkIn.coverage, 'Chargeable');
  assert.equal(service.defaultServiceType(walkIn), 'Chargeable');
});

test('complaint client — an unknown or another company’s client is refused', async () => {
  const s = store({ contracts: [contract({ id: 'other', companyId: 'co2' })] });
  await assert.rejects(() => service.registerComplaint({ contractId: 'nope' }, auth(), s), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => service.registerComplaint({ contractId: 'other' }, auth(), s), (e) => e.code === 'NOT_FOUND');
});

test('client picker — searches name, phone and site; lists expired clients too, active first', async () => {
  const soon = new Date(Date.now() + 20 * 86400000);
  const later = new Date(Date.now() + 300 * 86400000);
  const s = store({
    contracts: [
      contract({ id: 'a', customer: 'Zeta Towers', site: 'Kharadi', phone: '9000000002', endDate: later }),
      contract({ id: 'b', customer: 'Alpha Mall', site: 'Baner', phone: '9000000003', endDate: new Date('2024-01-01') }),
      contract({ id: 'c', customer: 'Beta Hospital', site: 'Wakad', phone: '9000000004', endDate: soon }),
      contract({ id: 'x', companyId: 'co2', customer: 'Other Company Client' }),
    ],
  });
  const all = await contractService.searchClients(auth(), {}, s);
  assert.deepEqual(all.map((c) => [c.customer, c.status]), [
    ['Zeta Towers', 'Active'], ['Beta Hospital', 'Expiring Soon'], ['Alpha Mall', 'Expired'],
  ]);
  assert.deepEqual((await contractService.searchClients(auth(), { q: 'baner' }, s)).map((c) => c.id), ['b']);
  assert.deepEqual((await contractService.searchClients(auth(), { q: '0004' }, s)).map((c) => c.id), ['c']);
  assert.deepEqual((await contractService.searchClients(auth(), { q: 'other company' }, s)).length, 0);
});

/* ================= 3. The AMC client page ================= */

test('client history — every call, the visits, parts, gas and services after expiry are counted', async () => {
  const s = store({ contracts: [contract({ endDate: new Date(Date.now() + 200 * 86400000) })] });
  const eng = auth({ userId: 'eng1', role: 'service_eng', name: 'Anas' });

  // 1) a PM visit with gas filled
  const { serviceCall: pm } = await service.schedulePM('c1', { appointmentDate: '2026-04-10' }, auth(), s);
  await service.assignEngineer(pm.id, { engineerId: 'eng1' }, auth(), s);
  await service.completeServiceCall(pm.id, {
    ...FILLED_REPORT, gasFilled: true, gasType: 'R32', gasQtyKg: 1.2, clientSignatureImage: SIGNATURE,
  }, eng, s);

  // 2) a covered complaint with a part replaced and a part repaired
  const { serviceCall: c1 } = await service.registerComplaint({ contractId: 'c1', complaintDescription: 'Noise' }, auth(), s);
  await service.assignEngineer(c1.id, { engineerId: 'eng1' }, auth(), s);
  await service.completeServiceCall(c1.id, {
    ...FILLED_REPORT,
    partsWork: [{ part: 'Fan motor', action: 'Replaced' }, { part: 'PCB', action: 'Repaired' }],
    gasFilled: true, gasType: 'R32', gasQtyKg: 0.5,
    clientSignatureImage: SIGNATURE,
  }, eng, s);

  // 3) the AMC then runs out — a later complaint still lands on this client
  s.state.contracts[0].endDate = new Date('2025-01-01');
  const { serviceCall: c2 } = await service.registerComplaint({ contractId: 'c1' }, auth(), s);
  await service.completeServiceCall(c2.id, {
    ...FILLED_REPORT, partsWork: [{ part: 'Capacitor', action: 'Replaced' }], amount: 900, clientSignatureImage: SIGNATURE,
  }, auth(), s);

  // 4) one still open
  await service.registerComplaint({ contractId: 'c1' }, auth(), s);

  // A walk-in call for someone else must not appear.
  await service.registerComplaint({ customer: 'Somebody else' }, auth(), s);

  const h = await contractService.getClientHistory('c1', auth(), s);
  assert.equal(h.contract.status, 'Expired');
  assert.deepEqual(
    {
      totalCalls: h.stats.totalCalls, completedCalls: h.stats.completedCalls, openCalls: h.stats.openCalls,
      complaints: h.stats.complaints, pmVisits: h.stats.pmVisits, amcVisitsDone: h.stats.amcVisitsDone,
      amcVisitsScheduled: h.stats.amcVisitsScheduled, afterExpiry: h.stats.afterExpiry,
      partsRepaired: h.stats.partsRepaired, partsReplaced: h.stats.partsReplaced,
      gasFills: h.stats.gasFills, gasKg: h.stats.gasKg, chargedAmount: h.stats.chargedAmount,
    },
    {
      totalCalls: 4, completedCalls: 3, openCalls: 1,
      complaints: 3, pmVisits: 1, amcVisitsDone: 1,
      amcVisitsScheduled: 4, afterExpiry: 2,
      partsRepaired: 1, partsReplaced: 2,
      gasFills: 2, gasKg: 1.7, chargedAmount: 900,
    }
  );
  assert.equal(h.calls.length, 4);
  const replacedRow = h.calls.find((r) => r.id === c1.id);
  assert.equal(replacedRow.engineer, 'Anas');
  assert.deepEqual(replacedRow.parts, [{ part: 'Fan motor', action: 'Replaced' }, { part: 'PCB', action: 'Repaired' }]);
  assert.ok(!('clientSignatureImage' in h.calls[0]), 'signatures stay off the history list');
});

test('mark AMC paid — records the payment; only admin, service manager or finance; validated', async () => {
  const s = store({ contracts: [contract()] });
  await assert.rejects(
    () => contractService.markAmcPaid('c1', {}, auth({ role: 'service_eng', userId: 'eng1' }), s),
    (e) => e.code === 'FORBIDDEN'
  );
  await assert.rejects(() => contractService.markAmcPaid('c1', { amountPaid: -5 }, auth(), s), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => contractService.markAmcPaid('c1', { mode: 'Barter' }, auth(), s), (e) => e.code === 'VALIDATION_ERROR');

  const paid = await contractService.markAmcPaid('c1', { mode: 'UPI', reference: 'UTR123', paidOn: '2026-01-05' }, auth({ role: 'finance', userId: 'fin' }), s);
  assert.equal(paid.payment.status, 'Paid');
  assert.equal(paid.payment.amountPaid, 24000, 'defaults to the AMC amount');
  assert.equal(paid.payment.mode, 'UPI');
  assert.equal(paid.payment.reference, 'UTR123');
  assert.ok(s.state.notifications.some((n) => /AMC paid: Salvation Army/.test(n.text)));
});

test('renew AMC — same client record; the old period, its visits and payment are kept; new period starts unpaid', async () => {
  const s = store({ contracts: [contract()] });
  await contractService.markAmcPaid('c1', { mode: 'Cheque' }, auth(), s);
  s.state.contracts[0].scheduledVisits[0].completedDate = new Date('2026-01-15');
  s.state.contracts[0].scheduledVisits[1].completedDate = new Date('2026-04-12');

  await assert.rejects(
    () => contractService.renewContract('c1', {}, auth({ role: 'finance', userId: 'fin' }), s),
    (e) => e.code === 'FORBIDDEN'
  );
  await assert.rejects(
    () => contractService.renewContract('c1', { startDate: '2027-01-01', endDate: '2026-06-01' }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR'
  );

  const renewed = await contractService.renewContract('c1', { amount: 26000 }, auth(), s);
  assert.equal(renewed.id, 'c1', 'still the same client');
  assert.equal(new Date(renewed.startDate).toISOString().slice(0, 10), '2027-01-01');
  assert.equal(new Date(renewed.endDate).toISOString().slice(0, 10), '2027-12-31');
  assert.equal(renewed.amount, 26000);
  assert.equal(renewed.payment.status, 'Pending');
  assert.equal(renewed.scheduledVisits.length, 4);
  assert.ok(renewed.scheduledVisits.every((v) => !v.completedDate));
  assert.equal(renewed.renewals.length, 1);
  assert.equal(renewed.renewals[0].payment.status, 'Paid');
  assert.equal(renewed.renewals[0].visits.filter((v) => v.completedDate).length, 2);

  // The history keeps counting the earlier period's visits.
  const h = await contractService.getClientHistory('c1', auth(), s);
  assert.equal(h.stats.amcVisitsScheduled, 8);
  assert.equal(h.stats.amcVisitsDone, 2);
});

/* ================= 4. The AMC letter ================= */

const amcDocuments = require('../src/services/amcDocumentService');

test('AMC letter — only once paid; a real PDF behind an unguessable link; renewal retires the old link', async () => {
  const s = store({ contracts: [contract()] });

  await assert.rejects(
    () => amcDocuments.getLetterLink('co1', 'c1', auth(), s),
    (e) => e.code === 'NOT_PAID'
  );
  await assert.rejects(
    () => amcDocuments.getLetterLink('co1', 'c1', auth({ role: 'service_eng', userId: 'eng1' }), s),
    (e) => e.code === 'FORBIDDEN'
  );

  await contractService.markAmcPaid('c1', { mode: 'UPI' }, auth(), s);
  const { letterToken } = await amcDocuments.getLetterLink('co1', 'c1', auth(), s);
  assert.match(letterToken, /^[a-f0-9]{48}$/);
  assert.equal((await amcDocuments.getLetterLink('co1', 'c1', auth(), s)).letterToken, letterToken, 'stable while paid');

  const { filename, pdf } = await amcDocuments.renderPublicAmcLetter(letterToken, s);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
  assert.match(filename, /^AMC-Letter-Salvation-Army\.pdf$/);

  // Renewal: the new period is unpaid, so last year's link stops working.
  await contractService.renewContract('c1', {}, auth(), s);
  await assert.rejects(() => amcDocuments.renderPublicAmcLetter(letterToken, s), (e) => e.status === 404);
  await assert.rejects(() => amcDocuments.getLetterLink('co1', 'c1', auth(), s), (e) => e.code === 'NOT_PAID');

  // Paid again: a fresh link.
  await contractService.markAmcPaid('c1', {}, auth(), s);
  const { letterToken: fresh } = await amcDocuments.getLetterLink('co1', 'c1', auth(), s);
  assert.notEqual(fresh, letterToken);

  for (const bad of ['', 'x', '../etc', '0'.repeat(48)]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(() => amcDocuments.renderPublicAmcLetter(bad, s), (e) => e.status === 404);
  }
});

/* ================= 5. Sending from the company WhatsApp ================= */

test('engineer completes → the service manager is asked to send the report; only they can mark it sent', async () => {
  const s = store();
  const eng = auth({ userId: 'eng1', role: 'service_eng', name: 'Anas' });
  const { serviceCall } = await service.registerComplaint({ customer: 'Walk-in', phone: '9000000009' }, auth(), s);
  await service.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth(), s);

  // Not completed yet: nothing to send, and it cannot be marked sent.
  assert.equal((await service.listReportsToSend(auth(), s)).length, 0);
  await assert.rejects(() => service.markReportSent(serviceCall.id, auth(), s), (e) => e.code === 'NOT_COMPLETED');

  const { serviceCall: done } = await service.completeServiceCall(serviceCall.id, { ...FILLED_REPORT, clientSignatureImage: SIGNATURE }, eng, s);
  assert.equal(done.reportSendStatus, 'Pending');
  assert.ok(done.reportSendRequestedAt);

  // The completion notification is the manager's request, and opens the call on their phone.
  const n = s.state.notifications.find((x) => /completed by Anas/.test(x.text));
  assert.deepEqual(n.targetRoles, ['service_mgr', 'admin']);

  const queue = await service.listReportsToSend(auth(), s);
  assert.deepEqual(queue.map((c) => [c.id, c.engineer]), [[serviceCall.id, 'Anas']]);

  // The engineer cannot see the queue or mark it sent — they do not hold the company number.
  await assert.rejects(() => service.listReportsToSend(eng, s), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.markReportSent(serviceCall.id, eng, s), (e) => e.code === 'FORBIDDEN');

  const sent = await service.markReportSent(serviceCall.id, auth(), s);
  assert.equal(sent.reportSendStatus, 'Sent');
  assert.equal(String(sent.reportSentByUserId), 'mgr');
  assert.ok(sent.reportSentAt);
  assert.equal((await service.listReportsToSend(auth(), s)).length, 0, 'gone from the queue');
});

test('the completion notification carries the call page for the phone push', async () => {
  const pushService = require('../src/services/pushService');
  const s = store();
  const jobs = [];
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const batch = JSON.parse(opts.body);
    calls.push(batch);
    return { ok: true, status: 200, json: async () => ({ data: batch.map(() => ({ status: 'ok' })) }) };
  };
  await pushService.registerDevice({ token: 'ExponentPushToken[manager-phone-0001]' }, auth(), s);
  const deps = { ...s, notificationRepo: pushService.withPushNotifications(s.notificationRepo, s, { fetchImpl, logger: { warn() {} }, schedule: (fn) => jobs.push(fn) }) };
  const { serviceCall } = await service.registerComplaint({ customer: 'Walk-in' }, auth(), deps);
  await service.completeServiceCall(serviceCall.id, { ...FILLED_REPORT, clientSignatureImage: SIGNATURE }, auth(), deps);
  for (const j of jobs) await j(); // eslint-disable-line no-await-in-loop
  const msg = calls.flat().find((m) => /completed by/.test(m.body));
  assert.ok(msg, 'the service manager’s phone is pushed');
  assert.equal(msg.data.path, `/service-calls/${serviceCall.id}`);
});

test('company WhatsApp number — saved as digits; rubbish refused', async () => {
  const { updateMyCompanyProfile } = require('../src/services/companyService');
  const { createDevRepositories } = require('../src/devServer');
  const s = createDevRepositories();
  s.store.state.companies.push({ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC'], status: 'Active' });
  const saved = await updateMyCompanyProfile('co1', { whatsappNumber: '+91 74473 33377' }, s);
  assert.equal(saved.whatsappNumber, '917447333377');
  const plain = await updateMyCompanyProfile('co1', { whatsappNumber: '7447333377' }, s);
  assert.equal(plain.whatsappNumber, '7447333377');
  await assert.rejects(() => updateMyCompanyProfile('co1', { whatsappNumber: 'call me' }, s), (e) => e.code === 'INVALID_PROFILE');
  await assert.rejects(() => updateMyCompanyProfile('co1', { whatsappNumber: '12345' }, s), (e) => e.code === 'INVALID_PROFILE');
  const cleared = await updateMyCompanyProfile('co1', { whatsappNumber: '' }, s);
  assert.equal(cleared.whatsappNumber, '');
});

/* ================= HTTP: every new route, with its login and role gates ================= */

test('HTTP — client picker, history, payment, renewal, AMC letter, reports to send', async () => {
  const { createDevApp, createDevRepositories } = require('../src/devServer');
  const { hashPassword } = require('../src/auth/passwordHasher');
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({
    id: 'coA', name: 'MEP Powertech', divisions: ['HVAC'], status: 'Active', whatsappNumber: '7447333377',
    subscriptionRate: 1, subscriptionCycle: 'Monthly', subscriptionStart: new Date('2026-01-01'),
    subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  });
  const pw = await hashPassword('pw-123456');
  state.users.push({ id: 'uM', companyId: 'coA', username: 'mgr', name: 'Mukund', role: 'service_mgr', passwordHash: pw, active: true });
  state.users.push({ id: 'uE', companyId: 'coA', username: 'eng', name: 'Anas', role: 'service_eng', passwordHash: pw, active: true });
  state.contracts.push({ ...contract({ id: 'k1', companyId: 'coA', endDate: new Date(Date.now() + 200 * 86400000) }) });

  const app = createDevApp(deps, { authTokenSecret: 'amc-client-http-test', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (u) => (await (await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'pw-123456' }),
  })).json()).token;
  const call = async (method, path, token, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };

  try {
    const M = await login('mgr');
    const E = await login('eng');

    // logins required
    for (const p of ['/api/contracts/clients', '/api/contracts/k1/history', '/api/service-calls/reports-to-send']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await call('GET', p)).status, 401, p);
    }

    // client picker ("clients" is not mistaken for a contract id)
    const picker = await call('GET', '/api/contracts/clients?q=salvation', M);
    assert.equal(picker.status, 200);
    assert.deepEqual(picker.json.clients.map((c) => [c.id, c.status]), [['k1', 'Active']]);

    // complaint for the client
    const reg = await call('POST', '/api/service-calls/complaints', M, { contractId: 'k1', complaintDescription: 'No cooling' });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.serviceCall.coverage, 'AMC');
    const scId = reg.json.serviceCall.id;
    assert.equal((await call('PUT', `/api/service-calls/${scId}/assign`, M, { engineerId: 'uE' })).status, 200);

    // engineer completes with parts + gas
    const done = await call('POST', `/api/service-calls/${scId}/complete`, E, {
      ...FILLED_REPORT, partsWork: [{ part: 'Capacitor', action: 'Replaced' }], gasFilled: true, gasType: 'R32', gasQtyKg: 1,
      clientSignatureImage: SIGNATURE,
    });
    assert.equal(done.status, 200);
    assert.equal(done.json.serviceCall.reportSendStatus, 'Pending');

    // the manager's queue; the engineer has none
    assert.equal((await call('GET', '/api/service-calls/reports-to-send', E)).status, 403);
    const queue = await call('GET', '/api/service-calls/reports-to-send', M);
    assert.deepEqual(queue.json.serviceCalls.map((c) => c.id), [scId]);
    assert.equal((await call('POST', `/api/service-calls/${scId}/report-sent`, E)).status, 403);
    assert.equal((await call('POST', `/api/service-calls/${scId}/report-sent`, M)).json.serviceCall.reportSendStatus, 'Sent');

    // history
    const hist = await call('GET', '/api/contracts/k1/history', M);
    assert.equal(hist.status, 200);
    assert.equal(hist.json.stats.partsReplaced, 1);
    assert.equal(hist.json.stats.gasFills, 1);
    assert.equal(hist.json.calls[0].id, scId);

    // AMC letter: not before paid; engineer cannot record payment
    assert.equal((await call('GET', '/api/contracts/k1/letter-link', M)).status, 400);
    assert.equal((await call('POST', '/api/contracts/k1/payment', E, { mode: 'UPI' })).status, 403);
    const paid = await call('POST', '/api/contracts/k1/payment', M, { mode: 'UPI', reference: 'UTR9' });
    assert.equal(paid.status, 200);
    assert.equal(paid.json.contract.payment.status, 'Paid');
    const link = await call('GET', '/api/contracts/k1/letter-link', M);
    assert.equal(link.status, 200);
    const pdf = await fetch(`${base}/api/public/amc-letters/${link.json.letterToken}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${base}/api/public/amc-letters/${'0'.repeat(48)}`)).status, 404);

    // renew: engineer cannot; manager can; old letter link retired
    assert.equal((await call('POST', '/api/contracts/k1/renew', E, {})).status, 403);
    const ren = await call('POST', '/api/contracts/k1/renew', M, { amount: 26000 });
    assert.equal(ren.status, 200);
    assert.equal(ren.json.contract.renewals.length, 1);
    assert.equal((await fetch(`${base}/api/public/amc-letters/${link.json.letterToken}`)).status, 404);
  } finally {
    server.close();
  }
});
