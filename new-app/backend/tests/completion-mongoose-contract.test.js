'use strict';

/**
 * FINAL COMPLETION ORDER — production repository contract tests for the
 * repository methods added in the completion pass, through the REAL
 * src/app.js assembly and the REAL Mongoose repositories against an
 * ISOLATED, THROWAWAY database.
 *
 * Opt-in, same safety rails as tests/stage7-mongoose-contract.test.js:
 * skipped unless MEP_TEST_MONGO_URI is set; database name must start with
 * "mep_test_"; "mep_new_app" is always refused; the database is dropped
 * before and after.
 *
 *   MEP_TEST_MONGO_URI=mongodb://127.0.0.1:27017 MEP_TEST_MONGO_DB=mep_test_completion \
 *     node --test tests/completion-mongoose-contract.test.js
 *
 * NEVER point this at the live VPS database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const URI = process.env.MEP_TEST_MONGO_URI || '';
const DB_NAME = process.env.MEP_TEST_MONGO_DB || (() => {
  try { return new URL(URI).pathname.replace(/^\//, ''); } catch { return ''; }
})();
const SKIP_REASON = !URI
  ? 'MEP_TEST_MONGO_URI not set (opt-in database contract tests)'
  : !DB_NAME.startsWith('mep_test_') || DB_NAME === 'mep_new_app'
    ? `refusing database "${DB_NAME}": test database name must start with "mep_test_"`
    : false;

const CONFIG = { authTokenSecret: 'completion-contract-secret-not-for-production', authTokenExpiry: '1h', port: 0 };
const PASSWORD = 'contract-test-password';

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

test('mongoose contract: completion-pass repositories through the real production app', { skip: SKIP_REASON }, async (t) => {
  await mongoose.connect(URI, { dbName: DB_NAME });
  assert.equal(mongoose.connection.db.databaseName, DB_NAME);
  assert.notEqual(mongoose.connection.db.databaseName, 'mep_new_app');
  await mongoose.connection.db.dropDatabase();

  const { createApp } = require('../src/app');
  const { Company, User, Project, InventoryItem, InventoryLocation, Subscription, AuthSession } = require('../src/models');
  const { hashPassword } = require('../src/auth/passwordHasher');
  const repos = require('../src/repositories/businessRepositories.mongoose');
  const { PROJECT_STAGES_BY_DIVISION } = require('../src/models/shared/enums');

  const server = await new Promise((resolve) => { const s = createApp(CONFIG).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (username, extra = {}) => call(base, 'POST', '/api/auth/login', { body: { username, password: PASSWORD, ...extra } });

  try {
    const since = new Date();
    const coA = await Company.create({ name: 'Alpha', divisions: ['HVAC'], status: 'Trial', since });
    const coB = await Company.create({ name: 'Beta', divisions: ['Solar'], status: 'Trial', since });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { name: 'Root', username: 'root', role: 'super', passwordHash, active: true },
      { companyId: coA._id, name: 'Admin A', username: 'admina', role: 'admin', passwordHash, active: true },
      { companyId: coA._id, name: 'Sales A', username: 'salesa', role: 'sales', passwordHash, active: true },
      { companyId: coA._id, name: 'Eng A', username: 'enga', role: 'engineer', passwordHash, active: true },
      { companyId: coA._id, name: 'Inv A', username: 'inva', role: 'inventory', passwordHash, active: true },
      { companyId: coB._id, name: 'Admin B', username: 'adminb', role: 'admin', passwordHash, active: true },
    ]);
    const tokens = {};
    for (const u of ['root', 'admina', 'salesa', 'enga', 'inva', 'adminb']) {
      const res = await login(u);
      assert.equal(res.status, 200, `login ${u} without companyId: ${res.text}`);
      tokens[u] = res.json.token;
    }

    await t.test('userRepo.findLoginCandidates: a legacy duplicate username is ambiguous; companyId disambiguates', async () => {
      await User.create({ companyId: coB._id, name: 'Dup', username: 'salesa', role: 'sales', passwordHash, active: true });
      const amb = await login('salesa');
      assert.equal(amb.status, 401);
      assert.match(amb.json.error, /more than one account/i);
      const ok = await login('salesa', { companyId: String(coB._id) });
      assert.equal(ok.status, 200, ok.text);
      await User.deleteOne({ companyId: coB._id, username: 'salesa' });
    });

    await t.test('sessionRepo.revokeAllForUser: password change ends existing sessions', async () => {
      const sales = await User.findOne({ username: 'salesa', companyId: coA._id }).lean();
      const res = await call(base, 'PATCH', `/api/users/${sales._id}`, { token: tokens.admina, body: { password: 'changed-pass-1' } });
      assert.equal(res.status, 200, res.text);
      assert.equal((await call(base, 'GET', '/api/auth/me', { token: tokens.salesa })).status, 401);
      assert.equal(await AuthSession.countDocuments({ userId: sales._id, revokedAt: null }), 0);
    });

    await t.test('userRepo.existsByUsername: company Login IDs are globally unique (409, no orphan company)', async () => {
      const before = await Company.countDocuments({});
      const res = await call(base, 'POST', '/api/companies', { token: tokens.root, body: { company: { name: 'Gamma', divisions: ['MEP'] }, admin: { username: 'adminb', password: 'pw-123456' } } });
      assert.equal(res.status, 409, res.text);
      assert.equal(await Company.countDocuments({}), before);
    });

    await t.test('companies: detail returns the admin Login ID; platform usage counts users per company', async () => {
      const detail = await call(base, 'GET', `/api/companies/${coA.id}`, { token: tokens.root });
      assert.equal(detail.status, 200, detail.text);
      assert.equal(detail.json.adminUsername, 'admina');
      assert.ok(!detail.text.includes('passwordHash'));
      const usage = await call(base, 'GET', '/api/companies/platform/usage', { token: tokens.root });
      assert.equal(usage.status, 200, usage.text);
      assert.equal(usage.json.usage.find((r) => r.companyId === coA.id).users, 4);
    });

    await t.test('projectRepo.update optimistic lock: a stale revision is a 409 CONFLICT and does not write', async () => {
      const p = await Project.create({
        companyId: coA._id, salesOrderId: new mongoose.Types.ObjectId(), division: 'HVAC', name: 'Lock test',
        stage: PROJECT_STAGES_BY_DIVISION.HVAC[0], startDate: new Date(),
      });
      const first = await repos.projectRepo.update(coA.id, p.id, { vendor: 'V1' }, null, { expectedRevision: 0 });
      assert.equal(first.revision, 1);
      await assert.rejects(
        () => repos.projectRepo.update(coA.id, p.id, { vendor: 'stale' }, null, { expectedRevision: 0 }),
        (err) => err.status === 409 && err.code === 'CONFLICT'
      );
      assert.equal((await Project.findById(p._id).lean()).vendor, 'V1');
      // Another tenant can never update it, guarded or not.
      assert.equal(await repos.projectRepo.update(coB.id, p.id, { vendor: 'x' }), null);
    });

    await t.test('inventoryItemRepo.incrementStockAtLocation: an over-large decrement is rejected and writes nothing', async () => {
      const loc = await InventoryLocation.create({ companyId: coA._id, name: 'Main store' });
      const item = await InventoryItem.create({ companyId: coA._id, name: 'Copper pipe', unit: 'Mtr', returnable: true, stockByLocation: { [loc.id]: 5 } });
      await repos.inventoryItemRepo.incrementStockAtLocation(coA.id, item.id, loc.id, -3);
      await assert.rejects(
        () => repos.inventoryItemRepo.incrementStockAtLocation(coA.id, item.id, loc.id, -3),
        /Insufficient stock/
      );
      assert.equal((await InventoryItem.findById(item._id).lean()).stockByLocation[loc.id], 2);
      // Another tenant's id never matches.
      assert.equal(await repos.inventoryItemRepo.incrementStockAtLocation(coB.id, item.id, loc.id, -1), null);
    });

    // Concurrency needs MongoDB's atomic single-document update semantics.
    // FerretDB v1 (the only MongoDB-compatible server available in the test
    // sandbox) was observed to report BOTH of two concurrent conditional
    // decrements as matched while applying only one, so this check is only
    // meaningful against a real MongoDB server.
    await t.test('inventoryItemRepo.incrementStockAtLocation: two concurrent issues cannot over-issue (real MongoDB only)',
      { skip: process.env.MEP_TEST_REAL_MONGODB === '1' ? false : 'set MEP_TEST_REAL_MONGODB=1 when MEP_TEST_MONGO_URI is a real MongoDB server (FerretDB lacks atomic conditional updates)' },
      async () => {
        const loc = await InventoryLocation.create({ companyId: coA._id, name: 'Race store' });
        const item = await InventoryItem.create({ companyId: coA._id, name: 'Race item', unit: 'Nos', returnable: true, stockByLocation: { [loc.id]: 5 } });
        const results = await Promise.allSettled([
          repos.inventoryItemRepo.incrementStockAtLocation(coA.id, item.id, loc.id, -3),
          repos.inventoryItemRepo.incrementStockAtLocation(coA.id, item.id, loc.id, -3),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.match(String(results.find((r) => r.status === 'rejected').reason.message), /Insufficient stock/);
        assert.equal((await InventoryItem.findById(item._id).lean()).stockByLocation[loc.id], 2);
      });

    await t.test('new read endpoints answer 200 against the real repositories', async () => {
      assert.equal((await call(base, 'GET', '/api/dashboard', { token: tokens.admina })).status, 200);
      assert.equal((await call(base, 'GET', '/api/service-calls/mine', { token: tokens.enga })).status, 200);
      assert.equal((await call(base, 'GET', '/api/inventory/issues', { token: tokens.inva })).status, 200);
      assert.equal((await call(base, 'GET', '/api/inventory/transactions', { token: tokens.inva })).status, 200);
    });

    await t.test('suspension: blocks login and existing sessions for that company only', async () => {
      const s = await call(base, 'POST', `/api/companies/${coB.id}/status`, { token: tokens.root, body: { status: 'Suspended' } });
      assert.equal(s.status, 200, s.text);
      assert.equal((await call(base, 'GET', '/api/auth/me', { token: tokens.adminb })).status, 401);
      assert.equal((await login('adminb')).json.error, 'Company subscription suspended. Contact provider.');
      assert.equal((await call(base, 'GET', '/api/auth/me', { token: tokens.admina })).status, 200);
    });

    // deleteCompany runs its cascade in a MongoDB transaction (replica set
    // required -- docs/STEP_6_API_TEST_HARDENING.md). FerretDB v1 rejects
    // transactional deletes ("unknown field autocommit"), so this runs only
    // against a real MongoDB replica set.
    await t.test('subscriptionRepo.deleteByCompany: deleting a company removes its subscription (real MongoDB only)',
      { skip: process.env.MEP_TEST_REAL_MONGODB === '1' ? false : 'set MEP_TEST_REAL_MONGODB=1 with a real MongoDB replica set (FerretDB has no transactions)' },
      async () => {
      await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
      const sub = await call(base, 'POST', `/api/subscriptions/company/${coB.id}`, { token: tokens.root, body: { planCode: 'SOLAR_STARTER', purchasedDivisions: ['Solar'] } });
      assert.equal(sub.status, 201, sub.text);
      assert.equal(await Subscription.countDocuments({ companyId: coB._id }), 1);
      const del = await call(base, 'DELETE', `/api/companies/${coB.id}`, { token: tokens.root });
      assert.equal(del.status, 200, del.text);
      assert.equal(await Subscription.countDocuments({ companyId: coB._id }), 0);
      assert.equal(await User.countDocuments({ companyId: coB._id }), 0);
    });
  } finally {
    server.close();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
