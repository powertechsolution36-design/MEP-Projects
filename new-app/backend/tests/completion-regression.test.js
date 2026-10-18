'use strict';

/**
 * FINAL COMPLETION ORDER — consolidated regression tests.
 *
 * Covers behaviour added or corrected during the completion pass, driven
 * over real HTTP through the dev assembly (src/devServer.js routes wired to
 * the in-memory fakes from tests/enquiryFakes.js) plus the production
 * route-registration check against src/app.js. No live database is used.
 *
 * PWA references are MEP_PROJECTS_PWA/index.html line numbers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { calculateLineTotals, calculateTotals } = require('../src/services/quotationService');

const CONFIG = {
  authTokenSecret: 'completion-regression-test-secret-not-for-production',
  authTokenExpiry: '1h',
  port: 0,
};
const PASSWORD = 'test-password-1';
const CO_A = 'co_alpha';
const CO_B = 'co_beta';

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
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
  return { status: res.status, json, text };
}

async function buildEnv() {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push(
    { id: CO_A, name: 'Alpha HVAC', city: 'Pune', divisions: ['HVAC'], status: 'Active', subscriptionRate: 1200, subscriptionCycle: 'Monthly', subscriptionStart: new Date('2026-01-01'), since: new Date('2026-01-01') },
    { id: CO_B, name: 'Beta Solar', city: 'Nashik', divisions: ['Solar'], status: 'Trial', since: new Date('2026-09-01') }
  );
  const hash = await hashPassword(PASSWORD);
  const users = [
    ['u_super', null, 'root', 'super'],
    ['u_admin_a', CO_A, 'admina', 'admin'],
    ['u_sales_a', CO_A, 'salesa', 'sales'],
    ['u_eng_a', CO_A, 'enga', 'engineer'],
    ['u_inv_a', CO_A, 'inva', 'inventory'],
    ['u_admin_b', CO_B, 'adminb', 'admin'],
  ];
  for (const [id, companyId, username, role] of users) {
    state.users.push({ id, companyId, username, name: username, role, passwordHash: hash, active: true });
  }
  const app = createDevApp(deps, CONFIG);
  const { server, base } = await listen(app);
  const login = (username, extra = {}) => call(base, 'POST', '/api/auth/login', { body: { username, password: PASSWORD, ...extra } });
  const tokens = {};
  for (const [, , username] of users) {
    const res = await login(username);
    assert.equal(res.status, 200, `login ${username}: ${res.text}`);
    tokens[username] = res.json.token;
  }
  return { deps, state, server, base, tokens, login };
}

// ─── Production assembly: new endpoints are mounted (401, never 404) ───

test('production app.js mounts every endpoint added in the completion pass', async () => {
  const { server, base } = await listen(createApp(CONFIG));
  try {
    for (const path of ['/api/dashboard', '/api/service-calls/mine', '/api/inventory/issues', '/api/inventory/transactions', '/api/inventory/site-options', '/api/companies/platform/usage']) {
      const res = await call(base, 'GET', path);
      assert.equal(res.status, 401, `GET ${path} should be mounted behind auth (got ${res.status})`);
    }
  } finally {
    server.close();
  }
});

// ─── Authentication (owner decision 1: username + password only) ───

test('auth: login needs only username + password; a wrong password is rejected', async () => {
  const env = await buildEnv();
  try {
    const ok = await env.login('salesa');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.companyId, CO_A);
    const bad = await call(env.base, 'POST', '/api/auth/login', { body: { username: 'salesa', password: 'wrong' } });
    assert.equal(bad.status, 401);
  } finally {
    env.server.close();
  }
});

test('auth: legacy duplicate usernames across companies are ambiguous without a company, never silently picked', async () => {
  const env = await buildEnv();
  try {
    const hash = await hashPassword(PASSWORD);
    env.state.users.push({ id: 'u_dup', companyId: CO_B, username: 'salesa', name: 'dup', role: 'sales', passwordHash: hash, active: true });
    const res = await env.login('salesa');
    assert.equal(res.status, 401);
    assert.match(res.json.error, /more than one account/i);
    const disamb = await env.login('salesa', { companyId: CO_B });
    assert.equal(disamb.status, 200);
    assert.equal(disamb.json.user.id, 'u_dup');
  } finally {
    env.server.close();
  }
});

test('auth: suspending a company blocks login AND invalidates existing sessions (PWA index.html:1307)', async () => {
  const env = await buildEnv();
  try {
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.salesa })).status, 200);
    const s = await call(env.base, 'POST', `/api/companies/${CO_A}/status`, { token: env.tokens.root, body: { status: 'Suspended' } });
    assert.equal(s.status, 200);
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.salesa })).status, 401);
    const blocked = await env.login('salesa');
    assert.equal(blocked.status, 401);
    assert.equal(blocked.json.error, 'Company subscription suspended. Contact provider.');
    // Super is unaffected.
    assert.equal((await call(env.base, 'GET', '/api/companies', { token: env.tokens.root })).status, 200);
  } finally {
    env.server.close();
  }
});

test('auth: changing a user password or deleting the user revokes their sessions', async () => {
  const env = await buildEnv();
  try {
    const pw = await call(env.base, 'PATCH', '/api/users/u_sales_a', { token: env.tokens.admina, body: { password: 'new-password-2' } });
    assert.equal(pw.status, 200, pw.text);
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.salesa })).status, 401);
    const del = await call(env.base, 'DELETE', '/api/users/u_eng_a', { token: env.tokens.admina });
    assert.equal(del.status, 200, del.text);
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.enga })).status, 401);
  } finally {
    env.server.close();
  }
});

test('auth: a role change takes effect on the next request (role is re-read, never trusted from the token)', async () => {
  const env = await buildEnv();
  try {
    assert.equal((await call(env.base, 'GET', '/api/quotations', { token: env.tokens.salesa })).status, 200);
    env.state.users.find((u) => u.id === 'u_sales_a').role = 'engineer';
    assert.equal((await call(env.base, 'GET', '/api/quotations', { token: env.tokens.salesa })).status, 403);
  } finally {
    env.server.close();
  }
});

test('users: usernames are unique across the whole platform (PWA saveCompany / saveUser)', async () => {
  const env = await buildEnv();
  try {
    const dup = await call(env.base, 'POST', '/api/users', { token: env.tokens.adminb, body: { name: 'X', username: 'salesa', password: 'pw-123456', role: 'sales' } });
    assert.equal(dup.status, 409);
    const fresh = await call(env.base, 'POST', '/api/users', { token: env.tokens.adminb, body: { name: 'X', username: 'salesb', password: 'pw-123456', role: 'sales' } });
    assert.equal(fresh.status, 201, fresh.text);
  } finally {
    env.server.close();
  }
});

// ─── Super admin: companies (PWA vCompanies / mCompany / saveCompany / coStats) ───

test('companies: create with PWA field aliases, Trial gets a 15-day trialEnd, Login ID must be globally free', async () => {
  const env = await buildEnv();
  try {
    const taken = await call(env.base, 'POST', '/api/companies', { token: env.tokens.root, body: { company: { name: 'Gamma', divs: ['MEP'] }, admin: { username: 'admina', password: 'pw-123456' } } });
    assert.equal(taken.status, 409);
    assert.equal(env.state.companies.length, 2, 'no orphan company when the Login ID is taken');

    const created = await call(env.base, 'POST', '/api/companies', {
      token: env.tokens.root,
      body: {
        company: { name: 'Gamma', city: 'Mumbai', addr: 'Plot 1', gst: '27ABC', divs: ['MEP', 'HVAC'], status: 'Trial', contacts: [{ n: 'Ravi', ph: '999' }] },
        admin: { username: 'gamma_admin', password: 'pw-123456' },
      },
    });
    assert.equal(created.status, 201, created.text);
    const c = created.json.company;
    assert.equal(c.address, 'Plot 1');
    assert.equal(c.gstNumber, '27ABC');
    assert.deepEqual(c.divisions, ['HVAC', 'MEP']);
    assert.equal(c.contacts[0].name, 'Ravi');
    const days = Math.round((new Date(c.trialEnd) - new Date(c.since)) / 86400000);
    assert.equal(days, 15);
    assert.equal(created.json.admin.name, 'Ravi', 'admin name defaults to contact 1 (PWA index.html:1740)');

    const detail = await call(env.base, 'GET', `/api/companies/${c.id}`, { token: env.tokens.root });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.adminUsername, 'gamma_admin');
    assert.ok(!('passwordHash' in detail.json), 'no password material on the company detail');
    assert.ok(!JSON.stringify(detail.json).includes('passwordHash'));
  } finally {
    env.server.close();
  }
});

test('companies: Active requires rate + start; edit can rename the admin Login ID and reset its password', async () => {
  const env = await buildEnv();
  try {
    const noRate = await call(env.base, 'PATCH', `/api/companies/${CO_B}`, { token: env.tokens.root, body: { status: 'Active' } });
    assert.equal(noRate.status, 400);
    assert.match(noRate.json.error, /Set subscription rate and start date for Active status/);

    const edit = await call(env.base, 'PATCH', `/api/companies/${CO_B}`, {
      token: env.tokens.root,
      body: { status: 'Active', subscriptionRate: 900, subscriptionStart: '2026-10-01', admin: { username: 'beta_admin', password: 'fresh-pass-9' } },
    });
    assert.equal(edit.status, 200, edit.text);
    const relog = await call(env.base, 'POST', '/api/auth/login', { body: { username: 'beta_admin', password: 'fresh-pass-9' } });
    assert.equal(relog.status, 200);
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.adminb })).status, 401, 'old session revoked');

    const clash = await call(env.base, 'PATCH', `/api/companies/${CO_B}`, { token: env.tokens.root, body: { admin: { username: 'admina' } } });
    assert.equal(clash.status, 409);
  } finally {
    env.server.close();
  }
});

test('companies: platform usage is super-only and counts per company (PWA coStats)', async () => {
  const env = await buildEnv();
  try {
    env.state.salesOrders.push({ id: 'so1', companyId: CO_A, orderValue: 50000, division: 'HVAC' });
    env.state.projects.push({ id: 'p1', companyId: CO_A, stage: 'Installation', division: 'HVAC' });
    assert.equal((await call(env.base, 'GET', '/api/companies/platform/usage', { token: env.tokens.admina })).status, 403);
    const res = await call(env.base, 'GET', '/api/companies/platform/usage', { token: env.tokens.root });
    assert.equal(res.status, 200);
    const a = res.json.usage.find((r) => r.companyId === CO_A);
    const b = res.json.usage.find((r) => r.companyId === CO_B);
    assert.equal(a.sos, 1);
    assert.equal(a.prj, 1);
    assert.equal(a.users, 4);
    assert.equal(b.sos, 0);
    assert.equal(b.users, 1);
  } finally {
    env.server.close();
  }
});

// ─── Division entitlement (owner decision 3: enforced on the server) ───

test('divisions: a company cannot create records in a division it has not purchased; AMC enquiries stay allowed', async () => {
  const env = await buildEnv();
  try {
    const solar = await call(env.base, 'POST', '/api/enquiries', { token: env.tokens.salesa, body: { name: 'Roof', segment: 'Solar' } });
    assert.equal(solar.status, 403, solar.text);
    const hvac = await call(env.base, 'POST', '/api/enquiries', { token: env.tokens.salesa, body: { name: 'Office AC', segment: 'HVAC' } });
    assert.equal(hvac.status, 201, hvac.text);
    const amc = await call(env.base, 'POST', '/api/enquiries', { token: env.tokens.salesa, body: { name: 'AMC renewal', segment: 'AMC' } });
    assert.equal(amc.status, 201, amc.text);
    const q = await call(env.base, 'POST', '/api/quotations', { token: env.tokens.salesa, body: { division: 'Solar', customerName: 'X' } });
    assert.ok([400, 403].includes(q.status), `Solar quotation for an HVAC-only company must be refused (got ${q.status})`);
  } finally {
    env.server.close();
  }
});

// ─── Solar quotation GST (owner decision 4: sum of per-item GST) ───

test('quotations: Solar GST is the sum of per-line GST (default 18%); other divisions use one GST % on the subtotal', () => {
  const lines = calculateLineTotals([
    { qty: 1, supplyRate: 1000, installationRate: 0 },
    { qty: 2, supplyRate: 500, installationRate: 0, gstPercent: 5 },
  ], 'Solar');
  assert.deepEqual(lines.map((l) => l.gstPercent), [18, 5]);
  const t = calculateTotals(lines, [], 18, 'Solar');
  assert.equal(t.gstAmount, 180 + 50);
  assert.equal(t.gstPercent, null);

  const h = calculateLineTotals([{ qty: 1, supplyRate: 1000, installationRate: 0 }], 'HVAC');
  const th = calculateTotals(h, [], 18, 'HVAC');
  assert.equal(th.gstAmount, 180);
  const zero = calculateTotals(h, [], 0, 'HVAC');
  assert.equal(zero.gstAmount, 0, '0% GST is a valid choice, not "missing"');
});

// ─── Dashboard / engineer / inventory endpoints ───

test('dashboard: role dashboard is company-scoped and refused for roles that use their own dashboards', async () => {
  const env = await buildEnv();
  try {
    env.state.enquiries.push({ id: 'e1', companyId: CO_A, name: 'A', segment: 'HVAC', status: 'Open', estimatedValue: 100 });
    env.state.enquiries.push({ id: 'e2', companyId: CO_B, name: 'B', segment: 'Solar', status: 'Open', estimatedValue: 999 });
    const res = await call(env.base, 'GET', '/api/dashboard', { token: env.tokens.admina });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.dashboard);
    assert.ok(!JSON.stringify(res.json).includes('"e2"'), 'no other-tenant records');
    assert.equal((await call(env.base, 'GET', '/api/dashboard', { token: env.tokens.enga })).status, 403);
    assert.equal((await call(env.base, 'GET', '/api/dashboard', { token: env.tokens.root })).status, 403);
  } finally {
    env.server.close();
  }
});

test('service calls /mine returns only the caller\'s own assigned calls', async () => {
  const env = await buildEnv();
  try {
    env.state.serviceCalls.push(
      { id: 'sc1', companyId: CO_A, engineerId: 'u_eng_a', status: 'Assigned', callType: 'Complaint' },
      { id: 'sc2', companyId: CO_A, engineerId: 'someone_else', status: 'Assigned', callType: 'Complaint' }
    );
    const res = await call(env.base, 'GET', '/api/service-calls/mine', { token: env.tokens.enga });
    assert.equal(res.status, 200, res.text);
    const ids = (res.json.serviceCalls || res.json.calls || []).map((c) => c.id);
    assert.ok(!ids.includes('sc2'));
  } finally {
    env.server.close();
  }
});

test('inventory: issues list is available to inventory staff and tenant-scoped', async () => {
  const env = await buildEnv();
  try {
    env.state.inventoryIssues.push(
      { id: 'iss1', companyId: CO_A, itemId: 'x', qty: 2, issuedTo: 'u_eng_a', status: 'Issued' },
      { id: 'iss2', companyId: CO_B, itemId: 'y', qty: 1, issuedTo: 'u_admin_b', status: 'Issued' }
    );
    const res = await call(env.base, 'GET', '/api/inventory/issues', { token: env.tokens.inva });
    assert.equal(res.status, 200, res.text);
    const ids = (res.json.issues || []).map((i) => i.id);
    assert.ok(ids.includes('iss1'));
    assert.ok(!ids.includes('iss2'));
  } finally {
    env.server.close();
  }
});

test('companies: deleting a company also removes its subscription and users (PWA delCompany cascade + subscription)', async () => {
  const env = await buildEnv();
  try {
    env.state.subscriptions.push({ id: 'sub_b', companyId: CO_B, planCode: 'SOLAR_STARTER', purchasedDivisions: ['Solar'], status: 'Active', auditLog: [] });
    const del = await call(env.base, 'DELETE', `/api/companies/${CO_B}`, { token: env.tokens.root });
    assert.equal(del.status, 200, del.text);
    assert.equal(env.state.subscriptions.filter((s) => s.companyId === CO_B).length, 0);
    assert.equal(env.state.users.filter((u) => u.companyId === CO_B).length, 0);
    assert.equal(env.state.companies.filter((c) => c.id === CO_B).length, 0);
  } finally {
    env.server.close();
  }
});

test('AMC document: {{contractAmount}} is rupee-formatted and {{contractPeriod}} is the contract length (not the cadence)', async () => {
  const { contractPeriodText, formatRupees, generateAmcDocument } = require('../src/services/amcDocumentService');
  assert.equal(formatRupees(150000), '₹ 1,50,000');
  assert.equal(contractPeriodText('2026-01-01', '2026-12-31'), '1 Year');
  assert.equal(contractPeriodText('2026-01-01', '2027-12-31'), '2 Years');
  assert.equal(contractPeriodText('2026-01-01', '2026-06-30'), '6 Months');
  assert.equal(contractPeriodText(null, '2026-06-30'), '');

  const deps = createDevRepositories();
  deps.store.state.companies.push({ id: CO_A, name: 'Alpha HVAC', divisions: ['HVAC'], status: 'Active' });
  deps.store.state.contracts.push({ id: 'k1', companyId: CO_A, customer: 'Cust', amcType: 'Quarterly', amount: 50000, startDate: '2026-04-01', endDate: '2027-03-31' });
  const doc = await generateAmcDocument(CO_A, 'k1', 'amc-letter', deps);
  const text = doc.template.sections.map((s) => s.content).join('\n');
  assert.ok(!/\{\{\w+\}\}/.test(text), 'no unsubstituted placeholders');
  const proposal = doc.template.sections.find((s) => /proposal/i.test(s.key || '') || /maintenance contract is/.test(s.content || ''));
  assert.ok(proposal, 'the AMC letter carries the proposal paragraph');
  assert.match(proposal.content, /₹ 50,000 for 1 Year/);
  assert.ok(!/for Quarterly/.test(proposal.content));
});

// ─── Sales Order margins (PWA vSO index.html:2047 / dlSOs index.html:3426) ───

test('sales orders: margin arithmetic matches the PWA, including the actual-expense fallback', () => {
  const { computeMargins } = require('../src/services/salesOrderService');

  // Straightforward case: both margins positive.
  assert.deepEqual(
    computeMargins({ highSideSelling: 100000, highSidePurchase: 70000, lowSideCost: 40000, lowSideActualExpense: 25000, lowSideTargetExpense: 30000 }),
    { equipmentMargin: 30000, accessoriesMargin: 15000, totalMargin: 45000 }
  );
  // PWA FACT: with no actual expense recorded, the target expense is used.
  assert.deepEqual(
    computeMargins({ highSideSelling: 0, highSidePurchase: 0, lowSideCost: 40000, lowSideTargetExpense: 30000 }),
    { equipmentMargin: 0, accessoriesMargin: 10000, totalMargin: 10000 }
  );
  // PWA FACT: an actual expense of exactly 0 is falsy, so it also falls back
  // to the target rather than reporting the full cost as margin.
  assert.equal(computeMargins({ lowSideCost: 40000, lowSideActualExpense: 0, lowSideTargetExpense: 30000 }).accessoriesMargin, 10000);
  // Neither recorded: the whole accessories cost is margin.
  assert.equal(computeMargins({ lowSideCost: 40000 }).accessoriesMargin, 40000);
  // Missing fields are zero, never NaN.
  assert.deepEqual(computeMargins({}), { equipmentMargin: 0, accessoriesMargin: 0, totalMargin: 0 });
  // A loss is reported as a negative margin, not clamped.
  assert.equal(computeMargins({ highSideSelling: 50000, highSidePurchase: 80000 }).totalMargin, -30000);
});

test('sales orders: margins reach the detail API but are withheld from cost-hidden roles', async () => {
  const env = await buildEnv();
  try {
    const so = {
      id: 'so_m1', companyId: CO_A, orderNumber: 1001, division: 'HVAC', projectName: 'Margin test',
      startDate: new Date('2026-04-01'), totalCost: 140000,
      highSideSelling: 100000, highSidePurchase: 70000,
      lowSideCost: 40000, lowSideTargetExpense: 30000, lowSideActualExpense: 25000,
      paymentMilestones: [],
    };
    env.state.salesOrders.push(so);

    const admin = await call(env.base, 'GET', '/api/sales-orders/so_m1', { token: env.tokens.admina });
    assert.equal(admin.status, 200, admin.text);
    assert.deepEqual(admin.json.salesOrder.margins, { equipmentMargin: 30000, accessoriesMargin: 15000, totalMargin: 45000 });

    // PWA FACT (showCost, index.html:2035): engineer and service_eng never see
    // costing. They cannot read the SO at all here, and must not receive the
    // derived margins by any route.
    const eng = await call(env.base, 'GET', '/api/sales-orders/so_m1', { token: env.tokens.enga });
    assert.equal(eng.status, 403);
    assert.ok(!eng.text.includes('margin'), 'no margin data in a refused response');
  } finally {
    env.server.close();
  }
});

test('sales orders: CSV carries the Equipment/Accessories headers and the PWA total-margin column', async () => {
  const env = await buildEnv();
  try {
    env.state.salesOrders.push({
      id: 'so_m2', companyId: CO_A, orderNumber: 1002, division: 'HVAC', projectName: 'CSV margin',
      startDate: new Date('2026-04-01'), totalCost: 140000,
      highSideSelling: 100000, highSidePurchase: 70000,
      lowSideCost: 40000, lowSideTargetExpense: 30000, lowSideActualExpense: 25000,
      paymentMilestones: [],
    });
    const res = await call(env.base, 'GET', '/api/sales-orders/export.csv', { token: env.tokens.admina });
    assert.equal(res.status, 200, res.text);
    const header = res.text.split('\n').find((l) => l.startsWith('SO No,'));
    assert.ok(header, `header row present in: ${res.text.slice(0, 200)}`);
    assert.ok(header.includes('Equipment Selling'));
    assert.ok(header.includes('Accessories Actual Exp'));
    assert.ok(header.includes('Total Margin'));
    assert.ok(!/High Side|Low Side/.test(header), 'old PWA wording is gone from the export');
    // Column order is unchanged from the PWA: 22 columns, Total Margin 19th.
    const cols = header.split(',');
    assert.equal(cols.length, 22);
    assert.equal(cols[18], 'Total Margin');
    assert.ok(res.text.includes(',45000,'), 'the exported margin is the computed one');
  } finally {
    env.server.close();
  }
});

/* ===== Projects list: PWA `vProjects` derived columns + server-side scoping ===== */

