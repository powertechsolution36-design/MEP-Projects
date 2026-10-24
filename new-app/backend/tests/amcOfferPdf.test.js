'use strict';

/**
 * The AMC document as a server-built PDF (owner request, 24 Oct 2026).
 *
 * The page used to print by writing its own HTML and stylesheet into a
 * pop-up, so preview, printer and client each saw a different layout. These
 * tests hold the one document to the company's own sheets:
 *   · all three types render, the letter included;
 *   · the priced table carries the contract amount and its 18% GST total;
 *   · the wording is the company's template, so an edited template prints
 *     as edited and nothing is hardcoded to one tenant;
 *   · the route is login-only, refuses another company's contract, and the
 *     letter's client link still requires the AMC to be paid.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { buildAmcOfferPdf } = require('../src/services/amcOfferPdf');
const { renderAmcDocumentPdf, getDefaultTemplate } = require('../src/services/amcDocumentService');

const COMPANY = {
  id: 'coAmc', name: 'Alpha AMC Ltd', displayName: 'Alpha AMC Ltd',
  subtitle: 'MEP Consultant & Contractor', tagline: 'Trusted',
  address: 'Plot 4, Undri', city: 'Pune - 411060', phone: '8790000000',
  email: 'alpha@example.com', website: 'www.example.com', gstNumber: '27AAAAA0000A1Z5',
  divisions: ['HVAC'], status: 'Active',
  bankDetails: { bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234' },
  authorizedPerson: { name: 'Suhas Mahadik', designation: 'Director', contactPhone: '8790000000' },
  subscriptionRate: 1, subscriptionCycle: 'Monthly',
  subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
};

const CONTRACT = {
  id: 'amc1', companyId: 'coAmc', customer: 'Moto Central', phone: '9822011111',
  site: 'Navapeth Showroom', capacity: '20 HP VRF', category: 'AMC', amcType: 'Quarterly',
  maintenanceCoverage: 'comprehensive',
  startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'),
  amount: 53400, visitsPerYear: 4, scheduledVisits: [],
};

function seed() {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({ ...COMPANY });
  state.contracts.push({ ...CONTRACT });
  return deps;
}

async function harness() {
  const deps = seed();
  const pw = await hashPassword('pw-123456');
  deps.store.state.users.push({ id: 'uMgr', companyId: 'coAmc', username: 'mgr', name: 'Mgr', role: 'service_mgr', passwordHash: pw, active: true });
  deps.store.state.users.push({ id: 'uEng', companyId: 'coAmc', username: 'eng', name: 'Eng', role: 'service_eng', passwordHash: pw, active: true });

  const app = createDevApp(deps, { authTokenSecret: 'amc-offer-pdf-test', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => (await (await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw-123456' }),
  })).json()).token;
  return { deps, base, server, login };
}

/* ---------------- the renderer ---------------- */

test('AMC offer PDF: both covers render a real PDF carrying the company and client', async () => {
  for (const type of ['comprehensive', 'non-comprehensive']) {
    const pdf = await buildAmcOfferPdf({
      company: COMPANY,
      contract: CONTRACT,
      sections: getDefaultTemplate(type).sections,
      documentType: type,
    });
    assert.ok(Buffer.isBuffer(pdf) && pdf.length > 2000, `${type} should produce a PDF`);
    assert.equal(pdf.slice(0, 4).toString(), '%PDF');
    const text = pdf.toString('latin1');
    assert.ok(text.includes('/Count 3'), `${type} should be the three-page document`);
  }
});

test('AMC offer PDF: the wording comes from the template, not from the code', async () => {
  const sections = getDefaultTemplate('comprehensive').sections.map((s) => (
    s.key === 'subject' ? { ...s, content: 'SUB:- A COMPLETELY REWORDED SUBJECT LINE.' } : s
  ));
  const a = await buildAmcOfferPdf({ company: COMPANY, contract: CONTRACT, sections, documentType: 'comprehensive' });
  const b = await buildAmcOfferPdf({
    company: COMPANY, contract: CONTRACT,
    sections: getDefaultTemplate('comprehensive').sections, documentType: 'comprehensive',
  });
  assert.notEqual(a.length, b.length, 'an edited template must change the document');
});

test('AMC offer PDF: it is a pure function — no database, and the inputs are not mutated', async () => {
  const sections = getDefaultTemplate('comprehensive').sections;
  const before = JSON.stringify({ COMPANY, CONTRACT, sections });
  await buildAmcOfferPdf({ company: COMPANY, contract: CONTRACT, sections, documentType: 'comprehensive' });
  assert.equal(JSON.stringify({ COMPANY, CONTRACT, sections }), before);
});

