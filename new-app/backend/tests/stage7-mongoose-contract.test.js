'use strict';

/**
 * Production repository contract tests — the REAL src/app.js assembly with
 * the REAL Mongoose repositories against an ISOLATED, THROWAWAY test
 * database.
 *
 * Opt-in only. Skipped unless MEP_TEST_MONGO_URI is set, so `npm test`
 * never opens a database connection by default. Safety rails:
 *   - the database name MUST start with "mep_test_" (pass it in the URI
 *     path or via MEP_TEST_MONGO_DB);
 *   - "mep_new_app" (the production database name) is always refused;
 *   - the whole test database is dropped at the end.
 *
 * Example (local throwaway MongoDB-compatible server only):
 *   MEP_TEST_MONGO_URI=mongodb://127.0.0.1:27017 MEP_TEST_MONGO_DB=mep_test_contract \
 *     node --test tests/stage7-mongoose-contract.test.js
 *
 * NEVER point this at the live VPS database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const URI = process.env.MEP_TEST_MONGO_URI || '';
const DB_NAME = process.env.MEP_TEST_MONGO_DB || (() => {
  try {
    return new URL(URI).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();

const SKIP_REASON = !URI
  ? 'MEP_TEST_MONGO_URI not set (opt-in database contract tests)'
  : !DB_NAME.startsWith('mep_test_') || DB_NAME === 'mep_new_app'
    ? `refusing database "${DB_NAME}": test database name must start with "mep_test_"`
    : false;

const CONFIG = {
  authTokenSecret: 'stage7-mongoose-contract-test-secret-not-for-production',
  authTokenExpiry: '1h',
  port: 0,
};
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

test('mongoose contract: Stage 7 + subscription repositories through the real production app', { skip: SKIP_REASON }, async (t) => {
  await mongoose.connect(URI, { dbName: DB_NAME });
  assert.equal(mongoose.connection.db.databaseName, DB_NAME);
  assert.notEqual(mongoose.connection.db.databaseName, 'mep_new_app');
  await mongoose.connection.db.dropDatabase();

  const { createApp } = require('../src/app');
  const models = require('../src/models');
  const { hashPassword } = require('../src/auth/passwordHasher');
  const { Company, User, Plan, Subscription, Quotation, ItemName, AmcTemplate, PaymentTermTemplate } = models;

  const server = await new Promise((resolve) => {
    const s = createApp(CONFIG).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const since = new Date();
    const coA = await Company.create({ name: 'Alpha Contract Co', divisions: ['HVAC'], status: 'Trial', since });
    const coB = await Company.create({ name: 'Beta Contract Co', divisions: ['Solar'], status: 'Trial', since });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { name: 'Root', username: 'root', role: 'super', passwordHash, active: true },
      { companyId: coA._id, name: 'Admin A', username: 'admina', role: 'admin', passwordHash, active: true },
      { companyId: coA._id, name: 'Sales A', username: 'salesa', role: 'sales', passwordHash, active: true },
      { companyId: coB._id, name: 'Admin B', username: 'adminb', role: 'admin', passwordHash, active: true },
    ]);
    const tokens = {};
    for (const [username, companyId] of [['root', null], ['admina', coA.id], ['salesa', coA.id], ['adminb', coB.id]]) {
      const res = await call(base, 'POST', '/api/auth/login', { body: { username, password: PASSWORD, companyId } });
      assert.equal(res.status, 200, `login ${username}: ${res.text}`);
      tokens[username] = res.json.token;
    }

    await t.test('planRepo: seed creates the 7 plans once; custom price survives re-seed', async () => {
      const seeded = await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
      assert.equal(seeded.status, 200, seeded.text);
      assert.equal(seeded.json.plans.length, 7);
      const priced = await call(base, 'PATCH', '/api/subscriptions/plans/hvac_starter', { token: tokens.root, body: { pricing: { monthly: 4999 } } });
      assert.equal(priced.status, 200, priced.text);
      await call(base, 'POST', '/api/subscriptions/plans/seed', { token: tokens.root });
      assert.equal(await Plan.countDocuments({}), 7);
      const plan = await Plan.findOne({ code: 'HVAC_STARTER' }).lean();
      assert.deepEqual(plan.pricing, { monthly: 4999 });
      const dup = await call(base, 'POST', '/api/subscriptions/plans', { token: tokens.root, body: { code: 'HVAC_STARTER', name: 'Dup', availableDivisions: ['HVAC'] } });
      assert.equal(dup.status, 409, dup.text);
    });

    await t.test('subscriptionRepo: $push appends audit history without overwriting; Company.divisions synced', async () => {
      const a = await call(base, 'POST', `/api/subscriptions/company/${coA.id}`, { token: tokens.root, body: { planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'] } });
      assert.equal(a.status, 201, a.text);
      const b = await call(base, 'POST', `/api/subscriptions/company/${coA.id}`, { token: tokens.root, body: { planCode: 'MEP_HVAC_PRO', purchasedDivisions: ['HVAC', 'MEP'] } });
      assert.equal(b.status, 201, b.text);
      const c = await call(base, 'POST', `/api/subscriptions/company/${coA.id}`, { token: tokens.root, body: { planCode: 'FULL_ENTERPRISE', purchasedDivisions: ['HVAC', 'MEP', 'Solar'] } });
      assert.equal(c.status, 201, c.text);
      const subs = await Subscription.find({ companyId: coA._id }).lean();
      assert.equal(subs.length, 1);
      assert.deepEqual(subs[0].auditLog.map((e) => e.action), ['created', 'updated', 'updated']);
      assert.equal(subs[0].auditLog[1].details.previousPlan, 'HVAC_STARTER');
      assert.equal(subs[0].auditLog[2].details.previousPlan, 'MEP_HVAC_PRO');
      assert.ok(!('$push' in subs[0]));
      const company = await Company.findById(coA._id).lean();
      assert.deepEqual([...company.divisions].sort(), ['HVAC', 'MEP', 'Solar']);
      const mine = await call(base, 'GET', '/api/subscriptions/my-divisions', { token: tokens.salesa });
      assert.deepEqual(mine.json.divisions.sort(), ['HVAC', 'MEP', 'Solar']);
      assert.equal((await call(base, 'GET', `/api/subscriptions/company/${coA.id}`, { token: tokens.adminb })).status, 403);
    });

    let quotationId;
    await t.test('quotationRepo + itemNameRepo + counterRepo: create, number sequence, list filters, update, CSV', async () => {
      const q1 = await call(base, 'POST', '/api/quotations', {
        token: tokens.salesa,
        body: {
          division: 'HVAC', customerName: 'Contract Client',
          equipmentItems: [{ description: 'VRF  Outdoor Unit', qty: 2, supplyRate: 50000, installationRate: 10000 }],
          accessoriesItems: [{ description: 'Copper Pipe', qty: 10, supplyRate: 500, installationRate: 200 }],
          paymentTerms: [{ sequence: 1, label: 'Advance', percentage: '40%' }],
        },
      });
      assert.equal(q1.status, 201, q1.text);
      assert.equal(q1.json.quotation.grandTotal, 149860);
      quotationId = q1.json.quotation.id;
      const q2 = await call(base, 'POST', '/api/quotations', { token: tokens.salesa, body: { division: 'MEP', customerName: 'Other' } });
      assert.equal(q2.status, 201, q2.text);
      const n1 = Number(q1.json.quotation.quotationNumber.split('-')[1]);
      const n2 = Number(q2.json.quotation.quotationNumber.split('-')[1]);
      assert.equal(n2, n1 + 1);

      const stored = await Quotation.findById(quotationId).lean();
      assert.equal(String(stored.companyId), coA.id);
      assert.equal(stored.equipmentItems[0].sNo, 1);

      const filtered = await call(base, 'GET', '/api/quotations?division=HVAC&customerName=contract', { token: tokens.salesa });
      assert.equal(filtered.json.quotations.length, 1);
      const regexSafe = await call(base, 'GET', `/api/quotations?customerName=${encodeURIComponent('(')}`, { token: tokens.salesa });
      assert.equal(regexSafe.status, 200);
      assert.equal(regexSafe.json.quotations.length, 0);

      const upd = await call(base, 'PATCH', `/api/quotations/${quotationId}`, {
        token: tokens.salesa, body: { equipmentItems: [{ description: 'vrf outdoor unit', qty: 1, supplyRate: 1000 }] },
      });
      assert.equal(upd.status, 200, upd.text);
      assert.equal(upd.json.quotation.equipmentTotal, 1000);
      // accessoriesItems kept from the stored document
      assert.equal(upd.json.quotation.accessoriesTotal, 7000);

      const names = await ItemName.find({ companyId: coA._id }).lean();
      const vrf = names.filter((n) => n.normalizedName === 'vrf outdoor unit');
      assert.equal(vrf.length, 1, 'normalized names are not duplicated');
      assert.equal(vrf[0].usageCount, 2);
      assert.equal(vrf[0].name, 'VRF  Outdoor Unit'.trim());
      const ac = await call(base, 'GET', '/api/item-names/autocomplete?division=HVAC&q=OUTDOOR', { token: tokens.salesa });
      assert.deepEqual(ac.json.items.map((i) => i.normalizedName), ['vrf outdoor unit']);
      const acOther = await call(base, 'GET', '/api/item-names/autocomplete?division=HVAC&q=outdoor', { token: tokens.adminb });
      assert.deepEqual(acOther.json.items, []);
      const empty = await call(base, 'GET', '/api/item-names/autocomplete?division=HVAC&q=', { token: tokens.salesa });
      // Empty query = most-used first (ties alphabetical).
      const counts = empty.json.items.map((i) => i.usageCount);
      assert.deepEqual(counts, [...counts].sort((x, y) => y - x));
      assert.deepEqual(empty.json.items.map((i) => i.normalizedName), ['copper pipe', 'vrf outdoor unit']);

      const csv = await call(base, 'GET', '/api/quotations/export/csv', { token: tokens.salesa });
      assert.ok(csv.text.includes('Contract Client'));

      assert.equal((await call(base, 'GET', `/api/quotations/${quotationId}`, { token: tokens.adminb })).status, 404);
      const dup = await call(base, 'POST', `/api/quotations/${quotationId}/duplicate`, { token: tokens.salesa });
      assert.equal(dup.status, 201, dup.text);
      assert.equal((await call(base, 'DELETE', `/api/quotations/${dup.json.quotation.id}`, { token: tokens.salesa })).status, 200);
      assert.equal(await Quotation.countDocuments({ companyId: coA._id }), 2);
    });

    await t.test('paymentTermTemplateRepo: CRUD, unique name per company (409), tenant isolation', async () => {
      const rows = [{ sequence: 1, label: 'Advance', percentage: '40%' }];
      const c = await call(base, 'POST', '/api/payment-term-templates', { token: tokens.admina, body: { name: 'Std', rows } });
      assert.equal(c.status, 201, c.text);
      const id = c.json.template.id;
      assert.equal((await call(base, 'POST', '/api/payment-term-templates', { token: tokens.admina, body: { name: 'Std', rows } })).status, 409);
      assert.equal((await call(base, 'POST', '/api/payment-term-templates', { token: tokens.adminb, body: { name: 'Std', rows } })).status, 201);
      const p = await call(base, 'PATCH', `/api/payment-term-templates/${id}`, { token: tokens.admina, body: { name: 'Std 2' } });
      assert.equal(p.json.template.name, 'Std 2');
      assert.equal((await call(base, 'GET', `/api/payment-term-templates/${id}`, { token: tokens.adminb })).status, 404);
      assert.equal((await call(base, 'DELETE', `/api/payment-term-templates/${id}`, { token: tokens.admina })).status, 200);
      assert.equal(await PaymentTermTemplate.countDocuments({ companyId: coA._id }), 0);
      assert.equal(await PaymentTermTemplate.countDocuments({ companyId: coB._id }), 1);
    });

    await t.test('companyRepo profile + amcTemplateRepo: dotted sub-field updates, override upsert/versioning, generation', async () => {
      const p1 = await call(base, 'PATCH', '/api/companies/my-profile', {
        token: tokens.admina,
        body: { displayName: 'Alpha Contract Co Pvt Ltd', quotationPrefix: 'ACC', bankDetails: { bankName: 'Bank One', ifscCode: 'BANK0001' } },
      });
      assert.equal(p1.status, 200, p1.text);
      await call(base, 'PATCH', '/api/companies/my-profile', { token: tokens.admina, body: { bankDetails: { branch: 'Pune' } } });
      const company = await Company.findById(coA._id).lean();
      assert.deepEqual(
        { bankName: company.bankDetails.bankName, ifscCode: company.bankDetails.ifscCode, branch: company.bankDetails.branch },
        { bankName: 'Bank One', ifscCode: 'BANK0001', branch: 'Pune' }
      );
      const other = await Company.findById(coB._id).lean();
      assert.equal(other.quotationPrefix, 'QTN');

      const q = await call(base, 'POST', '/api/quotations', { token: tokens.salesa, body: { division: 'HVAC', customerName: 'Prefix' } });
      assert.match(q.json.quotation.quotationNumber, /^ACC-/);

      const contractId = new mongoose.Types.ObjectId();
      await mongoose.connection.db.collection('contracts').insertOne({
        _id: contractId, companyId: coA._id, customer: 'AMC Cust', amcType: 'Monthly', amount: 1000, category: 'HVAC',
      });
      const body = { type: 'comprehensive', name: 'Alpha Comprehensive', sections: [{ key: 'a', title: 'A', content: 'For {{company_name}}', order: 1 }] };
      assert.equal((await call(base, 'PUT', '/api/amc-documents/templates', { token: tokens.admina, body })).status, 200);
      const again = await call(base, 'PUT', '/api/amc-documents/templates', { token: tokens.admina, body: { ...body, name: 'Alpha Comprehensive v2' } });
      assert.equal(again.status, 200, again.text);
      const tpls = await AmcTemplate.find({ companyId: coA._id }).lean();
      assert.equal(tpls.length, 1);
      assert.equal(tpls[0].version, 2);
      assert.equal(tpls[0].name, 'Alpha Comprehensive v2');
      const gen = await call(base, 'GET', `/api/amc-documents/generate/${contractId}/comprehensive`, { token: tokens.salesa });
      assert.equal(gen.status, 200, gen.text);
      assert.equal(gen.json.document.company.name, 'Alpha Contract Co Pvt Ltd');
      assert.equal(gen.json.document.contract.visitsPerYear, 12);
      assert.equal(gen.json.document.template.sections[0].content, 'For Alpha Contract Co Pvt Ltd');
      const otherTpl = await call(base, 'GET', '/api/amc-documents/templates/comprehensive', { token: tokens.adminb });
      assert.equal(otherTpl.json.template.sections.length, 16);
      assert.equal((await call(base, 'GET', `/api/amc-documents/generate/${contractId}/comprehensive`, { token: tokens.adminb })).status, 404);
    });
  } finally {
    server.close();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