test('projects list: ?view=full returns every derived column the PWA list shows', async () => {
  const env = await buildEnv();
  try {
    const { state } = env;
    state.salesOrders.push({
      id: 'so_p1', companyId: CO_A, orderNumber: 2001, division: 'HVAC', projectName: 'Tower A',
      startDate: new Date('2026-01-10'),
      paymentMilestones: [{ description: 'Advance', amount: 100000, received: true }, { description: 'On delivery', amount: 50000, received: false }],
    });
    state.projects.push({
      id: 'p_full', companyId: CO_A, salesOrderId: 'so_p1', division: 'HVAC', name: 'Tower A',
      siteType: 'Commercial', capacity: '20 TR', customer: 'Acme', stage: 'Installation', status: 'Ongoing',
      startDate: new Date('2026-01-10'), assignedEngineerIds: ['u_eng_a'], timelineSet: true,
      checklist: [
        { text: 'Foundation', done: true, targetDate: new Date('2026-02-01') },
        { text: 'Ducting', done: false, targetDate: new Date('2026-02-10') },
      ],
      executionUpdates: [{ date: new Date('2026-02-05'), workDone: 'Ducting started', nextAction: 'Insulation', nextActionDate: new Date('2026-02-20') }],
      deliveryChallans: [
        { challanNumber: '1', date: new Date('2026-02-01'), materialName: 'Copper pipe', quantity: 10, unit: 'Mtr', returnable: true, returnedQuantity: 4 },
        { challanNumber: '1', date: new Date('2026-02-01'), materialName: 'Tape', quantity: 5, unit: 'Nos', returnable: false, returnedQuantity: 0 },
      ],
    });
    const res = await call(env.base, 'GET', '/api/projects?view=full', { token: env.tokens.admina });
    assert.equal(res.status, 200, res.text);
    const row = (res.json.projects || []).find((p) => p.id === 'p_full');
    assert.ok(row, 'the project is listed');
    assert.equal(row.orderNumber, 2001, 'SO No comes from the linked sales order');
    assert.deepEqual(row.engineerNames, ['enga'], 'engineers are named, never shown as ids');
    assert.equal(row.checklistDone, 1);
    assert.equal(row.checklistTotal, 2);
    assert.equal(row.timelineSetReady, true);
    assert.equal(row.targetEnd, '2026-02-10', 'target end is the latest checklist target date');
    assert.equal(row.nextAction, 'Insulation');
    assert.equal(row.nextActionDate, '2026-02-20');
    // Both checklist target dates are in the past relative to "today" in any
    // run after Feb 2026, so the undone point counts as overdue.
    assert.equal(row.overduePoints, 1);
    assert.equal(row.payment.received, 100000, 'a received milestone counts in full');
    assert.equal(row.payment.pending, 50000);
    assert.equal(row.materialPendingReturn, 6, 'returnable qty minus what came back (10-4), consumables excluded');
    // The lean payload stays lean for callers that do not ask for the columns.
    const lean = await call(env.base, 'GET', '/api/projects', { token: env.tokens.admina });
    assert.equal(lean.json.projects.find((p) => p.id === 'p_full').orderNumber, undefined);
  } finally {
    env.server.close();
  }
});