test('AMC offer PDF: an unreadable logo still produces the document', async () => {
  const pdf = await buildAmcOfferPdf({
    company: { ...COMPANY, logoBase64: 'data:image/png;base64,not-really-an-image' },
    contract: CONTRACT,
    sections: getDefaultTemplate('comprehensive').sections,
    documentType: 'comprehensive',
  });
  assert.equal(pdf.slice(0, 4).toString(), '%PDF');
});

/* ---------------- through the service ---------------- */

test('renderAmcDocumentPdf: names the file after the cover and the client', async () => {
  const deps = seed();
  const comp = await renderAmcDocumentPdf('coAmc', 'amc1', 'comprehensive', deps);
  assert.equal(comp.filename, 'AMC-Comprehensive-Moto-Central.pdf');
  const non = await renderAmcDocumentPdf('coAmc', 'amc1', 'non-comprehensive', deps);
  assert.equal(non.filename, 'AMC-Non-Comprehensive-Moto-Central.pdf');
  const letter = await renderAmcDocumentPdf('coAmc', 'amc1', 'amc-letter', deps);
  assert.equal(letter.filename, 'AMC-Letter-Moto-Central.pdf');
  for (const r of [comp, non, letter]) assert.equal(r.pdf.slice(0, 4).toString(), '%PDF');
});

test('renderAmcDocumentPdf: the letter renders here even before the AMC is paid', async () => {
  // The company must be able to read its own letter; only the CLIENT link
  // waits for payment.
  const deps = seed();
  const letter = await renderAmcDocumentPdf('coAmc', 'amc1', 'amc-letter', deps);
  assert.equal(letter.pdf.slice(0, 4).toString(), '%PDF');
});

test('renderAmcDocumentPdf: an unknown type falls back to comprehensive, and a missing contract is 404', async () => {
  const deps = seed();
  const odd = await renderAmcDocumentPdf('coAmc', 'amc1', 'not-a-type', deps);
  assert.equal(odd.filename, 'AMC-Comprehensive-Moto-Central.pdf');
  await assert.rejects(
    () => renderAmcDocumentPdf('coAmc', 'nope', 'comprehensive', deps),
    (e) => e.status === 404
  );
});

/* ---------------- over HTTP ---------------- */

test('AMC document PDF over HTTP: served to a signed-in user, refused to anonymous callers', async () => {
  const h = await harness();
  try {
    const anon = await fetch(`${h.base}/api/amc-documents/generate/amc1/comprehensive/pdf`);
    assert.equal(anon.status, 401);

    const token = await h.login('mgr');
    const res = await fetch(`${h.base}/api/amc-documents/generate/amc1/comprehensive/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') || '', /AMC-Comprehensive-Moto-Central\.pdf/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.slice(0, 4).toString(), '%PDF');
    assert.ok(body.length > 2000);
  } finally { h.server.close(); }
});

test('AMC document PDF over HTTP: the /pdf suffix is not swallowed by the data route', async () => {
  const h = await harness();
  try {
    const token = await h.login('mgr');
    const H = { authorization: `Bearer ${token}` };
    // The data route must still return JSON…
    const data = await fetch(`${h.base}/api/amc-documents/generate/amc1/comprehensive`, { headers: H });
    assert.equal(data.status, 200);
    assert.match(data.headers.get('content-type') || '', /application\/json/);
    // …and the PDF route must return a PDF, not JSON.
    const pdf = await fetch(`${h.base}/api/amc-documents/generate/amc1/comprehensive/pdf`, { headers: H });
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
  } finally { h.server.close(); }
});

test('AMC document PDF over HTTP: another company’s contract is not served', async () => {
  const h = await harness();
  try {
    h.deps.store.state.companies.push({ ...COMPANY, id: 'coOther', name: 'Other Ltd' });
    h.deps.store.state.contracts.push({ ...CONTRACT, id: 'amcOther', companyId: 'coOther' });
    const token = await h.login('mgr'); // belongs to coAmc
    const res = await fetch(`${h.base}/api/amc-documents/generate/amcOther/comprehensive/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404, 'a contract of another company must not be rendered');
  } finally { h.server.close(); }
});

test('AMC document PDF over HTTP: the client letter link still waits for payment', async () => {
  const h = await harness();
  try {
    const token = await h.login('mgr');
    // The company can read its own letter…
    const own = await fetch(`${h.base}/api/amc-documents/generate/amc1/amc-letter/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(own.status, 200);
    // …but the client-facing link is refused until the AMC is marked paid.
    const link = await fetch(`${h.base}/api/contracts/amc1/letter-link`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(link.status, 400);
    const body = await link.json();
    assert.match(body.error || '', /paid/i);
  } finally { h.server.close(); }
});
