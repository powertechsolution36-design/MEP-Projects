'use strict';

/**
 * Quotation PDF + the customer-facing link (owner decision, 22 Oct 2026).
 *
 * The old "Print / Save as PDF" button opened a pop-up window, which the
 * Android app's web view blocks, so nothing happened. The PDF is now built
 * on the server and fetched through an unguessable token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQuotationPdf } = require('../src/services/quotationPdf');
const quotationService = require('../src/services/quotationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');

const COMPANY = {
  id: 'co1',
  name: 'MEP Powertech PVT. LTD.',
  displayName: 'MEP Powertech PVT. LTD.',
  subtitle: 'HVAC · MEP · Solar',
  address: 'Pune',
  city: 'Pune',
  phone: '020-0000000',
  email: 'info@example.com',
  gstNumber: '27AAAAA0000A1Z5',
  divisions: ['HVAC', 'Solar', 'MEP'],
  status: 'Active',
  bankDetails: { bankName: 'Demo Bank', accountNumber: '1234', ifscCode: 'DEMO0001', accountHolderName: 'MEP Powertech' },
  authorizedPerson: { name: 'Suhas', designation: 'Director' },
};

function hvacQuotation(extra = {}) {
  return {
    id: 'q1',
    companyId: 'co1',
    quotationNumber: 'QTN-0001',
    revision: 0,
    division: 'HVAC',
    status: 'Draft',
    customerName: 'Regal Elegance LLP',
    customerAddress: 'Baner, Pune',
    customerPhone: '9000000000',
    customerGst: '27BBBBB1111B1Z5',
    subject: 'Supply and installation of inverter AC units',
    system: 'Split AC',
    capacity: '1 TR',
    date: new Date('2026-10-22'),
    equipmentItems: [
      { sNo: 1, description: '1 TR samsung make inverter AC', unit: 'Nos', qty: 1, supplyRate: 28389, installationRate: 1600, supplyAmount: 28389, installationAmount: 1600, totalAmount: 29989, gstPercent: null, gstAmount: 0, amountWithGst: 29989 },
    ],
    accessoriesItems: [],
    equipmentSupplyTotal: 28389,
    equipmentInstallTotal: 1600,
    equipmentTotal: 29989,
    accessoriesSupplyTotal: 0,
    accessoriesInstallTotal: 0,
    accessoriesTotal: 0,
    subtotal: 29989,
    gstPercent: 18,
    gstAmount: 5398,
    grandTotal: 35387,
    paymentTerms: [{ sequence: 1, section: '', label: 'Advance', percentage: '100', triggerEvent: '', wording: '' }],
    excludedWorks: ['Civil work'],
    offerValidity: '15 days',
    notes: 'Prices are ex-works.',
    designBy: 'Deepak',
    systemApprovedBy: 'Suhas',
    ...extra,
  };
}

function solarQuotation() {
  return hvacQuotation({
    quotationNumber: 'QTN-0002',
    division: 'Solar',
    gstPercent: null,
    equipmentItems: [
      { sNo: 1, description: '5 kW solar panel set', unit: 'Nos', qty: 1, supplyRate: 200000, installationRate: 0, supplyAmount: 200000, installationAmount: 0, totalAmount: 200000, gstPercent: 12, gstAmount: 24000, amountWithGst: 224000 },
    ],
    subtotal: 200000,
    gstAmount: 24000,
    grandTotal: 224000,
  });
}

test('buildQuotationPdf — produces a real PDF for an HVAC quotation', async () => {
  const pdf = await buildQuotationPdf({ company: COMPANY, quotation: hvacQuotation() });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000, `PDF looks empty (${pdf.length} bytes)`);
});

test('buildQuotationPdf — Solar quotation (flat per-item GST table) also renders', async () => {
  const pdf = await buildQuotationPdf({ company: COMPANY, quotation: solarQuotation() });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('buildQuotationPdf — an empty quotation and a missing company never throw', async () => {
  const bare = await buildQuotationPdf({
    company: {},
    quotation: { quotationNumber: 'QTN-0003', division: 'MEP', equipmentItems: [], accessoriesItems: [] },
  });
  assert.equal(bare.subarray(0, 5).toString(), '%PDF-');
  const nothing = await buildQuotationPdf({});
  assert.equal(nothing.subarray(0, 5).toString(), '%PDF-');
});

test('buildQuotationPdf — a long quotation runs onto further pages', async () => {
  const many = hvacQuotation({
    equipmentItems: Array.from({ length: 60 }, (_, i) => ({
      sNo: i + 1, description: `Indoor unit ${i + 1} — ducted, with drain pump and wired controller`,
      unit: 'Nos', qty: 2, supplyRate: 41000, installationRate: 2500,
      supplyAmount: 82000, installationAmount: 5000, totalAmount: 87000,
    })),
  });
  const pdf = await buildQuotationPdf({ company: COMPANY, quotation: many });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10000, 'a 60-line quotation should be a substantial PDF');
});

test('Ducted/VRF rows — headings and specifications carry no price, only items are numbered', async () => {
  const { calculateLineTotals, calculateTotals } = quotationService;
  const rows = calculateLineTotals([
    { rowType: 'heading', description: 'OUTDOOR UNITS' },
    { rowType: 'spec', description: 'Supply of Ducted Outdoor machines …', qty: 5, supplyRate: 999 },
    { description: '17 TR Ductable Units (R410a)', unit: 'Nos', qty: 9, supplyRate: 271980, installationRate: 0 },
    { rowType: 'heading', description: 'Supply & Installation of Ducting & Accessories' },
    { rowType: 'sub', description: '24 G', unit: 'Sq.m', qty: 598, supplyRate: 700, installationRate: 250 },
    { rowType: 'sub', description: '22 G', unit: 'Sq.m', qty: 237, supplyRate: 750, installationRate: 250 },
    { description: 'Supply Air Grills with Damper', unit: 'Sq.m', qty: 7, supplyRate: 3870, installationRate: 750 },
    { rowType: 'nonsense', description: 'unknown kind falls back to a priced item', qty: 1, supplyRate: 100 },
  ], 'HVAC');

  assert.deepEqual(rows.map((r) => [r.rowType, r.sNo]), [
    ['heading', null], ['spec', null], ['item', 1], ['heading', null],
    ['sub', null], ['sub', null], ['item', 2], ['item', 3],
  ]);
  // A heading or spec row never carries money, even if a price was sent.
  const spec = rows[1];
  assert.deepEqual(
    [spec.qty, spec.supplyRate, spec.supplyAmount, spec.installationAmount, spec.totalAmount],
    [0, 0, 0, 0, 0]
  );
  assert.equal(rows[2].supplyAmount, 9 * 271980);
  assert.equal(rows[4].installationAmount, 598 * 250);

  // Totals count the priced rows only.
  const t = calculateTotals(rows, [], 18, 'HVAC');
  const expectedSupply = 9 * 271980 + 598 * 700 + 237 * 750 + 7 * 3870 + 100;
  assert.equal(t.equipmentSupplyTotal, expectedSupply);
  assert.equal(t.equipmentInstallTotal, 598 * 250 + 237 * 250 + 7 * 750);

  const pdf = await buildQuotationPdf({
    company: COMPANY,
    quotation: { ...hvacQuotation(), equipmentItems: rows, accessoriesItems: [], ...t },
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('per-item GST on the high side — each line at its own %, blanks at the quotation’s', async () => {
  const { calculateLineTotals, calculateTotals, usesPerItemGst } = quotationService;

  const eq = calculateLineTotals([
    { rowType: 'heading', description: 'OUTDOOR UNITS' },
    { description: '2 TR Split AC', unit: 'Nos', qty: 6, supplyRate: 42600, installationRate: 1600, gstPercent: 28 },
    { description: '17 TR Ductable', unit: 'Nos', qty: 9, supplyRate: 271980, installationRate: 0, gstPercent: 18 },
    { description: 'Controller — no GST set', unit: 'Nos', qty: 2, supplyRate: 5000, installationRate: 0 },
  ], 'HVAC');
  const acc = calculateLineTotals([
    { description: 'Copper pipe', unit: 'Rmt', qty: 11, supplyRate: 850, installationRate: 150 },
  ], 'HVAC');
  assert.equal(usesPerItemGst(eq), true);
  assert.equal(usesPerItemGst(acc), false, 'the low side sets no GST of its own here');

  const t = calculateTotals(eq, acc, 18, 'HVAC');
  const eqExpected = Math.round(6 * 44200 * 0.28) + Math.round(9 * 271980 * 0.18) + Math.round(2 * 5000 * 0.18);
  const accExpected = Math.round(11 * 1000 * 0.18);
  assert.equal(t.equipmentGstAmount, eqExpected);
  assert.equal(t.accessoriesGstAmount, accExpected, 'a line with no GST of its own uses the quotation’s %');
  assert.equal(t.gstAmount, eqExpected + accExpected);
  assert.equal(t.grandTotal, t.subtotal + t.gstAmount);
  assert.equal(t.gstPercent, 18, 'the quotation keeps its own % as the fallback for blank lines');

  const pdf = await buildQuotationPdf({
    company: COMPANY,
    quotation: { ...hvacQuotation(), equipmentItems: eq, accessoriesItems: acc, ...t },
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('per-item GST — a quotation that sets none is completely unchanged', () => {
  const { calculateLineTotals, calculateTotals } = quotationService;
  const eq = calculateLineTotals([{ description: 'A', qty: 1, supplyRate: 5000, installationRate: 2000 }], 'HVAC');
  const acc = calculateLineTotals([{ description: 'B', qty: 1, supplyRate: 1000, installationRate: 500 }], 'HVAC');
  const t = calculateTotals(eq, acc, 18, 'HVAC');
  // Exactly the figures this has always produced: one GST % on the subtotal.
  assert.equal(t.subtotal, 8500);
  assert.equal(t.gstAmount, 1530);
  assert.equal(t.grandTotal, 10030);
  assert.equal(t.gstPercent, 18);
  assert.equal(calculateTotals(eq, acc, 0, 'HVAC').gstAmount, 0, '0% GST is still a valid choice');
});

test('buildQuotationPdf — an unreadable logo is skipped, not fatal', async () => {
  const pdf = await buildQuotationPdf({
    company: { ...COMPANY, logoBase64: 'data:image/png;base64,bm90LWFuLWltYWdl' },
    quotation: hvacQuotation(),
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('getPdfLink — mints a token once and reuses it; renderPublicQuotation serves that quotation', async () => {
  const s = createEnquiryFakeStore({ companies: [COMPANY], users: [{ id: 'u1', companyId: 'co1', role: 'admin', name: 'Admin' }] });
  s.state.quotations.push(hvacQuotation());

  const first = await quotationService.getPdfLink('co1', 'q1', s);
  assert.match(first.pdfToken, /^[a-f0-9]{48}$/);
  const second = await quotationService.getPdfLink('co1', 'q1', s);
  assert.equal(second.pdfToken, first.pdfToken, 'the token must not change between requests');

  const { filename, pdf } = await quotationService.renderPublicQuotation(first.pdfToken, s);
  assert.equal(filename, 'Quotation-QTN-0001.pdf');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  await assert.rejects(() => quotationService.getPdfLink('co1', 'nope', s), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => quotationService.getPdfLink('co2', 'q1', s), (e) => e.code === 'NOT_FOUND');
});

test('renderPublicQuotation — a malformed or unknown token is a plain 404', async () => {
  const s = createEnquiryFakeStore({ companies: [COMPANY], users: [] });
  s.state.quotations.push(hvacQuotation());
  for (const token of ['', 'x', '../etc/passwd', 'A'.repeat(48), '0'.repeat(47), '0'.repeat(48)]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(() => quotationService.renderPublicQuotation(token, s), (e) => e.status === 404, `token ${token}`);
  }
});

test('HTTP — the PDF link needs a login; the PDF itself does not', async () => {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({
    ...COMPANY, id: 'coA', subscriptionRate: 1, subscriptionCycle: 'Monthly',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  });
  state.users.push({ id: 'uA', companyId: 'coA', username: 'sales', name: 'Sales', role: 'sales', passwordHash: await hashPassword('pw-123456'), active: true });
  state.quotations.push(hvacQuotation({ companyId: 'coA' }));

  const app = createDevApp(deps, { authTokenSecret: 'quotation-pdf-test-secret', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/quotations/q1/pdf-link`)).status, 401);

    const login = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sales', password: 'pw-123456' }),
    })).json();
    const linkRes = await fetch(`${base}/api/quotations/q1/pdf-link`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(linkRes.status, 200);
    const { pdfToken } = await linkRes.json();
    assert.match(pdfToken, /^[a-f0-9]{48}$/);

    const pdfRes = await fetch(`${base}/api/public/quotations/${pdfToken}`);
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(pdfRes.headers.get('cache-control'), 'private, no-store');
    const body = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString(), '%PDF-');

    const missing = await fetch(`${base}/api/public/quotations/${'0'.repeat(48)}`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'Quotation not found.');
  } finally {
    server.close();
  }
});