test('projects list: only admin and PM roles get the company list; an engineer gets only their own; others are refused', async () => {
  const env = await buildEnv();
  try {
    env.state.projects.push(
      { id: 'p_mine', companyId: CO_A, division: 'HVAC', name: 'Mine', stage: 'Installation', status: 'Ongoing', startDate: new Date(), assignedEngineerIds: ['u_eng_a'], checklist: [] },
      { id: 'p_theirs', companyId: CO_A, division: 'HVAC', name: 'Theirs', stage: 'Installation', status: 'Ongoing', startDate: new Date(), assignedEngineerIds: ['someone_else'], checklist: [] }
    );
    const admin = await call(env.base, 'GET', '/api/projects', { token: env.tokens.admina });
    assert.equal(admin.status, 200);
    assert.equal(admin.json.projects.length, 2, 'admin sees the whole company list');

    const eng = await call(env.base, 'GET', '/api/projects', { token: env.tokens.enga });
    assert.equal(eng.status, 200, eng.text);
    assert.deepEqual(eng.json.projects.map((p) => p.id), ['p_mine'], 'an engineer sees only their own assignments');

    // Roles with no Projects menu in the PWA cannot read the list at all.
    for (const token of ['salesa', 'inva']) {
      const res = await call(env.base, 'GET', '/api/projects', { token: env.tokens[token] });
      assert.equal(res.status, 403, `${token} must not read the projects list`);
    }
  } finally {
    env.server.close();
  }
});

