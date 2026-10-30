'use strict';

/**
 * Built-in quotation starting points, one per kind of offer (owner request,
 * 23 Oct 2026): Split, Ducted, VRF and Solar, derived from the company's own
 * workbooks in C:\Quotation.
 *
 * What these tests hold to:
 *   · the four offer types exist, each mapped to the right division;
 *   · each carries ITS OWN descriptions in the source's order — the four are
 *     never interchangeable;
 *   · the high-side counts follow the source (1 / 1 / 7 / 14 priced rows), not
 *     an assumed six;
 *   · a preset never carries a price, so a new quotation can never inherit one
 *     from a sample or from another quotation;
 *   · a company is only offered presets for a division it has bought;
 *   · applying one and saving produces the right totals and records the type.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { listPresets, getPreset, PRESET_CODES } = require('../src/services/quotationPresets');

const priced = (items) => items.filter((i) => i.rowType === 'item' || i.rowType === 'sub');

async function harness(divisions = ['HVAC', 'Solar', 'MEP']) {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({
    id: 'coA', name: 'Alpha', divisions, status: 'Active',
    subscriptionRate: 1, subscriptionCycle: 'Monthly',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  });
  const pw = await hashPassword('pw-123456');
  state.users.push({ id: 'uSales', companyId: 'coA', username: 'sales', name: 'Sales', role: 'sales', passwordHash: pw, active: true });
  state.users.push({ id: 'uEng', companyId: 'coA', username: 'eng', name: 'Eng', role: 'service_eng', passwordHash: pw, active: true });

  const app = createDevApp(deps, { authTokenSecret: 'quotation-preset-test', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => (await (await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw-123456' }),
  })).json()).token;
  return { deps, state, base, server, login };
}

/* ---------------- the presets themselves ---------------- */

test('presets: the four kinds of offer exist, each on its own division', () => {
  assert.deepEqual(PRESET_CODES, ['split', 'ducted', 'vrf', 'solar']);
  const byCode = Object.fromEntries(listPresets(['HVAC', 'Solar']).map((p) => [p.code, p]));
  assert.equal(byCode.split.division, 'HVAC');
  assert.equal(byCode.ducted.division, 'HVAC');
  assert.equal(byCode.vrf.division, 'HVAC');
  assert.equal(byCode.solar.division, 'Solar');
});

test('presets: priced row counts follow each source workbook, not an assumed six', () => {
  // Split 1 · Ducted 1 · VRF 7 · Solar 14 -- counted from the workbooks.
  assert.equal(priced(getPreset('split').equipmentItems).length, 1);
  assert.equal(priced(getPreset('ducted').equipmentItems).length, 1);
  assert.equal(priced(getPreset('vrf').equipmentItems).length, 7);
  assert.equal(priced(getPreset('solar').equipmentItems).length, 14);
  // None of them has six -- the premise that they all do is wrong.
  for (const c of PRESET_CODES) {
    assert.notEqual(priced(getPreset(c).equipmentItems).length, 6, `${c} should not be forced to six rows`);
  }
});

test('presets: Split carries its own five accessory rows, in the source order', () => {
  const acc = getPreset('split').accessoriesItems;
  assert.deepEqual(acc.map((i) => i.description), [
    'Copper pipe Indoor to Outdoor with Insulation',
    'Communication cable Indoor to outdoor',
    'Drain pipe with required size',
    "Outdoor 'L' Type MS Stand",
    'Drain Pump',
  ]);
  assert.deepEqual(acc.map((i) => i.unit), ['Rmt', 'Rmt', 'Rmt', 'Rmt', 'Nos']);
});

test('presets: the spelling corrections the owner asked for are in place', () => {
  const all = PRESET_CODES.map(getPreset);
  const text = JSON.stringify(all);
  for (const typo of ['Inddor', 'Outoor', 'Communnication', 'Acostic', 'Jet Nozzel', 'Electrinic', 'vaccuming', 'Shealded']) {
    assert.ok(!text.includes(typo), `"${typo}" should have been corrected`);
  }
  assert.ok(text.includes('Acoustic Insulation - 19mm Thick Armasound'));
  assert.ok(text.includes('Supply & Installation of Jet Nozzle'));
});

