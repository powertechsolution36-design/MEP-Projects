'use strict';

/**
 * Stage 7 Pass 1 — Dev backend wrapper.
 *
 * Starts a REAL HTTP server exposing the exact same route/controller/service
 * layer as src/app.js (the verified, regression-tested 123-endpoint API),
 * but wires it to the IN-MEMORY FAKE REPOSITORIES that the backend's own
 * test suite already uses (tests/enquiryFakes.js + the auth fakes pattern
 * in tests/auth/fakes.js), instead of the real Mongoose models.
 *
 * This is NOT a shortcut around backend verification: every route/service
 * file required below is the exact same file exercised by the 373/373
 * passing regression suite (new-app/docs/API_CONTRACT.md). Only the
 * repository/persistence layer is swapped, exactly the way the tests
 * already swap it. No business logic here — this file only assembles
 * dependencies and starts express.listen().
 *
 * No live MongoDB is used or required. Not for production use.
 *
 * Usage:
 *   node src/devServer.js
 *   (or) npm run dev:server
 *
 * Env:
 *   DEV_PORT (default 4000)
 *
 * On startup, seeds one demo company ("MEP Powertech (Dev)") and one user
 * per PWA role (see SEED_USERS below), plus a cross-tenant `super` account,
 * so the frontend can log in immediately without any manual setup. All
 * seed passwords are `password123` (the `super` account: `password123`
 * also, company-less login). This mirrors the PWA's own quick-login role
 * list (index.html `quickUsers`), but is entirely local, ephemeral,
 * in-memory state — it is rebuilt from scratch every time this process
 * starts, and none of it touches the real Mongoose-backed database or the
 * PWA's own data at all.
 */

const express = require('express');
const path = require('path');

const { createAuthRouter } = require('./routes/authRoutes');
const { createCompanyRouter } = require('./routes/companyRoutes');
const { createUserRouter } = require('./routes/userRoutes');
const { createEnquiryRouter } = require('./routes/enquiryRoutes');
const { createSalesOrderRouter } = require('./routes/salesOrderRoutes');
const { createPaymentRouter } = require('./routes/paymentRoutes');
const { createProjectRouter } = require('./routes/projectRoutes');
const { createContractRouter } = require('./routes/contractRoutes');
const { createServiceCallRouter } = require('./routes/serviceCallRoutes');
const { createInventoryRouter } = require('./routes/inventoryRoutes');
const { createChecklistTemplateRouter } = require('./routes/checklistTemplateRoutes');
const { createNotificationRouter } = require('./routes/notificationRoutes');
const { startDelayCheckScheduler } = require('./jobs/delayCheckScheduler');
const { hashPassword, verifyPassword } = require('./auth/passwordHasher');

// Reuse the SAME in-memory fake store the business-logic test suite uses —
// tests/enquiryFakes.js is deliberately required from here (not copied) so
// this dev server can never drift from what the tests actually verify.
const { createEnquiryFakeStore } = require(path.join(__dirname, '..', 'tests', 'enquiryFakes'));

function nextId(prefix, counterRef, key) {
  counterRef[key] += 1;
  return `${prefix}_${counterRef[key]}`;
}

/**
 * Builds the full fake-repository dependency set for one isolated in-memory
 * "database". Combines:
 *  - businessRepositories-shaped repos from tests/enquiryFakes.js
 *    (enquiry/salesOrder/project/payment/contract/serviceCall/notification/
 *    checklistTemplate/inventory* + withTransaction + counterRepo)
 *  - an auth-shaped userRepo/sessionRepo (findForLogin/findById,
 *    createSession/findActiveSession/revokeSession) built on top of the
 *    SAME state.users array userWriteRepo/userRepoForEnquiry use, so a user
 *    created through the real user-management API can log in immediately.
 *  - a companyRepo.create() adapter (enquiryFakes' companyRepo only ships
 *    findById/delete, since business tests never create companies) so
 *    POST /api/companies works end-to-end too.
 */