test('project detail: the linked sales order number is resolved for the printed delivery challan', async () => {
  const env = await buildEnv();
  try {
    env.state.salesOrders.push({ id: 'so_dc', companyId: CO_A, orderNumber: 3003, division: 'HVAC', projectName: 'DC job', startDate: new Date(), paymentMilestones: [] });
    env.state.projects.push({ id: 'p_dc', companyId: CO_A, salesOrderId: 'so_dc', division: 'HVAC', name: 'DC job', stage: 'Installation', status: 'Ongoing', startDate: new Date(), checklist: [], deliveryChallans: [] });
    const res = await call(env.base, 'GET', '/api/projects/p_dc', { token: env.tokens.admina });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.project.salesOrderNumber, 3003);
  } finally {
    env.server.close();
  }
});

/* ===== Payments: display enrichment, search and the report preamble ===== */

test('payments: the ledger resolves SO numbers and user names, never leaking internal ids', async () => {
  const env = await buildEnv();
  try {
    env.state.salesOrders.push({ id: 'so_pay', companyId: CO_A, orderNumber: 4004, division: 'HVAC', projectName: 'Pay job', startDate: new Date(), paymentMilestones: [{ description: 'Advance', amount: 90000, received: false }] });
    env.state.payments.push({
      id: 'pay_e', companyId: CO_A, salesOrderId: 'so_pay', milestoneIndex: 0, projectOrReference: 'Pay job',
      personName: 'Ravi', phone: '900', amount: 90000, status: 'Pending',
      partPayments: [{ id: 'pp1', amount: 40000, date: new Date('2026-03-01'), mode: 'UPI', recordedByUserId: 'u_admin_a', editedByUserId: 'u_sales_a', editedOn: new Date('2026-03-02') }],
      raisedToFinance: { raisedByUserId: 'u_admin_a', raisedByRole: 'admin', raisedDate: new Date('2026-03-03'), collectByDate: new Date('2026-03-10'), priority: 'Urgent', note: 'client promised' },
    });
    const res = await call(env.base, 'GET', '/api/payments', { token: env.tokens.admina });
    assert.equal(res.status, 200, res.text);
    const row = res.json.payments.find((p) => p.id === 'pay_e');
    assert.equal(row.orderNumber, 4004);
    assert.equal(row.partPayments[0].recordedByName, 'admina');
    assert.equal(row.partPayments[0].editedByName, 'salesa');
    assert.equal(row.raisedToFinance.raisedByName, 'admina');
    assert.ok(!/u_admin_a/.test(JSON.stringify({ n: row.partPayments[0].recordedByName, r: row.raisedToFinance.raisedByName })));
  } finally {
    env.server.close();
  }
});