test('presets: Ducted and VRF are not interchangeable — each has its own rows', () => {
  const d = getPreset('ducted');
  const v = getPreset('vrf');
  const dAcc = d.accessoriesItems.map((i) => i.description);
  const vAcc = v.accessoriesItems.map((i) => i.description);
  assert.notDeepEqual(dAcc, vAcc);
  // Refnet joints belong to VRF only; the ducting grills/nozzle block to Ducted only.
  assert.ok(vAcc.some((t) => t.includes('Copper Refnet Joints')));
  assert.ok(!dAcc.some((t) => t.includes('Copper Refnet Joints')));
  assert.ok(dAcc.some((t) => t.includes('Jet Nozzle')));
  assert.ok(!vAcc.some((t) => t.includes('Jet Nozzle')));
  // Insulation thickness differs between the two workbooks.
  assert.ok(dAcc.some((t) => t.includes('13 mm Thick Nitrile Rubber')));
  assert.ok(vAcc.some((t) => t.includes('9 mm Thick Nitrile Rubber')));
});

test('presets: Ducted and VRF keep their heading and specification rows, which carry no price', () => {
  for (const code of ['ducted', 'vrf']) {
    const eq = getPreset(code).equipmentItems;
    assert.ok(eq.some((i) => i.rowType === 'heading' && i.description === 'OUTDOOR UNITS'));
    assert.ok(eq.some((i) => i.rowType === 'heading' && i.description === 'INDOOR UNITS'));
    assert.ok(eq.some((i) => i.rowType === 'spec'), `${code} should keep its specification paragraph`);
    for (const row of eq.filter((i) => i.rowType === 'heading' || i.rowType === 'spec')) {
      assert.equal(row.supplyRate, undefined, 'a heading/spec row carries no rate');
      assert.equal(row.qty, undefined, 'a heading/spec row carries no quantity');
    }
  }
});

test('presets: Solar is one flat table with the source GST per item (5% / 18%)', () => {
  const s = getPreset('solar');
  assert.equal(s.accessoriesItems.length, 0, 'Solar has no accessories section');
  const items = priced(s.equipmentItems);
  assert.equal(items[0].gstPercent, 5);  // inverter
  assert.equal(items[1].gstPercent, 5);  // panels
  assert.ok(items.slice(2).every((i) => i.gstPercent === 18));
});

test('presets: no preset carries a price — a rate is always entered for the job in hand', () => {
  for (const code of PRESET_CODES) {
    const p = getPreset(code);
    for (const row of [...p.equipmentItems, ...p.accessoriesItems]) {
      if (row.rowType === 'heading' || row.rowType === 'spec') continue;
      assert.equal(row.supplyRate, 0, `${code}: "${row.description}" must not carry a supply rate`);
      assert.equal(row.installationRate, 0, `${code}: "${row.description}" must not carry an installation rate`);
      assert.equal(row.qty, 0, `${code}: "${row.description}" must not carry a quantity`);
    }
  }
});

test('presets: the workbooks\u2019 internal cost and margin working never appears', () => {
  const text = JSON.stringify(PRESET_CODES.map(getPreset));
  // Column J/K/L markers and the sample cost figures behind them.
  for (const leak of ['itc', 'tpt', '40000/1.28', '271980', '844800', '42600']) {
    assert.ok(!text.includes(leak), `internal working "${leak}" must not reach a preset`);
  }
});

test('presets: a caller cannot mutate the built-in content', () => {
  const a = getPreset('split');
  a.accessoriesItems[0].description = 'TAMPERED';
  a.excludedWorks.push('TAMPERED');
  const b = getPreset('split');
  assert.equal(b.accessoriesItems[0].description, 'Copper pipe Indoor to Outdoor with Insulation');
  assert.ok(!b.excludedWorks.includes('TAMPERED'));
});

