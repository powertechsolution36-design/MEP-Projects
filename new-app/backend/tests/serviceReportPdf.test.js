'use strict';

/**
 * Service Report PDF (owner decision 21 Oct 2026): a completed Complaint or
 * AMC/PM call is sent to the client as a PDF via an unguessable link.
 * Unit tests on the service + PDF builder (in-memory fakes) and HTTP tests
 * through the dev assembly. No live database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/serviceCallService');
const { buildServiceReportPdf, imageBuffer } = require('../src/services/serviceReportPdf');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FILLED = {
  serviceDescription: 'Cleaned filters, checked gas pressure',
  checklistResults: Object.fromEntries(service.CHECKLIST_KEYS.map((k) => [k, k === 'Outdoor Coil' ? 'Not done' : 'Done'])),
  make: 'Daikin',
  serviceType: 'Chargeable',
  amount: 1500,
};

function auth(o) {
  return { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin One', ...o };
}
function store() {
  return createEnquiryFakeStore({
    companies: [
      { id: 'co1', name: 'MEP Powertech Pvt Ltd', displayName: 'MEP Powertech Pvt Ltd', address: 'Pune', gstNumber: '27ABCDE1234F1Z5', logoBase64: PNG, divisions: ['HVAC'], status: 'Active' },
      { id: 'co2', name: 'Other Co', divisions: ['HVAC'], status: 'Active' },
    ],
  });
}

test('completion stamps an unguessable report token and completion time', async () => {
  const s = store();
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya', phone: '9822000000' }, auth(), s);
  const res = await service.completeServiceCall(serviceCall.id, { ...FILLED, signature: PNG }, auth(), s);
  assert.match(res.reportToken, /^[a-f0-9]{48}$/);
  assert.equal(res.serviceCall.reportToken, res.reportToken);
  assert.ok(!Number.isNaN(new Date(res.serviceCall.completedAt).getTime()));
});

test('getReportLink — only for completed calls, tenant-scoped, and back-fills older completed calls once', async () => {
  const s = store();
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya' }, auth(), s);
  await assert.rejects(() => service.getReportLink(serviceCall.id, auth(), s), (e) => e.code === 'NOT_COMPLETED' && e.status === 400);
  await service.completeServiceCall(serviceCall.id, { ...FILLED, signature: PNG }, auth(), s);
  const { reportToken } = await service.getReportLink(serviceCall.id, auth({ role: 'engineer', userId: 'e9' }), s);
  assert.match(reportToken, /^[a-f0-9]{48}$/);
  // Another company cannot see it.
  await assert.rejects(() => service.getReportLink(serviceCall.id, auth({ companyId: 'co2' }), s), (e) => e.code === 'NOT_FOUND');
  // A call completed before this feature (no token) gets one, and keeps it.
  const legacy = s.state.serviceCalls.find((x) => x.id === serviceCall.id);
  delete legacy.reportToken;
  const first = await service.getReportLink(serviceCall.id, auth(), s);
  const second = await service.getReportLink(serviceCall.id, auth(), s);
  assert.match(first.reportToken, /^[a-f0-9]{48}$/);
  assert.equal(first.reportToken, second.reportToken);
});

test('renderPublicServiceReport — returns a PDF for a valid token, 404 for anything else', async () => {
  const s = store();
  const { serviceCall } = await service.registerComplaint({ customer: 'Priya', site: 'KP87' }, auth(), s);
  const { reportToken } = await service.completeServiceCall(serviceCall.id, { ...FILLED, signature: PNG }, auth(), s);
  const { filename, pdf } = await service.renderPublicServiceReport(reportToken, s);
  assert.equal(filename, `Service-Report-PSC-${serviceCall.complaintNumber}.pdf`);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  for (const bad of ['', 'abc', 'g'.repeat(48), 'a'.repeat(48), `${reportToken}x`, null]) {
    await assert.rejects(() => service.renderPublicServiceReport(bad, s), (e) => e.code === 'NOT_FOUND' && e.status === 404);
  }
});

test('PDF builder — tolerates a missing or non-PNG/JPEG logo and signature', async () => {
  const base = { complaintNumber: 7, type: 'PM', status: 'Completed', customer: 'X', report: { ...FILLED, serviceType: 'AMC' } };
  for (const logo of ['', 'data:image/svg+xml;base64,PHN2Zz4=', 'not-an-image', PNG]) {
    const pdf = await buildServiceReportPdf({ company: { name: 'Co', logoBase64: logo }, serviceCall: { ...base, clientSignatureImage: logo }, engineerName: 'Israr' });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal(imageBuffer('data:image/webp;base64,AAAA'), null);
  assert.ok(imageBuffer(PNG));
});

/* ---------------- HTTP ---------------- */

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('HTTP — the public PDF needs no login; the link route needs one', async () => {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({ id: 'coA', name: 'Alpha HVAC', divisions: ['HVAC'], status: 'Active', subscriptionRate: 1, subscriptionCycle: 'Monthly', subscriptionStart: new Date('2026-01-01'), since: new Date('2026-01-01') });
  state.users.push({ id: 'uA', companyId: 'coA', username: 'mgr', name: 'Manager', role: 'service_mgr', passwordHash: await hashPassword('pw-123456'), active: true });
  const app = createDevApp(deps, { authTokenSecret: 'service-report-test-secret', authTokenExpiry: '1h', port: 0 });
  const { server, base } = await listen(app);
  try {
    const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'mgr', password: 'pw-123456' }) })).json();
    const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
    const reg = await (await fetch(`${base}/api/service-calls/complaints`, { method: 'POST', headers: H, body: JSON.stringify({ customer: 'Priya', phone: '9822000000' }) })).json();
    const id = reg.serviceCall.id;
    const comp = await fetch(`${base}/api/service-calls/${id}/complete`, { method: 'POST', headers: H, body: JSON.stringify({ ...FILLED, clientSignatureImage: PNG }) });
    assert.equal(comp.status, 200);
    const compJson = await comp.json();
    assert.match(compJson.reportToken, /^[a-f0-9]{48}$/);

    assert.equal((await fetch(`${base}/api/service-calls/${id}/report-link`)).status, 401);
    const link = await (await fetch(`${base}/api/service-calls/${id}/report-link`, { headers: H })).json();
    assert.equal(link.reportToken, compJson.reportToken);

    const pdf = await fetch(`${base}/api/public/service-reports/${link.reportToken}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /Service-Report-PSC-\d+\.pdf/);
    assert.equal(pdf.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

    const miss = await fetch(`${base}/api/public/service-reports/${'0'.repeat(48)}`);
    assert.equal(miss.status, 404);
    assert.equal(await miss.text(), 'Service report not found.');
  } finally {
    server.close();
  }
});