test('payments CSV: carries the PWA report preamble and honours the screen search', async () => {
  const env = await buildEnv();
  try {
    env.state.payments.push(
      { id: 'pay_a', companyId: CO_A, projectOrReference: 'Alpha Tower', personName: 'Ravi', phone: '900', amount: 10000, status: 'Pending', partPayments: [] },
      { id: 'pay_b', companyId: CO_A, projectOrReference: 'Beta Plaza', personName: 'Sunil', phone: '901', amount: 20000, status: 'Pending', partPayments: [] }
    );
    const all = await call(env.base, 'GET', '/api/payments/export/pending.csv', { token: env.tokens.admina });
    assert.equal(all.status, 200);
    const lines = all.text.split('\n');
    assert.match(lines[0], /^PAYMENTS REPORT — Alpha HVAC/, 'the file names the company');
    assert.match(lines[1], /^Generated,\d{4}-\d{2}-\d{2} by admina \(Admin\)/, 'and who ran it');
    assert.ok(all.text.includes('Alpha Tower') && all.text.includes('Beta Plaza'));

    const filtered = await call(env.base, 'GET', '/api/payments/export/pending.csv?q=beta', { token: env.tokens.admina });
    assert.equal(filtered.status, 200);
    assert.match(filtered.text.split('\n')[2], /^Filter,search: beta/, 'the applied filter is recorded in the file');
    assert.ok(filtered.text.includes('Beta Plaza'));
    assert.ok(!filtered.text.includes('Alpha Tower'), 'the export matches the filtered screen');
  } finally {
    env.server.close();
  }
});

