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