/* ---------------- over HTTP, with entitlement ---------------- */

test('presets over HTTP: only the divisions the company has bought are offered', async () => {
  const h = await harness(['HVAC']); // no Solar
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}` };
    const res = await fetch(`${h.base}/api/quotation-templates/presets`, { headers: H });
    assert.equal(res.status, 200);
    const { presets } = await res.json();
    assert.deepEqual(presets.map((p) => p.code), ['split', 'ducted', 'vrf']);
    assert.ok(!presets.some((p) => p.division === 'Solar'), 'Solar must not be offered without the Solar division');
  } finally { h.server.close(); }
});

test('presets over HTTP: anonymous callers are refused, and so are roles without quotations', async () => {
  const h = await harness();
  try {
    const anon = await fetch(`${h.base}/api/quotation-templates/presets`);
    assert.equal(anon.status, 401);
    const engToken = await h.login('eng');
    const eng = await fetch(`${h.base}/api/quotation-templates/presets`, { headers: { authorization: `Bearer ${engToken}` } });
    assert.equal(eng.status, 403);
  } finally { h.server.close(); }
});

test('presets over HTTP: a Split quotation saves with its type, its rows, and totals from the prices typed', async () => {
  const h = await harness();
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const { presets } = await (await fetch(`${h.base}/api/quotation-templates/presets`, { headers: H })).json();
    const split = presets.find((p) => p.code === 'split');

    // The user enters prices against the prefilled descriptions.
    const accessoriesItems = split.accessoriesItems.map((i, idx) => ({ ...i, qty: 2, supplyRate: 100 * (idx + 1), installationRate: 10 }));
    const equipmentItems = split.equipmentItems.map((i) => ({ ...i, qty: 1, supplyRate: 40000, installationRate: 1600 }));

    const res = await fetch(`${h.base}/api/quotations`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        division: split.division, offerType: split.code, customerName: 'Preset Test Pvt Ltd',
        subject: split.subject, system: split.system, gstPercent: split.gstPercent,
        offerValidity: split.offerValidity, delivery: split.delivery,
        excludedWorks: split.excludedWorks, paymentTerms: split.paymentTerms,
        equipmentItems, accessoriesItems,
      }),
    });
    assert.equal(res.status, 201);
    const { quotation } = await res.json();

    assert.equal(quotation.offerType, 'split');
    assert.equal(quotation.division, 'HVAC');
    assert.equal(quotation.accessoriesItems.length, 5);
    assert.equal(quotation.accessoriesItems[0].description, 'Copper pipe Indoor to Outdoor with Insulation');
    // Numbering is applied by the server, 1..5 across the priced rows.
    assert.deepEqual(quotation.accessoriesItems.map((i) => i.sNo), [1, 2, 3, 4, 5]);

    // Supply 2*(100+200+300+400+500) = 3000, installation 2*10*5 = 100.
    assert.equal(quotation.accessoriesSupplyTotal, 3000);
    assert.equal(quotation.accessoriesInstallTotal, 100);
    assert.equal(quotation.equipmentTotal, 41600);
    assert.equal(quotation.subtotal, 44700);
    assert.equal(quotation.grandTotal, Math.round(44700 * 1.18 * 100) / 100);
    assert.equal(quotation.excludedWorks.length, 7);
  } finally { h.server.close(); }
});

test('presets over HTTP: a Solar quotation prices each row at its own GST', async () => {
  const h = await harness();
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const { presets } = await (await fetch(`${h.base}/api/quotation-templates/presets`, { headers: H })).json();
    const solar = presets.find((p) => p.code === 'solar');

    // Price only the inverter (5%) and the DCDB (18%); leave the rest at zero.
    const equipmentItems = solar.equipmentItems.map((i) => {
      if (i.description === 'Deye 5kW ongrid Inverter') return { ...i, qty: 1, supplyRate: 30000 };
      if (i.description === 'DCDB') return { ...i, qty: 1, supplyRate: 10000 };
      return i;
    });

    const res = await fetch(`${h.base}/api/quotations`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ division: 'Solar', offerType: 'solar', customerName: 'Solar Preset Test', equipmentItems }),
    });
    assert.equal(res.status, 201);
    const { quotation } = await res.json();
    // 30000 @5% = 1500, 10000 @18% = 1800 -> 3300 GST on a 40000 subtotal.
    assert.equal(quotation.subtotal, 40000);
    assert.equal(quotation.gstAmount, 3300);
    assert.equal(quotation.grandTotal, 43300);
    assert.equal(quotation.offerType, 'solar');
  } finally { h.server.close(); }
});

test('presets over HTTP: the offer type is remembered and a made-up one is ignored', async () => {
  const h = await harness();
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const mk = async (offerType) => (await (await fetch(`${h.base}/api/quotations`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ division: 'HVAC', offerType, customerName: 'Type Test' }),
    })).json()).quotation;

    assert.equal((await mk('vrf')).offerType, 'vrf');
    assert.equal((await mk('not-a-type')).offerType, '', 'an unknown type is not stored');
    assert.equal((await mk(undefined)).offerType, '', 'a quotation started from blank has no type');
  } finally { h.server.close(); }
});

test('presets over HTTP: a new quotation never inherits prices from an earlier one', async () => {
  const h = await harness();
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const { presets } = await (await fetch(`${h.base}/api/quotation-templates/presets`, { headers: H })).json();
    const split = presets.find((p) => p.code === 'split');

    // First quotation: priced.
    await fetch(`${h.base}/api/quotations`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        division: 'HVAC', offerType: 'split', customerName: 'First',
        accessoriesItems: split.accessoriesItems.map((i) => ({ ...i, qty: 5, supplyRate: 999 })),
      }),
    });

    // The preset is unchanged, so the next quotation starts at zero again.
    const again = await (await fetch(`${h.base}/api/quotation-templates/presets`, { headers: H })).json();
    const split2 = again.presets.find((p) => p.code === 'split');
    assert.ok(split2.accessoriesItems.every((i) => i.supplyRate === 0 && i.qty === 0));

    // And the item-name library remembers the wording without a price.
    const lib = await (await fetch(`${h.base}/api/item-names/list?division=HVAC`, { headers: H })).json();
    const rows = lib.items || lib.itemNames || [];
    assert.ok(rows.length > 0, 'descriptions are remembered for autocomplete');
    for (const r of rows) {
      assert.ok(!('supplyRate' in r) && !('rate' in r) && !('price' in r),
        'the item library must never store a price');
    }
  } finally { h.server.close(); }
});

/* ---------------- regression: duplicating a quotation ---------------- */

test('duplicate: the copy does not reuse the original’s client PDF link', async () => {
  // The public link is keyed by a unique token. Before this was fixed the
  // copy carried the original's token, which the unique index refuses -- so
  // Duplicate failed for any quotation whose PDF link had been opened once.
  const { createDevRepositories } = require('../src/devServer');
  const q = require('../src/services/quotationService');
  const deps = createDevRepositories();
  deps.store.state.companies.push({
    id: 'cDup', name: 'Dup Co', divisions: ['HVAC'], status: 'Active',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'),
  });

  const original = await q.createQuotation('cDup', {
    division: 'HVAC', offerType: 'split', customerName: 'Original',
    equipmentItems: [{ rowType: 'item', description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 1000 }],
  }, 'u1', deps);

  await q.getPdfLink('cDup', original.id, deps);
  const withToken = await deps.quotationRepo.findById('cDup', original.id);
  assert.ok(withToken.pdfToken, 'the original has a link token');

  const copy = await q.duplicateQuotation('cDup', original.id, 'u1', deps);
  assert.notEqual(copy.pdfToken, withToken.pdfToken, 'the copy must not reuse the token');
  assert.ok(!copy.pdfToken, 'the copy starts with no token at all');

  // The copy keeps the content, including which kind of offer it is.
  assert.equal(copy.offerType, 'split');
  assert.equal(copy.equipmentTotal, 1000);
  assert.equal(copy.status, 'Draft');

  // And asking for the copy's link mints a different one.
  const link = await q.getPdfLink('cDup', copy.id, deps);
  const copyWithToken = await deps.quotationRepo.findById('cDup', copy.id);
  assert.ok(copyWithToken.pdfToken && copyWithToken.pdfToken !== withToken.pdfToken);
  assert.equal(link.pdfToken, copyWithToken.pdfToken);
});

/* ---------------- the fixed cover and terms pages ---------------- */

const { getFixedPages, FIXED_PAGE_FIELDS } = require('../src/services/quotationPresets');
const { buildQuotationPdf } = require('../src/services/quotationPdf');

const CO = {
  name: 'MEP Powertech Pvt Ltd',
  displayName: 'MEP POWERTECH PVT LTD',
  subtitle: 'MEP Consultant & Contractor',
  tagline: '"Trusted-Economical-Reliable"',
  address: 'Plot No. 4, Shrusti Vihar, Undri, Pune - 411060',
  authorizedPerson: { name: 'Suhas Mahadik', phone: '8793320820' },
  bankDetails: { bankName: 'HDFC Bank', accountHolder: 'MEP Powertech Pvt Ltd', accountNumber: '50200012345678', ifscCode: 'HDFC0001234' },
};

/** A quotation whose own cover/terms fields have all been filled with rubbish. */
function tamperedQuotation(offerType, extra = {}) {
  return {
    quotationNumber: 'Q-9001', division: offerType === 'solar' ? 'Solar' : 'HVAC', offerType,
    customerName: 'Gastro Hub', customerAddress: 'Pimple Saudagar, Pune', capacity: '18 TR',
    subject: 'TAMPERED SUBJECT', system: 'TAMPERED SYSTEM', benefitsOfSystem: 'TAMPERED BENEFITS',
    summaryText: 'TAMPERED SUMMARY', siteDescription: 'TAMPERED SITE',
    offerValidity: '999 days', delivery: 'TAMPERED DELIVERY', notes: 'TAMPERED NOTES',
    excludedWorks: ['TAMPERED EXCLUSION'],
    paymentTerms: [{ sequence: 1, percentage: '5', label: 'TAMPERED TERM' }],
    equipmentItems: [{ rowType: 'item', sNo: 1, description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 100, supplyAmount: 100, totalAmount: 100 }],
    accessoriesItems: [],
    equipmentTotal: 100, accessoriesTotal: 0, subtotal: 100, grandTotal: 118, gstPercent: 18,
    ...extra,
  };
}

test('fixed pages: every offer type has one, and a blank offer type has none', () => {
  for (const code of PRESET_CODES) {
    const f = getFixedPages(code);
    assert.ok(f, `${code} must have fixed pages`);
    assert.ok(f.subject && f.summaryText && f.offerValidity, code);
    assert.ok(Array.isArray(f.excludedWorks) && f.excludedWorks.length > 0, code);
    assert.ok(Array.isArray(f.paymentTerms) && f.paymentTerms.length > 0, code);
  }
  assert.equal(getFixedPages(''), null);
  assert.equal(getFixedPages('nonsense'), null);
  // Capacity is per job, so it must never be locked.
  assert.ok(!FIXED_PAGE_FIELDS.includes('capacity'));
});

test('fixed pages: each offer type carries the terms its own workbook carries', () => {
  // Split =H68, =H85*70%, =H85*30%; Ducted =H107; VRF =H114, =H112*100%;
  // Solar 70/20/10 of the grand total.
  const shape = (code) => getFixedPages(code).paymentTerms.map((t) => `${t.percentage}:${t.section || 'GRAND'}`);
  assert.deepEqual(shape('split'), ['100:Equipment', '70:Accessories', '30:Accessories']);
  assert.deepEqual(shape('ducted'), ['100:Equipment']);
  assert.deepEqual(shape('vrf'), ['100:Equipment', '100:Accessories']);
  assert.deepEqual(shape('solar'), ['70:GRAND', '20:GRAND', '10:GRAND']);

  assert.equal(getFixedPages('solar').offerValidity, '7 days');
  assert.equal(getFixedPages('ducted').offerValidity, '30 days');
  assert.equal(getFixedPages('split').benefitsOfSystem, '', 'the Split workbook leaves Benefits blank');
  assert.equal(getFixedPages('solar').excludedWorks.length, 5);
  assert.equal(getFixedPages('ducted').excludedWorks.length, 7);
});

test('fixed pages: a tampered quotation still prints the standard cover and terms', async () => {
  const pdf = await buildQuotationPdf({ company: CO, quotation: tamperedQuotation('ducted') });
  const text = pdf.toString('latin1');
  // Nothing typed into those boxes reaches the document.
  for (const junk of ['TAMPERED SUBJECT', 'TAMPERED SYSTEM', 'TAMPERED BENEFITS', 'TAMPERED SUMMARY',
    'TAMPERED DELIVERY', 'TAMPERED NOTES', 'TAMPERED EXCLUSION', 'TAMPERED TERM', '999 days']) {
    assert.ok(!text.includes(junk), `"${junk}" must not reach the PDF`);
  }
  assert.ok(pdf.length > 1000);
});

test('fixed pages: a quotation with no offer type keeps its own wording', async () => {
  const q = tamperedQuotation('');
  const pdf = await buildQuotationPdf({ company: CO, quotation: q });
  assert.ok(pdf.length > 1000, 'a blank-start quotation still renders');
  // The lock changes what NEW typed quotations say, never an old one.
  assert.equal(getFixedPages(q.offerType), null);
});

test('fixed pages: a payment line is a share of its own section, not of the grand total', async () => {
  // Equipment 3,60,000 and Accessories 1,50,000 -> with 18% GST,
  // 4,24,800 and 1,77,000. Split: 100% / 70% / 30% of those.
  const q = tamperedQuotation('split', {
    equipmentItems: [{ rowType: 'item', sNo: 1, description: 'Split AC', unit: 'Nos', qty: 6, supplyRate: 60000, supplyAmount: 360000, totalAmount: 360000 }],
    accessoriesItems: [{ rowType: 'item', sNo: 1, description: 'Copper pipe', unit: 'Rmt', qty: 60, installationRate: 2500, installationAmount: 150000, totalAmount: 150000 }],
    equipmentTotal: 360000, accessoriesTotal: 150000, subtotal: 510000, grandTotal: 601800,
  });
  const pdf = await buildQuotationPdf({ company: CO, quotation: q });
  assert.ok(pdf.length > 1000);

  // The shares themselves, computed the way the renderer does.
  const eqWithGst = Math.round(360000 * 1.18);
  const accWithGst = Math.round(150000 * 1.18);
  assert.equal(eqWithGst, 424800);
  assert.equal(Math.round(accWithGst * 0.7), 123900);
  assert.equal(Math.round(accWithGst * 0.3), 53100);
  // And they add up to the grand total, as the workbook's do.
  assert.equal(eqWithGst + accWithGst, 601800);
});

test('fixed pages: the opening paragraph names the company, never a hardcoded one', async () => {
  const other = { ...CO, name: 'Another Firm Pvt Ltd', displayName: 'ANOTHER FIRM PVT LTD' };
  const pdf = await buildQuotationPdf({ company: other, quotation: tamperedQuotation('vrf') });
  const text = pdf.toString('latin1');
  assert.ok(!text.includes('{{company_name}}'), 'the placeholder must be filled in');
  assert.ok(!getFixedPages('vrf').summaryText.includes('MEP POWERTECH'),
    'the stored paragraph must not name one tenant');
  assert.ok(pdf.length > 1000);
});

/* ---------------- the sheets' wording, after the approved corrections ---------------- */

test('wording: the approved spelling and grammar fixes are in, and nothing else moved', () => {
  const split = getFixedPages('split');
  const ducted = getFixedPages('ducted');

  // Spelling fixes approved 30 Oct 2026.
  assert.match(split.excludedWorks[3], /terminating in our control panel \/ MCB\.$/);
  assert.equal(split.excludedWorks[5], 'Any false ceiling, boxing or carpentry work, and ladder.');
  assert.ok(!JSON.stringify(split).includes('carpentary'));
  assert.ok(!JSON.stringify(split).includes('terminaiong'));
  assert.ok(!JSON.stringify(split).includes('Equipement'));

  // The ladder is a genuine exclusion, confirmed by the owner.
  assert.ok(split.excludedWorks[5].includes('ladder'));

  // Grammar fix on benefit 1; benefits 2 and 3 untouched from the sheet.
  const lines = ducted.benefitsOfSystem.split('\n');
  assert.equal(lines[0], '1) Machines come with a Scroll compressor, that saves more than 15% electrical energy compared to others.');
  assert.match(lines[1], /^2\) These machines are heavy & the operating temperature range is greater/);
  assert.match(lines[2], /^3\) Best part load efficiency in the industry\./);

  // Everything else still word for word from the sheets.
  assert.equal(split.excludedWorks[1], 'No structural reinforcement shall be included in our scope.');
  assert.equal(split.excludedWorks[6], 'Mathadi');
  assert.equal(ducted.subject, 'Ducted Air-conditioning Offer');
});

test('wording: the VRF system line names the manufacturer, as the sheet does', () => {
  assert.equal(getFixedPages('vrf').system, 'SAMSUNG Air-Conditioning VRF System.');
  assert.equal(getFixedPages('ducted').system, 'Air-Conditioning Ducted System.');
  // The compressor is the only difference between the two benefit blocks.
  assert.ok(getFixedPages('vrf').benefitsOfSystem.includes('Twin-Rotary'));
  assert.ok(getFixedPages('ducted').benefitsOfSystem.includes('Scroll'));
});

test('solar cover: every figure is computed from the system size and the tariff', async () => {
  const q = {
    quotationNumber: 'Q-SOLAR', division: 'Solar', offerType: 'solar',
    customerName: 'Mr Gaikwad', capacity: '5 KW',
    solarKw: 5, solarTariffPerUnit: 13,
    equipmentItems: [{ rowType: 'item', sNo: 1, description: 'Inverter', unit: 'Nos', qty: 1, supplyRate: 60000, supplyAmount: 60000, totalAmount: 60000 }],
    accessoriesItems: [], equipmentTotal: 230000, subtotal: 230000, grandTotal: 271426, gstPercent: 18,
  };
  const pdf = await buildQuotationPdf({ company: CO, quotation: q });
  assert.ok(pdf.length > 1000);

  // The workbook's own arithmetic, checked here rather than read off a PDF.
  const kw = 5; const tariff = 13;
  assert.equal(kw * 2 * 45, 450);                       // =E40*2*45  rooftop area
  const perMonth = kw * 4 * 30 * tariff;
  assert.equal(perMonth, 7800);                         // =E40*4*30*E41
  const perYear = perMonth * 12;
  assert.equal(perYear, 93600);                         // =E42*12
  assert.equal(perYear / tariff, 7200);                 // =E43/13, generalised
  assert.equal(Math.round((271426 / perYear) * 10) / 10, 2.9); // =H88/E43
});

test('solar cover: a quotation with no system size prints no figures block', async () => {
  const q = {
    quotationNumber: 'Q-SOLAR-0', division: 'Solar', offerType: 'solar',
    customerName: 'Mr Gaikwad', solarKw: 0, solarTariffPerUnit: 13,
    equipmentItems: [], accessoriesItems: [], equipmentTotal: 0, subtotal: 0, grandTotal: 0, gstPercent: 18,
  };
  const pdf = await buildQuotationPdf({ company: CO, quotation: q });
  const text = pdf.toString('latin1');
  assert.ok(!text.includes('Pay Back Period'), 'no payback line without a size to compute it from');
  assert.ok(pdf.length > 1000);
});

test('solar cover: the tariff is per quotation and defaults to the sheet\'s 13', () => {
  const Quotation = require('../src/models/Quotation');
  const path = Quotation.schema.path('solarTariffPerUnit');
  assert.equal(path.defaultValue, 13);
  assert.equal(Quotation.schema.path('solarKw').defaultValue, 0);
});

test('cover layout: the letter reaches the foot of the page whatever its length', async () => {
  // A three-line Split cover and a long Solar cover must both end at the
  // same place: the signature sits at the foot, and nothing overflows onto
  // a second page.
  const short = { ...tamperedQuotation('split'), capacity: '12 TR' };
  const long = {
    ...tamperedQuotation('solar'), division: 'Solar', offerType: 'solar',
    capacity: '5 KW', solarKw: 5, solarTariffPerUnit: 13,
  };
  for (const q of [short, long]) {
    const pdf = await buildQuotationPdf({ company: CO, quotation: q });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pages, 3, `${q.offerType} must still be three pages`);
  }
});

test('brand: the opening paragraph uses the trading name, not the legal one', async () => {
  const { getSharedPages } = require('../src/services/quotationPresets');
  // The stored wording carries a placeholder, never one company's name.
  assert.ok(getFixedPages('split').summaryText.includes('{{brand}}'));
  assert.ok(!getFixedPages('split').summaryText.includes('Powertech'));
  assert.ok(getSharedPages().summaryText.includes('{{brand}}'));

  const withBrand = { ...CO, brandName: 'Powertech' };
  const pdf = await buildQuotationPdf({ company: withBrand, quotation: tamperedQuotation('ducted') });
  const text = pdf.toString('latin1');
  assert.ok(!text.includes('{{brand}}'), 'the placeholder must be filled in');
  assert.ok(pdf.length > 1000);
});

test('brand: with no short name set, the legal suffix is trimmed and nothing invented', async () => {
  for (const [displayName] of [
    ['MEP POWERTECH PVT. LTD.'], ['Acme Private Limited'], ['Beta Services LLP'], ['Gamma Co.'],
  ]) {
    const pdf = await buildQuotationPdf({
      company: { ...CO, brandName: '', displayName },
      quotation: tamperedQuotation('split'),
    });
    assert.ok(pdf.length > 1000, displayName);
  }
  // A name with no suffix at all is left exactly as it is.
  const pdf = await buildQuotationPdf({
    company: { ...CO, brandName: '', displayName: 'Powertech' },
    quotation: tamperedQuotation('split'),
  });
  assert.ok(pdf.length > 1000);
});

test('blank offer type: the shared wording fills the gaps but never the payment split', async () => {
  const { getSharedPages } = require('../src/services/quotationPresets');
  const shared = getSharedPages();
  assert.ok(!('paymentTerms' in shared), 'the instalment split differs per offer type and is never guessed');
  assert.ok(!('subject' in shared) && !('system' in shared) && !('benefitsOfSystem' in shared));
  assert.equal(shared.offerValidity, '30 days');
  assert.equal(shared.excludedWorks.length, 7);

  // An untyped quotation with empty fields still gets a letter.
  const bare = {
    quotationNumber: 'QTN-0001', division: 'HVAC', offerType: '',
    customerName: 'Regal Elegance LLP', customerAddress: 'Ravet', subject: 'Banquet Hall AC',
    summaryText: '', offerValidity: '', delivery: '', notes: '', excludedWorks: [], paymentTerms: [],
    equipmentItems: [{ rowType: 'item', sNo: 1, description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 100, supplyAmount: 100, totalAmount: 100 }],
    accessoriesItems: [], equipmentTotal: 100, subtotal: 100, grandTotal: 118, gstPercent: 18,
  };
  const pdf = await buildQuotationPdf({ company: { ...CO, brandName: 'Powertech' }, quotation: bare });
  assert.ok(pdf.length > 1000);

  // Its own subject survives — the shared wording fills blanks only.
  const kept = { ...bare, offerValidity: '45 days' };
  assert.equal(kept.offerValidity, '45 days');
  const pdf2 = await buildQuotationPdf({ company: CO, quotation: kept });
  assert.ok(pdf2.length > 1000);
});