// ─── Final integration pass (16 Oct 2026): PWA-parity rules found by e2e/completion/integration-api.js ───

test('company configuration: super (no company) cannot create payment-term or AMC templates; company admins still can', async () => {
  const env = await buildEnv();
  try {
    const ptt = { name: 'Standard', documentType: 'quotation', rows: [{ label: 'Advance', percentage: 100 }] };
    const sp = await call(env.base, 'POST', '/api/payment-term-templates', { token: env.tokens.root, body: ptt });
    assert.equal(sp.status, 403, sp.text);
    assert.equal(sp.json.code, 'COMPANY_CONTEXT_REQUIRED');
    const sa = await call(env.base, 'PUT', '/api/amc-documents/templates', { token: env.tokens.root, body: { type: 'amc-letter', name: 'x', sections: [] } });
    assert.equal(sa.status, 403, sa.text);
    assert.equal(sa.json.code, 'COMPANY_CONTEXT_REQUIRED');
    assert.equal(env.state.paymentTermTemplates ? env.state.paymentTermTemplates.filter((t) => !t.companyId).length : 0, 0, 'no ownerless template was stored');
    const ap = await call(env.base, 'POST', '/api/payment-term-templates', { token: env.tokens.admina, body: ptt });
    assert.equal(ap.status, 201, ap.text);
    assert.equal(String(ap.json.template.companyId), CO_A);
    const aa = await call(env.base, 'PUT', '/api/amc-documents/templates', { token: env.tokens.admina, body: { type: 'amc-letter', name: 'Alpha letter', sections: [] } });
    assert.equal(aa.status, 200, aa.text);
  } finally {
    env.server.close();
  }
});

