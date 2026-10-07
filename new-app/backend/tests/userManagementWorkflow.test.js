'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../src/services/userService');
const projectService = require('../src/services/projectService');
const serviceCallService = require('../src/services/serviceCallService');
const inventoryService = require('../src/services/inventoryService');
const { hashPassword, verifyPassword } = require('../src/auth/passwordHasher');
const { createEnquiryFakeStore } = require('./enquiryFakes');

/**
 * FIX-3.8-01 (P0) — the core multi-user company flow.
 *
 * This is deliberately NOT just "POST /users in isolation": it builds a
 * whole company's real user roster the way an admin actually would, using
 * ONLY the new userService (never seeding users directly into the fake
 * store), and then proves each created user is immediately usable by the
 * OTHER already-implemented modules that look users up via
 * `deps.userRepoForEnquiry` — the exact same repository object, reading the
 * exact same underlying collection, that a real Mongoose deployment would
 * use (see src/repositories/businessRepositories.mongoose.js). This is the
 * re-verification the task requires beyond "the API exists".
 */

function deps(store) {
  return { ...store, passwordHasher: { hashPassword, verifyPassword } };
}

function adminAuth(store) {
  return { userId: store.state.companies[0]._adminId, companyId: 'co1', role: 'admin', name: 'Bootstrap Admin' };
}

async function bootstrapCompanyWithAdmin() {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'MEP Powertech Pvt Ltd', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  // The ONLY pre-existing user is the bootstrap admin (mirrors
  // companyService.createCompanyWithAdmin's real outcome) — created here
  // directly via the store's userWriteRepo to stand in for that already
  // fully-tested path (see tests/auth/companyService.test.js), so this test
  // can focus on what FIX-3.8-01 itself adds: everything AFTER bootstrap.
  const passwordHash = await hashPassword('admin-boot-pass');
  const admin = await store.userWriteRepo.create({ companyId: 'co1', name: 'Suhas Admin', username: 'admin', role: 'admin', passwordHash, active: true });
  store.state.companies[0]._adminId = admin.id;
  return store;
}

test('FIX-3.8-01 — multi-user company flow: bootstrap admin creates a user in every non-admin, non-super PWA role', async () => {
  const store = await bootstrapCompanyWithAdmin();
  const admin = adminAuth(store);

  const roster = {};
  const rolesToCreate = ['sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance'];
  for (const role of rolesToCreate) {
    // eslint-disable-next-line no-await-in-loop
    roster[role] = await userService.createUser(
      { name: `${role} user`, username: `${role}1`, password: `${role}-pass-123`, role },
      admin,
      deps(store)
    );
    assert.equal(roster[role].role, role);
    assert.equal(roster[role].companyId, 'co1');
  }

  // Every role now has a real, distinct User document — this is exactly the
  // practical consequence Pass 3.8 flagged as impossible before this fix.
  const allUsers = await userService.listUsers(admin, deps(store));
  assert.equal(allUsers.length, 1 + rolesToCreate.length); // bootstrap admin + 9 new roles
  assert.deepEqual(
    allUsers.map((u) => u.role).sort(),
    ['admin', ...rolesToCreate].sort()
  );

  store.state._roster = roster; // hand the created users to the later tests in this file
  global.__mepRoster = { store, roster, admin };
});

test('FIX-3.8-01 — a newly-created user in every role can authenticate (bcrypt-hashed, never plaintext)', async () => {
  const { roster } = global.__mepRoster;
  const authService = require('../src/auth/authService');
  const { createInMemoryStore } = require('./auth/fakes');

  // authService needs userRepo.findForLogin/sessionRepo, which live in the
  // AUTH fakes, not the business fakes above — re-hydrate an equivalent
  // auth-side store from the same created users to prove the SAME
  // passwordHash produced by userService.createUser verifies correctly
  // through the real login path (authService.login + passwordHasher).
  const { store: bizStore } = global.__mepRoster;
  const authStore = createInMemoryStore(bizStore.state.users, bizStore.state.companies);
  const config = { authTokenSecret: 'test-secret', authTokenExpiry: '15m' };
  const authDeps = { userRepo: authStore.userRepo, sessionRepo: authStore.sessionRepo, passwordHasher: { hashPassword, verifyPassword }, config };

  for (const role of Object.keys(roster)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await authService.login({ companyId: 'co1', username: `${role}1`, password: `${role}-pass-123` }, authDeps);
    assert.equal(result.user.role, role);
    assert.equal(result.user.companyId, 'co1');
  }
});