function createDevRepositories() {
  const store = createEnquiryFakeStore();
  const idCounters = { company: 0 };
  const sessions = new Map();
  let sessionCounter = 0;

  const userRepo = {
    async findForLogin({ companyId, username }) {
      const match = companyId
        ? store.state.users.find((u) => String(u.companyId) === String(companyId) && u.username === username)
        : store.state.users.find((u) => u.role === 'super' && u.username === username);
      return match ? { ...match } : null;
    },
    async findById(id) {
      const match = store.state.users.find((u) => String(u.id) === String(id));
      return match ? { ...match } : null;
    },
  };

  const sessionRepo = {
    async createSession({ userId, companyId, role, issuedAt, expiresAt }) {
      sessionCounter += 1;
      const id = `session_${sessionCounter}`;
      sessions.set(id, { id, userId, companyId, role, issuedAt, expiresAt, revokedAt: null });
      return { id };
    },
    async findActiveSession(id) {
      const session = sessions.get(id);
      if (!session) return null;
      if (session.revokedAt) return null;
      if (session.expiresAt.getTime() <= Date.now()) return null;
      return { id: session.id };
    },
    async revokeSession(id) {
      const session = sessions.get(id);
      if (session) session.revokedAt = new Date();
    },
  };

  // companyRepo adapter: adds create() on top of the enquiryFakes
  // findById/delete, backed by the same store.state.companies array.
  const companyRepo = {
    async findById(id) {
      return store.companyRepo.findById(id);
    },
    async delete(id) {
      return store.companyRepo.delete(id);
    },
    async create(companyData) {
      const doc = { id: nextId('company', idCounters, 'company'), ...companyData };
      store.state.companies.push(doc);
      return { ...doc };
    },
    async listAll() {
      return store.state.companies.map(c => ({ ...c }));
    },
    async updateFields(id, fields) {
      const idx = store.state.companies.findIndex(c => String(c.id) === String(id));
      if (idx < 0) return null;
      Object.assign(store.state.companies[idx], fields);
      return { ...store.state.companies[idx] };
    },
  };

  return {
    store,
    userRepo,
    sessionRepo,
    companyRepo,
    passwordHasher: { hashPassword, verifyPassword },
    userWriteRepo: store.userWriteRepo,
    userRepoForEnquiry: store.userRepoForEnquiry,
    enquiryRepo: store.enquiryRepo,
    salesOrderRepo: store.salesOrderRepo,
    projectRepo: store.projectRepo,
    paymentRepo: store.paymentRepo,
    contractRepo: store.contractRepo,
    serviceCallRepo: store.serviceCallRepo,
    notificationRepo: store.notificationRepo,
    checklistTemplateRepo: store.checklistTemplateRepo,
    counterRepo: store.counterRepo,
    withTransaction: store.withTransaction,
    inventoryCategoryRepo: store.inventoryCategoryRepo,
    inventoryLocationRepo: store.inventoryLocationRepo,
    inventoryItemRepo: store.inventoryItemRepo,
    inventoryIssueRepo: store.inventoryIssueRepo,
    inventoryTransactionRepo: store.inventoryTransactionRepo,
  };
}

/**
 * Assembles the express app against the given fake-repository deps, wiring
 * the exact same route factories src/app.js uses. Kept separate from
 * src/app.js on purpose — app.js hard-requires the real Mongoose-backed
 * repositories (src/auth/repositories.mongoose.js /
 * src/repositories/businessRepositories.mongoose.js), which this dev server
 * must never import (no live MongoDB in this environment).
 */
function createDevApp(deps, config) {
  const fullDeps = { ...deps, config };
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.status(200).json({ ok: true, mode: 'dev-fake-repositories' }));
  app.use('/api/auth', createAuthRouter(fullDeps));
  app.use('/api/companies', createCompanyRouter(fullDeps));
  app.use('/api/users', createUserRouter(fullDeps));
  app.use('/api/enquiries', createEnquiryRouter(fullDeps));
  app.use('/api/sales-orders', createSalesOrderRouter(fullDeps));
  app.use('/api/payments', createPaymentRouter(fullDeps));
  app.use('/api/projects', createProjectRouter(fullDeps));
  app.use('/api/contracts', createContractRouter(fullDeps));
  app.use('/api/service-calls', createServiceCallRouter(fullDeps));
  app.use('/api/inventory', createInventoryRouter(fullDeps));
  app.use('/api/checklist-templates', createChecklistTemplateRouter(fullDeps));
  app.use('/api/notifications', createNotificationRouter(fullDeps));

  app.startDelayCheckScheduler = (options) => startDelayCheckScheduler(fullDeps, options);

  return app;
}