test('subscription plan catalogue is super-only (list and single plan)', async () => {
  const env = await buildEnv();
  try {
    await call(env.base, 'POST', '/api/subscriptions/plans/seed', { token: env.tokens.root });
    assert.equal((await call(env.base, 'GET', '/api/subscriptions/plans', { token: env.tokens.root })).status, 200);
    for (const u of ['admina', 'salesa', 'enga', 'inva', 'adminb']) {
      assert.equal((await call(env.base, 'GET', '/api/subscriptions/plans', { token: env.tokens[u] })).status, 403, `${u} list`);
      assert.equal((await call(env.base, 'GET', '/api/subscriptions/plans/hvac_starter', { token: env.tokens[u] })).status, 403, `${u} single`);
    }
    // Company users keep their own entitlement endpoint.
    assert.equal((await call(env.base, 'GET', '/api/subscriptions/my-divisions', { token: env.tokens.salesa })).status, 200);
  } finally {
    env.server.close();
  }
});

test('users: a deactivation request is refused (400 UNSUPPORTED_FIELD) instead of a silent 200; removal still works', async () => {
  const env = await buildEnv();
  try {
    const r = await call(env.base, 'PATCH', '/api/users/u_sales_a', { token: env.tokens.admina, body: { active: false } });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.code, 'UNSUPPORTED_FIELD');
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.salesa })).status, 200, 'the user was not changed');
    const ok = await call(env.base, 'PATCH', '/api/users/u_sales_a', { token: env.tokens.admina, body: { name: 'Sales A' } });
    assert.equal(ok.status, 200, ok.text);
    const del = await call(env.base, 'DELETE', '/api/users/u_sales_a', { token: env.tokens.admina });
    assert.equal(del.status, 200, del.text);
    assert.equal((await call(env.base, 'GET', '/api/auth/me', { token: env.tokens.salesa })).status, 401, 'a removed user is cut off at once');
  } finally {
    env.server.close();
  }
});
