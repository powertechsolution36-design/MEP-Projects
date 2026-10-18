'use strict';

/**
 * Stage 7 + Subscription — HTTP-level integration tests.
 *
 * Part A exercises the REAL production assembly (src/app.js createApp(),
 * wired to the real Mongoose repositories) WITHOUT any database
 * connection: every request is unauthenticated, so the auth middleware
 * answers 401 before any repository is touched. A mounted route answers
 * 401; an unmounted one answers 404. This proves every endpoint the
 * frontend calls is actually registered in production.
 *
 * Part B drives the same route factories over real HTTP through
 * src/devServer.js's assembly (in-memory fakes from tests/enquiryFakes.js),
 * logging in as real users with real tokens, to verify authorization,
 * tenant isolation, division entitlement and the full lifecycle of
 * subscriptions, quotations, item names, payment-term templates, AMC
 * documents and the Company Profile.
 *
 * No live database is used anywhere in this file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');

const CONFIG = {
  authTokenSecret: 'stage7-http-integration-test-secret-not-for-production',
  authTokenExpiry: '1h',
  port: 0,
};

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function call(base, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

// Every Stage 7 / subscription / company-profile endpoint the backend
// exposes (and the frontend calls).
const STAGE7_ENDPOINTS = [
  ['GET', '/api/subscriptions/plans'],
  ['GET', '/api/subscriptions/plans/HVAC_STARTER'],
  ['POST', '/api/subscriptions/plans'],
  ['PATCH', '/api/subscriptions/plans/HVAC_STARTER'],
  ['POST', '/api/subscriptions/plans/seed'],
  ['GET', '/api/subscriptions/company/abc'],
  ['POST', '/api/subscriptions/company/abc'],
  ['GET', '/api/subscriptions/my-divisions'],
  ['GET', '/api/quotations'],
  ['GET', '/api/quotations/export/csv'],
  ['GET', '/api/quotations/abc'],
  ['POST', '/api/quotations'],
  ['PATCH', '/api/quotations/abc'],
  ['POST', '/api/quotations/abc/duplicate'],
  ['DELETE', '/api/quotations/abc'],
  ['GET', '/api/item-names/autocomplete?division=HVAC&q=a'],
  ['GET', '/api/item-names/list?division=HVAC'],
  ['DELETE', '/api/item-names/abc'],
  ['GET', '/api/amc-documents/templates'],
  ['GET', '/api/amc-documents/templates/comprehensive'],
  ['PUT', '/api/amc-documents/templates'],
  ['GET', '/api/amc-documents/generate/abc/comprehensive'],
  ['GET', '/api/payment-term-templates'],
  ['GET', '/api/payment-term-templates/abc'],
  ['POST', '/api/payment-term-templates'],
  ['PATCH', '/api/payment-term-templates/abc'],
  ['DELETE', '/api/payment-term-templates/abc'],
  ['GET', '/api/companies/my-profile'],
  ['PATCH', '/api/companies/my-profile'],
];

// ═══════════════════════════════════════════════════════════════════
// PART A — production assembly (src/app.js) route registration
// ═══════════════════════════════════════════════════════════════════

test('production app.js: every Stage 7 / subscription / profile endpoint is mounted (401, never 404)', async () => {
  const { server, base } = await listen(createApp(CONFIG));
  try {
    for (const [method, path] of STAGE7_ENDPOINTS) {
      const res = await call(base, method, path, method === 'GET' || method === 'DELETE' ? {} : { body: {} });
      assert.equal(res.status, 401, `${method} ${path} should be mounted behind auth (got ${res.status})`);
    }
    // Control: an unmounted path really is a 404 in this assembly.
    const missing = await call(base, 'GET', '/api/definitely-not-a-route');
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('production app.js: Company Profile route accepts image payloads above the default 100 KB JSON limit', async () => {
  const { server, base } = await listen(createApp(CONFIG));
  try {
    const big = 'data:image/png;base64,' + 'A'.repeat(600 * 1024);
    // Unauthenticated, so 401 — but NOT 413 (body accepted by the parser).
    const res = await call(base, 'PATCH', '/api/companies/my-profile', { body: { logoBase64: big } });
    assert.equal(res.status, 401);
    // Every other route keeps the default limit.
    const other = await call(base, 'POST', '/api/quotations', { body: { notes: big } });
    assert.equal(other.status, 413);
  } finally {
    server.close();
  }
});

test('dev server assembly mounts the same /api prefixes as production app.js', () => {
  const fs = require('fs');
  const path = require('path');
  const prefixes = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    return [...src.matchAll(/app\.use\('(\/api\/[^']+)',\s*create\w+Router/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(prefixes('devServer.js'), prefixes('app.js'));
  assert.ok(prefixes('app.js').includes('/api/quotations'));
});

// ═══════════════════════════════════════════════════════════════════
// PART B — full HTTP lifecycle against the fake-repository assembly
// ═══════════════════════════════════════════════════════════════════

const CO_A = 'company_a';
const CO_B = 'company_b';
const PASSWORD = 'test-password-1';

async function buildEnv() {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.push(
    { id: CO_A, name: 'Alpha Engineering', divisions: ['HVAC'], status: 'Active', phone: '111', email: 'a@alpha.test' },
    { id: CO_B, name: 'Beta Solar', divisions: ['Solar'], status: 'Active' }
  );
  const hash = await hashPassword(PASSWORD);
  const users = [
    ['u_super', null, 'root', 'super'],
    ['u_admin_a', CO_A, 'admina', 'admin'],
    ['u_sales_a', CO_A, 'salesa', 'sales'],
    ['u_fin_a', CO_A, 'fina', 'finance'],
    ['u_eng_a', CO_A, 'enga', 'engineer'],
    ['u_admin_b', CO_B, 'adminb', 'admin'],
  ];
  for (const [id, companyId, username, role] of users) {
    state.users.push({ id, companyId, username, name: username, role, passwordHash: hash, active: true });
  }
  state.inventoryItems.push({ id: 'inv_1', companyId: CO_A, name: 'VRF Outdoor Unit', stockByLocation: { loc1: 5 } });
  const app = createDevApp(deps, CONFIG);
  const { server, base } = await listen(app);
  const tokens = {};
  for (const [, companyId, username] of users) {
    const res = await call(base, 'POST', '/api/auth/login', { body: { username, password: PASSWORD, companyId } });
    assert.equal(res.status, 200, `login ${username}`);
    tokens[username] = res.json.token;
  }
  return { deps, state, server, base, tokens };
}

test('subscription API: super-only plan management, seeding, assignment, and per-company visibility', async () => {
  const env = await buildEnv();
  const { base, tokens, state } = env;
  try {
    // Non-super cannot seed / create / edit plans or assign subscriptions.
    assert.equal((await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.admina })).status, 403);
    assert.equal((await call(base, 'POST', '/api/subscriptions/plans', { token: tokens.admina, body: { code: 'X', name: 'X', availableDivisions: ['HVAC'] } })).status, 403);
    assert.equal((await call(base, 'PATCH', '/api/subscriptions/plans/HVAC_STARTER', { token: tokens.salesa, body: { pricing: { monthly: 1 } } })).status, 403);
    assert.equal((await call(base, 'POST', `/api/subscriptions/company/${CO_A}`, { token: tokens.admina, body: { planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'] } })).status, 403);

    // Super seeds exactly the 7 plans; re-seeding does not duplicate.
    const seeded = await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
    assert.equal(seeded.status, 200);
    assert.deepEqual(seeded.json.plans.map((p) => p.code).sort(), [
      'FULL_ENTERPRISE', 'HVAC_STARTER', 'MEP_HVAC_PRO', 'MEP_SOLAR_PRO', 'MEP_STARTER', 'SOLAR_HVAC_PRO', 'SOLAR_STARTER',
    ]);
    // Prices stay editable by super and survive a re-seed.
    const priced = await call(base, 'PATCH', '/api/subscriptions/plans/HVAC_STARTER', { token: tokens.root, body: { pricing: { monthly: 4999 } } });
    assert.equal(priced.status, 200);
    const reseed = await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
    assert.equal(reseed.json.plans.length, 7);
    assert.deepEqual(reseed.json.plans.find((p) => p.code === 'HVAC_STARTER').pricing, { monthly: 4999 });
    assert.equal(state.plans.length, 7);

    // Purchased divisions must be a subset of the plan.
    const bad = await call(base, 'POST', `/api/subscriptions/company/${CO_A}`, { token: tokens.root, body: { planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC', 'Solar'] } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /not available in plan/i);

    // Assign, then upgrade: the audit log appends, never overwrites.
    const first = await call(base, 'POST', `/api/subscriptions/company/${CO_A}`, { token: tokens.root, body: { planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'] } });
    assert.equal(first.status, 201);
    const second = await call(base, 'POST', `/api/subscriptions/company/${CO_A}`, { token: tokens.root, body: { planCode: 'MEP_HVAC_PRO', purchasedDivisions: ['MEP', 'HVAC'] } });
    assert.equal(second.status, 201);
    assert.deepEqual(second.json.subscription.auditLog.map((e) => e.action), ['created', 'updated']);
    assert.equal(state.subscriptions.length, 1);

    // Effective divisions reach the company user.
    const mine = await call(base, 'GET', '/api/subscriptions/my-divisions', { token: tokens.salesa });
    assert.deepEqual(mine.json.divisions.sort(), ['HVAC', 'MEP']);

    // A company can read its own subscription but never another company's.
    assert.equal((await call(base, 'GET', `/api/subscriptions/company/${CO_A}`, { token: tokens.admina })).status, 200);
    assert.equal((await call(base, 'GET', `/api/subscriptions/company/${CO_A}`, { token: tokens.adminb })).status, 403);
    assert.equal((await call(base, 'GET', `/api/subscriptions/company/${CO_B}`, { token: tokens.root })).status, 200);
  } finally {
    env.server.close();
  }
});

test('quotation API: CRUD, calculation, CSV export, role gates, division entitlement, tenant isolation, no inventory side effects', async () => {
  const env = await buildEnv();
  const { base, tokens, state } = env;
  try {
    const inventoryBefore = JSON.stringify({ items: state.inventoryItems, tx: state.inventoryTransactions, iss: state.inventoryIssues });

    // Engineer cannot create.
    const denied = await call(base, 'POST', '/api/quotations', { token: tokens.enga, body: { division: 'HVAC', customerName: 'X' } });
    assert.equal(denied.status, 403);

    // Company A is entitled to HVAC only (Company.divisions; no subscription yet).
    const notEntitled = await call(base, 'POST', '/api/quotations', { token: tokens.salesa, body: { division: 'Solar', customerName: 'X' } });
    assert.equal(notEntitled.status, 403);
    assert.match(notEntitled.json.error, /not available/i);

    const created = await call(base, 'POST', '/api/quotations', {
      token: tokens.salesa,
      body: {
        division: 'HVAC', customerName: 'Client One',
        equipmentItems: [{ description: 'VRF Outdoor Unit', qty: 2, supplyRate: 50000, installationRate: 10000 }],
        accessoriesItems: [{ description: 'Copper Pipe', unit: 'Rmt', qty: 10, supplyRate: 500, installationRate: 200 }],
      },
    });
    assert.equal(created.status, 201);
    const q = created.json.quotation;
    assert.equal(q.equipmentTotal, 120000);
    assert.equal(q.accessoriesTotal, 7000);
    assert.equal(q.subtotal, 127000);
    assert.equal(q.gstAmount, 22860);
    assert.equal(q.grandTotal, 149860);
    assert.match(q.quotationNumber, /^QTN-\d{4}$/);

    // Quotation selection never touches inventory.
    assert.equal(
      JSON.stringify({ items: state.inventoryItems, tx: state.inventoryTransactions, iss: state.inventoryIssues }),
      inventoryBefore
    );

    // Item names were saved on document save, name-only, division-scoped.
    const ac = await call(base, 'GET', '/api/item-names/autocomplete?division=HVAC&q=vrf', { token: tokens.salesa });
    assert.equal(ac.status, 200);
    assert.deepEqual(ac.json.items.map((i) => i.name), ['VRF Outdoor Unit']);
    for (const item of state.itemNames) {
      assert.ok(!('supplyRate' in item) && !('price' in item) && !('rate' in item), 'item names never store a price');
    }
    const otherDivision = await call(base, 'GET', '/api/item-names/autocomplete?division=Solar&q=vrf', { token: tokens.salesa });
    assert.deepEqual(otherDivision.json.items, []);
    const otherTenant = await call(base, 'GET', '/api/item-names/autocomplete?division=HVAC&q=vrf', { token: tokens.adminb });
    assert.deepEqual(otherTenant.json.items, []);

    // A brand-new name with no suggestions is accepted as typed.
    const upd = await call(base, 'PATCH', `/api/quotations/${q.id}`, {
      token: tokens.fina,
      body: { equipmentItems: [{ description: 'Brand New Custom Unit', qty: 1, supplyRate: 1000, installationRate: 0 }] },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.quotation.equipmentTotal, 1000);
    assert.ok(state.itemNames.some((i) => i.name === 'Brand New Custom Unit'));

    // Prices stay per-document: a second quotation with a different price
    // for the same name does not alter the first.
    const q2 = await call(base, 'POST', '/api/quotations', {
      token: tokens.salesa,
      body: { division: 'HVAC', customerName: 'Client Two', equipmentItems: [{ description: 'Brand New Custom Unit', qty: 1, supplyRate: 9999 }] },
    });
    assert.equal(q2.status, 201);
    const reread = await call(base, 'GET', `/api/quotations/${q.id}`, { token: tokens.salesa });
    assert.equal(reread.json.quotation.equipmentItems[0].supplyRate, 1000);

    // List / filter / CSV.
    // Quotations (commercial pricing) are readable only by the commercial
    // roles that have the Quotations menu.
    assert.equal((await call(base, 'GET', '/api/quotations', { token: tokens.enga })).status, 403);
    const list = await call(base, 'GET', '/api/quotations?division=HVAC', { token: tokens.fina });
    assert.equal(list.status, 200);
    assert.equal(list.json.quotations.length, 2);
    const csv = await call(base, 'GET', '/api/quotations/export/csv', { token: tokens.salesa });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.text.includes('Client One'));

    // Tenant isolation: company B sees nothing of company A.
    assert.equal((await call(base, 'GET', `/api/quotations/${q.id}`, { token: tokens.adminb })).status, 404);
    assert.equal((await call(base, 'GET', '/api/quotations', { token: tokens.adminb })).json.quotations.length, 0);
    assert.equal((await call(base, 'DELETE', `/api/quotations/${q.id}`, { token: tokens.adminb })).status, 404);

    // Duplicate, then delete rules.
    const dup = await call(base, 'POST', `/api/quotations/${q.id}/duplicate`, { token: tokens.salesa });
    assert.equal(dup.status, 201);
    assert.notEqual(dup.json.quotation.quotationNumber, q.quotationNumber);
    await call(base, 'PATCH', `/api/quotations/${q.id}`, { token: tokens.salesa, body: { status: 'Sent' } });
    assert.equal((await call(base, 'DELETE', `/api/quotations/${q.id}`, { token: tokens.salesa })).status, 400);
    assert.equal((await call(base, 'DELETE', `/api/quotations/${dup.json.quotation.id}`, { token: tokens.fina })).status, 403);
    assert.equal((await call(base, 'DELETE', `/api/quotations/${dup.json.quotation.id}`, { token: tokens.salesa })).status, 200);

    // Item-name delete is admin only.
    const itemId = state.itemNames.find((i) => i.companyId === CO_A).id;
    assert.equal((await call(base, 'DELETE', `/api/item-names/${itemId}`, { token: tokens.salesa })).status, 403);
    assert.equal((await call(base, 'DELETE', `/api/item-names/${itemId}`, { token: tokens.adminb })).status, 404);
    assert.equal((await call(base, 'DELETE', `/api/item-names/${itemId}`, { token: tokens.admina })).status, 200);
  } finally {
    env.server.close();
  }
});

test('quotation API: Solar per-item GST and purchased-division entitlement via subscription', async () => {
  const env = await buildEnv();
  const { base, tokens } = env;
  try {
    await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
    const sub = await call(base, 'POST', `/api/subscriptions/company/${CO_B}`, { token: tokens.root, body: { planCode: 'SOLAR_STARTER', purchasedDivisions: ['Solar'] } });
    assert.equal(sub.status, 201);
    const res = await call(base, 'POST', '/api/quotations', {
      token: tokens.adminb,
      body: {
        division: 'Solar', customerName: 'Solar Client',
        equipmentItems: [
          { description: 'Panel 540W', qty: 200, supplyRate: 600, gstPercent: 5 },
          { description: 'Inverter', qty: 1, supplyRate: 300000, gstPercent: 18 },
        ],
      },
    });
    assert.equal(res.status, 201);
    const items = res.json.quotation.equipmentItems;
    assert.equal(items[0].amountWithGst, 126000);
    assert.equal(items[1].amountWithGst, 354000);
    // HVAC is not purchased by company B.
    const hvac = await call(base, 'POST', '/api/quotations', { token: tokens.adminb, body: { division: 'HVAC', customerName: 'X' } });
    assert.equal(hvac.status, 403);
  } finally {
    env.server.close();
  }
});

test('payment term template API: CRUD, role gate, validation, tenant isolation', async () => {
  const env = await buildEnv();
  const { base, tokens } = env;
  try {
    const rows = [{ sequence: 1, label: 'Advance', percentage: '40%' }, { sequence: 2, label: 'Completion', percentage: '60%' }];
    assert.equal((await call(base, 'POST', '/api/payment-term-templates', { token: tokens.enga, body: { name: 'T', rows } })).status, 403);
    assert.equal((await call(base, 'POST', '/api/payment-term-templates', { token: tokens.fina, body: { name: 'T', rows: [] } })).status, 400);
    const created = await call(base, 'POST', '/api/payment-term-templates', { token: tokens.fina, body: { name: 'Standard 40/60', division: 'HVAC', rows } });
    assert.equal(created.status, 201);
    const id = created.json.template.id;
    assert.equal((await call(base, 'POST', '/api/payment-term-templates', { token: tokens.fina, body: { name: 'Standard 40/60', rows } })).status, 409);
    const list = await call(base, 'GET', '/api/payment-term-templates?documentType=quotation', { token: tokens.salesa });
    assert.equal(list.json.templates.length, 1);
    const patched = await call(base, 'PATCH', `/api/payment-term-templates/${id}`, { token: tokens.salesa, body: { name: 'Renamed' } });
    assert.equal(patched.json.template.name, 'Renamed');
    assert.equal((await call(base, 'GET', `/api/payment-term-templates/${id}`, { token: tokens.adminb })).status, 404);
    assert.equal((await call(base, 'DELETE', `/api/payment-term-templates/${id}`, { token: tokens.adminb })).status, 404);
    assert.equal((await call(base, 'DELETE', `/api/payment-term-templates/${id}`, { token: tokens.admina })).status, 200);
    assert.equal((await call(base, 'GET', '/api/payment-term-templates', { token: tokens.admina })).json.templates.length, 0);
  } finally {
    env.server.close();
  }
});

test('company profile API: own-company only, admin-only edit, partial sub-field updates, dynamic branding in AMC output', async () => {
  const env = await buildEnv();
  const { base, tokens, state } = env;
  try {
    // Any company user can read; super (no company) cannot.
    const read = await call(base, 'GET', '/api/companies/my-profile', { token: tokens.salesa });
    assert.equal(read.status, 200);
    assert.equal(read.json.company.name, 'Alpha Engineering');
    assert.equal((await call(base, 'GET', '/api/companies/my-profile', { token: tokens.root })).status, 400);

    // Only the company admin may edit.
    assert.equal((await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.salesa, body: { displayName: 'X' } })).status, 403);
    assert.equal((await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.root, body: { displayName: 'X' } })).status, 403);

    const saved = await call(base, 'PATCH', '/api/companies/my-profile', {
      token: tokens.admina,
      body: {
        displayName: 'Alpha Engineering Pvt Ltd', quotationPrefix: 'ALP',
        bankDetails: { bankName: 'Test Bank', ifscCode: 'TEST0001' },
        authorizedPerson: { name: 'A. Person', designation: 'Director' },
        // Tenant-control fields are ignored on this route.
        name: 'Hijacked', divisions: ['HVAC', 'Solar', 'MEP'], status: 'Suspended',
      },
    });
    assert.equal(saved.status, 200);
    const coA = state.companies.find((c) => c.id === CO_A);
    assert.equal(coA.name, 'Alpha Engineering');
    assert.deepEqual(coA.divisions, ['HVAC']);
    assert.equal(coA.status, 'Active');
    assert.equal(coA.bankDetails.bankName, 'Test Bank');

    // Partial sub-object update keeps the other sub-fields.
    await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.admina, body: { bankDetails: { branch: 'Pune' } } });
    assert.equal(coA.bankDetails.bankName, 'Test Bank');
    assert.equal(coA.bankDetails.branch, 'Pune');

    // Validation.
    assert.equal((await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.admina, body: { quotationPrefix: '  ' } })).status, 400);
    assert.equal((await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.admina, body: { bankDetails: 'x' } })).status, 400);

    // Company B is untouched.
    assert.equal(state.companies.find((c) => c.id === CO_B).displayName, undefined);

    // The quotation number now uses the tenant's own prefix.
    const q = await call(base, 'POST', '/api/quotations', { token: tokens.salesa, body: { division: 'HVAC', customerName: 'C' } });
    assert.match(q.json.quotation.quotationNumber, /^ALP-/);
    const qb = await call(base, 'POST', '/api/quotations', { token: tokens.adminb, body: { division: 'Solar', customerName: 'C' } });
    assert.match(qb.json.quotation.quotationNumber, /^QTN-/);
  } finally {
    env.server.close();
  }
});

test('AMC document API: three separate formats, company override, generation with tenant branding, tenant isolation', async () => {
  const env = await buildEnv();
  const { base, tokens, state } = env;
  try {
    state.contracts.push({
      id: 'contract_a1', companyId: CO_A, customer: 'AMC Customer', site: 'Site 1', category: 'HVAC',
      amcType: 'Quarterly', maintenanceCoverage: 'Comprehensive', startDate: '2026-01-01', endDate: '2026-12-31', amount: 50000,
    });
    await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.admina, body: { displayName: 'Alpha Engineering Pvt Ltd' } });

    const list = await call(base, 'GET', '/api/amc-documents/templates', { token: tokens.salesa });
    assert.deepEqual(list.json.templates.map((t) => t.type), ['comprehensive', 'non-comprehensive', 'amc-letter']);
    const counts = {};
    for (const t of ['comprehensive', 'non-comprehensive', 'amc-letter']) {
      const r = await call(base, 'GET', `/api/amc-documents/templates/${t}`, { token: tokens.salesa });
      counts[t] = r.json.template.sections.length;
    }
    assert.deepEqual(counts, { comprehensive: 16, 'non-comprehensive': 15, 'amc-letter': 23 });

    const gen = await call(base, 'GET', '/api/amc-documents/generate/contract_a1/comprehensive', { token: tokens.salesa });
    assert.equal(gen.status, 200);
    assert.equal(gen.json.document.company.name, 'Alpha Engineering Pvt Ltd');
    assert.equal(gen.json.document.contract.customer, 'AMC Customer');
    assert.equal(gen.json.document.contract.visitsPerYear, 4);

    // Another tenant cannot generate from this contract.
    assert.equal((await call(base, 'GET', '/api/amc-documents/generate/contract_a1/comprehensive', { token: tokens.adminb })).status, 404);

    // Override is admin-only and company-scoped; the system default is preserved for others.
    const body = { type: 'amc-letter', name: 'Alpha Letter', sections: [{ key: 'k', title: 'T', content: 'Custom {{company_name}}', order: 1 }] };
    assert.equal((await call(base, 'PUT', '/api/amc-documents/templates', { token: tokens.salesa, body })).status, 403);
    assert.equal((await call(base, 'PUT', '/api/amc-documents/templates', { token: tokens.admina, body })).status, 200);
    const mine = await call(base, 'GET', '/api/amc-documents/templates/amc-letter', { token: tokens.salesa });
    assert.equal(mine.json.template.name, 'Alpha Letter');
    const theirs = await call(base, 'GET', '/api/amc-documents/templates/amc-letter', { token: tokens.adminb });
    assert.equal(theirs.json.template.sections.length, 23);
    const letter = await call(base, 'GET', '/api/amc-documents/generate/contract_a1/amc-letter', { token: tokens.admina });
    assert.equal(letter.json.document.template.sections[0].content, 'Custom Alpha Engineering Pvt Ltd');
  } finally {
    env.server.close();
  }
});
