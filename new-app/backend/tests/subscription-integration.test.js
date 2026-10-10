'use strict';

/**
 * Subscription Integration Tests
 *
 * Focused tests for the subscription/plan/division-entitlement wiring:
 * planRepo, subscriptionRepo, seedDefaultPlans idempotency, division
 * guard integration, and the $push audit-log append path.
 *
 * All tests use in-memory fake repositories — NO database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEnquiryFakeStore } = require('./enquiryFakes');
const {
  listPlans, getPlan, createPlan, updatePlan, seedDefaultPlans,
  getSubscription, createOrUpdateSubscription, getEffectiveDivisions,
} = require('../src/services/subscriptionService');
const { getEffectiveDivisions: guardGetEffectiveDivisions, createDivisionGuard } = require('../src/middleware/divisionGuard');

// ── Helpers ──

function createTestDeps(seed = {}) {
  const store = createEnquiryFakeStore(seed);
  const companyRepo = {
    findById: (id) => store.companyRepo.findById(id),
    delete: (id) => store.companyRepo.delete(id),
    async create(data) {
      const c = { id: `company_${Date.now()}`, ...data };
      store.state.companies.push(c);
      return { ...c };
    },
    async listAll() {
      return store.state.companies.map((c) => ({ ...c }));
    },
    async updateFields(id, fields) {
      const idx = store.state.companies.findIndex((c) => String(c.id) === String(id));
      if (idx < 0) return null;
      Object.assign(store.state.companies[idx], fields);
      return { ...store.state.companies[idx] };
    },
  };
  return {
    store,
    planRepo: store.planRepo,
    subscriptionRepo: store.subscriptionRepo,
    companyRepo,
    counterRepo: store.counterRepo,
    withTransaction: store.withTransaction,
  };
}

const CID = 'company_test';
const ACTOR = 'user_test';

// ═══════════════════════════════════════════════════════════════════
// PLAN REPO & CRUD
// ═══════════════════════════════════════════════════════════════════

test('planRepo: listAll returns empty when no plans exist', async () => {
  const deps = createTestDeps();
  const plans = await deps.planRepo.listAll();
  assert.equal(plans.length, 0);
});

test('planRepo: create and findByCode round-trip', async () => {
  const deps = createTestDeps();
  const created = await deps.planRepo.create({
    code: 'TEST_PLAN', name: 'Test Plan', availableDivisions: ['HVAC'], status: 'active',
  });
  assert.ok(created.id);
  assert.equal(created.code, 'TEST_PLAN');

  const found = await deps.planRepo.findByCode('TEST_PLAN');
  assert.equal(found.code, 'TEST_PLAN');
  assert.deepEqual(found.availableDivisions, ['HVAC']);
});

test('planRepo: findByCode is case-insensitive', async () => {
  const deps = createTestDeps();
  await deps.planRepo.create({
    code: 'UPPER_PLAN', name: 'Upper', availableDivisions: ['Solar'], status: 'active',
  });
  const found = await deps.planRepo.findByCode('upper_plan');
  assert.equal(found.code, 'UPPER_PLAN');
});

test('planRepo: updateByCode patches fields', async () => {
  const deps = createTestDeps();
  await deps.planRepo.create({
    code: 'PATCH_PLAN', name: 'Before', availableDivisions: ['MEP'], status: 'active',
  });
  const updated = await deps.planRepo.updateByCode('PATCH_PLAN', { name: 'After' });
  assert.equal(updated.name, 'After');
  assert.equal(updated.code, 'PATCH_PLAN');
});

test('planRepo: updateByCode returns null for unknown code', async () => {
  const deps = createTestDeps();
  const result = await deps.planRepo.updateByCode('NONEXISTENT', { name: 'x' });
  assert.equal(result, null);
});

// ═══════════════════════════════════════════════════════════════════
// SEED DEFAULT PLANS
// ═══════════════════════════════════════════════════════════════════

test('seedDefaultPlans: creates all 7 default plans', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  const plans = await seedDefaultPlans(deps);
  assert.equal(plans.length, 7);
  const codes = plans.map((p) => p.code).sort();
  assert.deepEqual(codes, [
    'FULL_ENTERPRISE', 'HVAC_STARTER', 'MEP_HVAC_PRO', 'MEP_SOLAR_PRO',
    'MEP_STARTER', 'SOLAR_HVAC_PRO', 'SOLAR_STARTER',
  ]);
});

test('seedDefaultPlans: idempotent — calling twice returns all 7 without duplicates', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  const plans = await seedDefaultPlans(deps);
  assert.equal(plans.length, 7);
});

test('seedDefaultPlans: fills missing plans even if some exist', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  // Pre-seed only 2 plans
  await deps.planRepo.create({ code: 'HVAC_STARTER', name: 'HVAC Starter', availableDivisions: ['HVAC'], status: 'active', version: 1, pricing: {} });
  await deps.planRepo.create({ code: 'MEP_STARTER', name: 'MEP Starter', availableDivisions: ['MEP'], status: 'active', version: 1, pricing: {} });
  const before = await deps.planRepo.listAll();
  assert.equal(before.length, 2);

  const plans = await seedDefaultPlans(deps);
  assert.equal(plans.length, 7);
});

test('seedDefaultPlans: does not overwrite customized pricing', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  // Pre-seed with custom pricing
  await deps.planRepo.create({
    code: 'HVAC_STARTER', name: 'HVAC Starter Custom', availableDivisions: ['HVAC'],
    status: 'active', version: 1, pricing: { monthly: 999 },
  });

  const plans = await seedDefaultPlans(deps);
  const hvac = plans.find((p) => p.code === 'HVAC_STARTER');
  assert.equal(hvac.name, 'HVAC Starter Custom'); // kept original name
  assert.deepEqual(hvac.pricing, { monthly: 999 }); // kept custom pricing
});

// ═══════════════════════════════════════════════════════════════════
// SUBSCRIPTION REPO & SERVICE
// ═══════════════════════════════════════════════════════════════════

test('subscriptionRepo: create and findByCompany round-trip', async () => {
  const deps = createTestDeps();
  const created = await deps.subscriptionRepo.create({
    companyId: CID, planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  });
  assert.ok(created.id);
  const found = await deps.subscriptionRepo.findByCompany(CID);
  assert.equal(found.planCode, 'HVAC_STARTER');
});

test('subscriptionRepo: findByCompany returns null if none', async () => {
  const deps = createTestDeps();
  const found = await deps.subscriptionRepo.findByCompany('no_such_company');
  assert.equal(found, null);
});

test('subscriptionRepo: update with $push appends to auditLog', async () => {
  const deps = createTestDeps();
  const created = await deps.subscriptionRepo.create({
    companyId: CID, planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'],
    status: 'active', auditLog: [{ action: 'created', performedBy: ACTOR }],
  });
  const updated = await deps.subscriptionRepo.update(created.id, {
    planCode: 'MEP_STARTER',
    $push: { auditLog: { action: 'updated', performedBy: ACTOR } },
  });
  assert.equal(updated.planCode, 'MEP_STARTER');
  assert.equal(updated.auditLog.length, 2);
  assert.equal(updated.auditLog[0].action, 'created');
  assert.equal(updated.auditLog[1].action, 'updated');
});

test('createOrUpdateSubscription: creates a subscription', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  const sub = await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);
  assert.equal(sub.planCode, 'HVAC_STARTER');
  assert.deepEqual(sub.purchasedDivisions, ['HVAC']);
});

test('createOrUpdateSubscription: updates existing subscription with audit log', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);
  // Update to a different plan
  const updated = await createOrUpdateSubscription(CID, {
    planCode: 'MEP_HVAC_PRO', purchasedDivisions: ['MEP', 'HVAC'], status: 'active',
  }, ACTOR, deps);
  assert.equal(updated.planCode, 'MEP_HVAC_PRO');
  assert.deepEqual(updated.purchasedDivisions.sort(), ['HVAC', 'MEP']);
  // Should have audit log entries
  assert.ok(updated.auditLog.length >= 2, 'audit log should have at least 2 entries');
});

test('createOrUpdateSubscription: rejects division not in plan', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  await assert.rejects(
    () => createOrUpdateSubscription(CID, {
      planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC', 'Solar'], status: 'active',
    }, ACTOR, deps),
    /not available in plan/i
  );
});

test('createOrUpdateSubscription: syncs Company.divisions with purchased', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'MEP_HVAC_PRO', purchasedDivisions: ['MEP', 'HVAC'], status: 'active',
  }, ACTOR, deps);
  const company = await deps.companyRepo.findById(CID);
  assert.deepEqual(company.divisions.sort(), ['HVAC', 'MEP']);
});

// ═══════════════════════════════════════════════════════════════════
// EFFECTIVE DIVISIONS & ENTITLEMENT
// ═══════════════════════════════════════════════════════════════════

test('getEffectiveDivisions: returns subscription divisions when active', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['MEP'] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'SOLAR_HVAC_PRO', purchasedDivisions: ['HVAC', 'Solar'], status: 'active',
  }, ACTOR, deps);
  const divs = await getEffectiveDivisions(CID, deps);
  assert.deepEqual(divs.sort(), ['HVAC', 'Solar']);
});

test('getEffectiveDivisions: falls back to company.divisions when no subscription', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'MEP'] }] });
  const divs = await getEffectiveDivisions(CID, deps);
  assert.deepEqual(divs.sort(), ['HVAC', 'MEP']);
});

test('getEffectiveDivisions: falls back when subscription is cancelled', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['MEP'] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'FULL_ENTERPRISE', purchasedDivisions: ['HVAC', 'Solar', 'MEP'], status: 'cancelled',
  }, ACTOR, deps);
  const divs = await getEffectiveDivisions(CID, deps);
  // Cancelled subscription → falls back to company.divisions
  // But createOrUpdateSubscription synced company.divisions to ['HVAC', 'Solar', 'MEP']
  assert.deepEqual(divs.sort(), ['HVAC', 'MEP', 'Solar']);
});

test('getEffectiveDivisions: falls back when subscription is expired', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['Solar'] }] });
  await deps.subscriptionRepo.create({
    companyId: CID, planCode: 'SOLAR_STARTER', purchasedDivisions: ['Solar'], status: 'expired',
  });
  const divs = await getEffectiveDivisions(CID, deps);
  // Expired → fallback to company.divisions
  assert.deepEqual(divs, ['Solar']);
});

// ═══════════════════════════════════════════════════════════════════
// DIVISION GUARD MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

test('divisionGuard: allows request when division is entitled', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC', 'Solar'] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'SOLAR_HVAC_PRO', purchasedDivisions: ['HVAC', 'Solar'], status: 'active',
  }, ACTOR, deps);
  const guard = createDivisionGuard(deps);
  const req = { auth: { role: 'admin', companyId: CID }, body: { division: 'HVAC' } };
  let nextCalled = false;
  const res = { status: () => ({ json: () => {} }) };
  await guard(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
});

test('divisionGuard: blocks request for unentitled division', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: ['HVAC'] }] });
  await seedDefaultPlans(deps);
  await createOrUpdateSubscription(CID, {
    planCode: 'HVAC_STARTER', purchasedDivisions: ['HVAC'], status: 'active',
  }, ACTOR, deps);
  const guard = createDivisionGuard(deps);
  const req = { auth: { role: 'admin', companyId: CID }, body: { division: 'Solar' } };
  let statusCode = null;
  let respBody = null;
  const res = { status: (s) => { statusCode = s; return { json: (b) => { respBody = b; } }; } };
  await guard(req, res, () => {});
  assert.equal(statusCode, 403);
  assert.equal(respBody.code, 'DIVISION_NOT_ENTITLED');
});

test('divisionGuard: super role bypasses division check', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  const guard = createDivisionGuard(deps);
  const req = { auth: { role: 'super', companyId: null }, body: { division: 'Solar' } };
  let nextCalled = false;
  const res = {};
  await guard(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
});

test('divisionGuard: passes through when no division specified', async () => {
  const deps = createTestDeps({ companies: [{ id: CID, name: 'Test Co', divisions: [] }] });
  const guard = createDivisionGuard(deps);
  const req = { auth: { role: 'admin', companyId: CID }, body: {} };
  let nextCalled = false;
  const res = {};
  await guard(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
});

// ═══════════════════════════════════════════════════════════════════
// PLAN SERVICE VALIDATION
// ═══════════════════════════════════════════════════════════════════

test('createPlan: rejects missing required fields', async () => {
  const deps = createTestDeps();
  await assert.rejects(() => createPlan({}, deps), /code.*name.*division/i);
});

test('createPlan: rejects invalid division', async () => {
  const deps = createTestDeps();
  await assert.rejects(
    () => createPlan({ code: 'BAD', name: 'Bad', availableDivisions: ['InvalidDiv'] }, deps),
    /Invalid division/
  );
});

test('updatePlan: rejects invalid division in patch', async () => {
  const deps = createTestDeps();
  await seedDefaultPlans(deps);
  await assert.rejects(
    () => updatePlan('HVAC_STARTER', { availableDivisions: ['FakeDiv'] }, deps),
    /Invalid division/
  );
});

test('updatePlan: throws for unknown code', async () => {
  const deps = createTestDeps();
  await assert.rejects(() => updatePlan('NONEXISTENT', { name: 'x' }, deps), /not found/i);
});

test('getPlan: throws for unknown code', async () => {
  const deps = createTestDeps();
  await assert.rejects(() => getPlan('NONEXISTENT', deps), /not found/i);
});

test('listPlans: returns all seeded plans', async () => {
  const deps = createTestDeps();
  await seedDefaultPlans(deps);
  const plans = await listPlans(deps);
  assert.equal(plans.length, 7);
});
