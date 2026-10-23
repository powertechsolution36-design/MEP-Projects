'use strict';

/**
 * Quotation starting points (owner request, 22 Oct 2026) — the saved wording
 * for each kind of offer (Split, Ductable, VRF, Solar …).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { TEMPLATE_FIELDS } = require('../src/services/quotationService');

const DUCTED = {
  name: 'Ductable AC offer',
  division: 'HVAC',
  subject: 'Supply & installation of ductable air conditioning system',
  system: 'Ductable AC',
  offerValidity: '30 days',
  excludedWorks: ['Civil works', 'Mathadi'],
  paymentTerms: [{ sequence: 1, label: 'Advance along with work order', percentage: '100' }],
  equipmentItems: [
    { rowType: 'heading', description: 'OUTDOOR UNITS' },
    { rowType: 'spec', description: 'Supply of Ducted Outdoor machines …' },
    { rowType: 'item', description: '17 TR Ductable Units (R410a)', unit: 'Nos', qty: 1, supplyRate: 271980 },
  ],
  accessoriesItems: [],
};

async function harness() {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  const company = {
    id: 'coA', name: 'Alpha', divisions: ['HVAC', 'Solar', 'MEP'], status: 'Active',
    subscriptionRate: 1, subscriptionCycle: 'Monthly',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  };
  state.companies.push(company);
  const pw = await hashPassword('pw-123456');
  state.users.push({ id: 'uSales', companyId: 'coA', username: 'sales', name: 'Sales', role: 'sales', passwordHash: pw, active: true });
  state.users.push({ id: 'uEng', companyId: 'coA', username: 'eng', name: 'Eng', role: 'service_eng', passwordHash: pw, active: true });

  const app = createDevApp(deps, { authTokenSecret: 'quotation-template-test', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => (await (await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw-123456' }),
  })).json()).token;
  return { deps, state, base, server, login };
}

test('starting points — created, listed, filtered by division, applied by the caller, and deleted', async () => {
  const h = await harness();
  try {
    const token = await h.login('sales');
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const created = await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify(DUCTED) });
    assert.equal(created.status, 201);
    const { template } = await created.json();
    assert.equal(template.name, 'Ductable AC offer');
    assert.equal(template.equipmentItems.length, 3);
    assert.equal(template.equipmentItems[0].rowType, 'heading');

    // A second one, on another division.
    const solar = await fetch(`${h.base}/api/quotation-templates`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ name: 'Solar 5kW offer', division: 'Solar', subject: 'ONGRID-TIE SYSTEM' }),
    });
    assert.equal(solar.status, 201);

    const all = await (await fetch(`${h.base}/api/quotation-templates`, { headers: H })).json();
    assert.deepEqual(all.templates.map((t) => t.name).sort(), ['Ductable AC offer', 'Solar 5kW offer']);

    const hvacOnly = await (await fetch(`${h.base}/api/quotation-templates?division=HVAC`, { headers: H })).json();
    assert.deepEqual(hvacOnly.templates.map((t) => t.name), ['Ductable AC offer']);

    // Editing a starting point never touches a quotation, and vice versa.
    const patched = await fetch(`${h.base}/api/quotation-templates/${template.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ offerValidity: '15 days' }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).template.offerValidity, '15 days');

    const del = await fetch(`${h.base}/api/quotation-templates/${template.id}`, { method: 'DELETE', headers: H });
    assert.deepEqual(await del.json(), { deleted: true });
    assert.equal((await fetch(`${h.base}/api/quotation-templates/${template.id}`, { headers: H })).status, 404);
  } finally {
    h.server.close();
  }
});

test('starting points — a name is required, names are unique, and only the listed fields are stored', async () => {
  const h = await harness();
  try {
    const H = { authorization: `Bearer ${await h.login('sales')}`, 'content-type': 'application/json' };

    const noName = await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify({ division: 'HVAC' }) });
    assert.equal(noName.status, 400);
    const noDivision = await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'x' }) });
    assert.equal(noDivision.status, 400);

    await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify(DUCTED) });
    const again = await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify(DUCTED) });
    assert.equal(again.status, 409);

    // Customer details, status and the quotation number are never part of a
    // starting point, even if the caller sends them.
    const sneaky = await fetch(`${h.base}/api/quotation-templates`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        name: 'Sneaky', division: 'HVAC', subject: 'kept',
        customerName: 'Someone', quotationNumber: 'QTN-9999', status: 'Accepted', grandTotal: 999,
      }),
    });
    const { template } = await sneaky.json();
    assert.equal(template.subject, 'kept');
    for (const f of ['customerName', 'quotationNumber', 'grandTotal']) {
      assert.equal(template[f], undefined, `${f} must not be stored on a starting point`);
    }
    assert.ok(!TEMPLATE_FIELDS.includes('customerName'));
    assert.ok(!TEMPLATE_FIELDS.includes('quotationNumber'));
  } finally {
    h.server.close();
  }
});

test('the automatic starting point — one per division, and choosing a new one releases the old', async () => {
  const h = await harness();
  try {
    const H = { authorization: `Bearer ${await h.login('sales')}`, 'content-type': 'application/json' };
    const post = (body) => fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const list = async () => (await (await fetch(`${h.base}/api/quotation-templates`, { headers: H })).json()).templates;

    const first = (await (await post({ ...DUCTED, isDefault: true })).json()).template;
    assert.equal(first.isDefault, true);

    // A second HVAC starting point, also marked automatic, takes over.
    const second = (await (await post({ name: 'Split AC offer', division: 'HVAC', isDefault: true })).json()).template;
    let all = await list();
    assert.deepEqual(
      all.filter((t) => t.division === 'HVAC').map((t) => [t.name, t.isDefault === true]).sort(),
      [['Ductable AC offer', false], ['Split AC offer', true]]
    );

    // Another division keeps its own, untouched.
    await post({ name: 'Solar 5kW offer', division: 'Solar', isDefault: true });
    all = await list();
    assert.deepEqual(
      all.filter((t) => t.isDefault).map((t) => t.name).sort(),
      ['Solar 5kW offer', 'Split AC offer']
    );

    // Promoting the first one back releases the second.
    const patched = await fetch(`${h.base}/api/quotation-templates/${first.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ isDefault: true }),
    });
    assert.equal(patched.status, 200);
    all = await list();
    assert.deepEqual(
      all.filter((t) => t.division === 'HVAC' && t.isDefault).map((t) => t.name),
      ['Ductable AC offer']
    );

    // And it can be switched off without deleting it.
    await fetch(`${h.base}/api/quotation-templates/${first.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ isDefault: false }),
    });
    all = await list();
    assert.equal(all.filter((t) => t.division === 'HVAC' && t.isDefault).length, 0);
    assert.equal(all.filter((t) => t.division === 'HVAC').length, 2, 'both are still saved');
    assert.equal(all.find((t) => t.id === second.id).isDefault, false);
  } finally {
    h.server.close();
  }
});

test('starting points — need a login, and the Quotations roles only', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/api/quotation-templates`)).status, 401);
    const engineer = { authorization: `Bearer ${await h.login('eng')}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${h.base}/api/quotation-templates`, { headers: engineer })).status, 403);
    assert.equal((await fetch(`${h.base}/api/quotation-templates`, {
      method: 'POST', headers: engineer, body: JSON.stringify(DUCTED),
    })).status, 403);
  } finally {
    h.server.close();
  }
});

test('starting points — one company never sees another company’s', async () => {
  const h = await harness();
  try {
    const { state } = h;
    state.companies.push({
      id: 'coB', name: 'Beta', divisions: ['HVAC'], status: 'Active',
      subscriptionRate: 1, subscriptionCycle: 'Monthly',
      subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
    });
    state.users.push({
      id: 'uB', companyId: 'coB', username: 'otherSales', name: 'Other', role: 'sales',
      passwordHash: await hashPassword('pw-123456'), active: true,
    });

    const A = { authorization: `Bearer ${await h.login('sales')}`, 'content-type': 'application/json' };
    const B = { authorization: `Bearer ${await h.login('otherSales')}`, 'content-type': 'application/json' };
    const made = await (await fetch(`${h.base}/api/quotation-templates`, { method: 'POST', headers: A, body: JSON.stringify(DUCTED) })).json();

    const seenByB = await (await fetch(`${h.base}/api/quotation-templates`, { headers: B })).json();
    assert.deepEqual(seenByB.templates, []);
    assert.equal((await fetch(`${h.base}/api/quotation-templates/${made.template.id}`, { headers: B })).status, 404);
    assert.equal((await fetch(`${h.base}/api/quotation-templates/${made.template.id}`, { method: 'DELETE', headers: B })).status, 404);
    // Still there for its owner.
    assert.equal((await fetch(`${h.base}/api/quotation-templates/${made.template.id}`, { headers: A })).status, 200);
  } finally {
    h.server.close();
  }
});