const DEMO_COMPANY_ID = 'company_demo';
const DEMO_PASSWORD = 'password123';

// One seed user per PWA role, modeled on the PWA's own `quickUsers` demo
// list (index.html) so the frontend can log in as any role immediately.
const SEED_USERS = [
  { username: 'admin', name: 'Admin (Suhas)', role: 'admin' },
  { username: 'sales', name: 'Sales (Suhas)', role: 'sales' },
  { username: 'amol', name: 'HVAC PM (Amol)', role: 'hvac_pm' },
  { username: 'akshay', name: 'Solar PM (Akshay)', role: 'solar_pm' },
  { username: 'ajinkya', name: 'MEP PM (Ajinkya)', role: 'mep_pm' },
  { username: 'vinod', name: 'Engineer (Vinod)', role: 'engineer' },
  { username: 'store', name: 'Inventory (Ganesh)', role: 'inventory' },
  { username: 'service', name: 'Service Mgr (Rahul)', role: 'service_mgr' },
  { username: 'israr', name: 'Service Eng (Israr)', role: 'service_eng' },
  { username: 'finance', name: 'Finance (Vaibhavi)', role: 'finance' },
];

async function seedDevData(deps) {
  const { store } = deps;
  store.state.companies.push({ id: DEMO_COMPANY_ID, name: 'MEP Powertech (Dev)', active: true });

  let userN = 0;
  for (const u of SEED_USERS) {
    userN += 1;
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    store.state.users.push({
      id: `seed_user_${userN}`,
      companyId: DEMO_COMPANY_ID,
      username: u.username,
      name: u.name,
      role: u.role,
      passwordHash,
      active: true,
    });
  }

  // Cross-tenant super-admin account (no companyId), mirroring the PWA's
  // "Sam" super-admin quick-login.
  const superHash = await hashPassword(DEMO_PASSWORD);
  store.state.users.push({
    id: 'seed_user_super',
    companyId: null,
    username: 'Sam',
    name: 'Super Admin (Sam)',
    role: 'super',
    passwordHash: superHash,
    active: true,
  });
}

async function start() {
  const port = Number(process.env.DEV_PORT) || 4000;
  const config = {
    authTokenSecret: process.env.AUTH_TOKEN_SECRET || 'dev-only-insecure-secret-do-not-use-in-production',
    authTokenExpiry: process.env.AUTH_TOKEN_EXPIRY || '12h',
    port,
  };

  const deps = createDevRepositories();
  await seedDevData(deps);

  const app = createDevApp(deps, config);
  // Not started by default in this dev server to avoid unexpected
  // background writes to the in-memory store while exploring the API by
  // hand; uncomment to exercise the delay-check job in this environment:
  // app.startDelayCheckScheduler();

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dev-server] MEP new-app backend (fake in-memory repositories) listening on port ${port}`);
    // eslint-disable-next-line no-console
    console.log(`[dev-server] Demo company: "MEP Powertech (Dev)" (id: ${DEMO_COMPANY_ID})`);
    // eslint-disable-next-line no-console
    console.log('[dev-server] Seed logins (companyId not required for "Sam"):');
    for (const u of SEED_USERS) {
      // eslint-disable-next-line no-console
      console.log(`  role=${u.role.padEnd(11)} username=${u.username.padEnd(8)} password=${DEMO_PASSWORD} companyId=${DEMO_COMPANY_ID}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  role=super       username=Sam      password=${DEMO_PASSWORD} companyId=(none)`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[dev-server] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { createDevApp, createDevRepositories, seedDevData, start, DEMO_COMPANY_ID, DEMO_PASSWORD, SEED_USERS };