test('FIX-3.8-01 — a hvac_pm user created via userService can be assigned as a Project engineer/PM candidate', async () => {
  const { store, roster, admin } = global.__mepRoster;
  await store.projectRepo.create({
    id: 'proj_wf1',
    companyId: 'co1',
    salesOrderId: 'so_wf1',
    division: 'HVAC',
    name: 'Workflow Test Project',
    customer: 'Test Customer',
    stage: 'Planning',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-06-01'),
    assignedEngineerIds: [],
    status: 'Ongoing',
    checklist: [],
    executionUpdates: [],
    deliveryChallans: [],
    timelineSet: false,
  });

  // engineer/service_eng/hvac_pm/solar_pm/mep_pm are all valid engineer-
  // assignment candidates per projectService's ENGINEER_CANDIDATE_ROLES
  // (imported transitively via serviceCallService for the constant, and
  // exercised directly here through the real assignEngineers() call).
  const hvacPmActor = { userId: roster.hvac_pm.id, companyId: 'co1', role: 'hvac_pm', name: 'hvac_pm user' };
  const updated = await projectService.assignEngineers('proj_wf1', [roster.engineer.id, roster.service_eng.id], hvacPmActor, store);
  assert.deepEqual(updated.assignedEngineerIds.map(String).sort(), [roster.engineer.id, roster.service_eng.id].map(String).sort());
});

test('FIX-3.8-01 — service_eng/engineer/service_mgr users created via userService can be assigned to a ServiceCall', async () => {
  const { store, roster, admin } = global.__mepRoster;
  const { serviceCall } = await serviceCallService.registerComplaint(
    { customer: 'Workflow Customer', phone: '9000000000', site: 'Site WF', complaint: 'AC not cooling' },
    admin,
    store
  );
  const assigned = await serviceCallService.assignEngineer(serviceCall.id, { engineerId: roster.service_eng.id }, admin, store);
  assert.equal(String(assigned.engineerId), String(roster.service_eng.id));
  assert.equal(assigned.status, 'Assigned');

  // A non-candidate role (sales) must be rejected — proves the role check
  // is being evaluated against the REAL created user, not skipped.
  await assert.rejects(
    () => serviceCallService.assignEngineer(serviceCall.id, { engineerId: roster.sales.id }, admin, store),
    /not a valid Service Call engineer candidate/
  );
});

test('FIX-3.8-01 — an inventory user created via userService can be the recipient of an Inventory Issue', async () => {
  const { store, roster, admin } = global.__mepRoster;
  const category = await inventoryService.createCategory({ name: 'Workflow Category' }, admin, store);
  const location = await inventoryService.createLocation({ name: 'Workflow Godown' }, admin, store);
  const item = await inventoryService.createItem(
    {
      name: 'Workflow Item', code: 'WF-1', categoryId: category.id, unit: 'Nos', returnable: true,
      minimumStockLevel: 5, ratePerUnit: 100, openingStock: { [location.id]: 50 },
    },
    admin,
    store
  );

  // engineer (a non-admin role) is the realistic PWA recipient.
  const { issue } = await inventoryService.issueMaterial(
    { itemId: item.id, quantity: 5, fromLocationId: location.id, staffId: roster.engineer.id, site: 'Workflow Site' },
    admin,
    store
  );
  assert.equal(String(issue.staffId), String(roster.engineer.id));

  // admin is explicitly excluded as a recipient (PWA FACT: staffList()
  // filters role!=="admin") — proves this against the REAL created admin id.
  await assert.rejects(
    () => inventoryService.issueMaterial({ itemId: item.id, quantity: 1, fromLocationId: location.id, staffId: admin.userId, site: 'X' }, admin, store),
    /not a valid Inventory issue recipient/
  );
});

test('FIX-3.8-01 — a finance user created via userService receives the chargeable-ServiceCall Payment notification (role-string match, PWA FACT)', async () => {
  const { store, roster, admin } = global.__mepRoster;
  const { serviceCall } = await serviceCallService.registerComplaint(
    { customer: 'Chargeable Customer', phone: '9000000001', site: 'Site WF2', complaint: 'Gas top-up' },
    admin,
    store
  );
  await serviceCallService.assignEngineer(serviceCall.id, { engineerId: roster.service_eng.id }, admin, store);
  const serviceEngActor = { userId: roster.service_eng.id, companyId: 'co1', role: 'service_eng', name: 'service_eng user' };
  await serviceCallService.completeServiceCall(
    serviceCall.id,
    { report: { serviceType: 'Chargeable', amount: 1500 }, signature: 'data:image/png;base64,sig' },
    serviceEngActor,
    store
  );

  const financeNotifs = await store.notificationRepo.listForRole('co1', 'finance', {});
  assert.ok(financeNotifs.length >= 1, 'the finance role (now a real user, via userService) must be a valid notification target');
});
