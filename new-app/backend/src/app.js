'use strict';

const express = require('express');
const { getConfig } = require('./config/env');
const { userRepo, sessionRepo, companyRepo, userWriteRepo } = require('./auth/repositories.mongoose');
const { hashPassword, verifyPassword } = require('./auth/passwordHasher');
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
const { createSubscriptionRouter } = require('./routes/subscriptionRoutes');
const { startDelayCheckScheduler } = require('./jobs/delayCheckScheduler');
const {
  enquiryRepo,
  salesOrderRepo,
  projectRepo,
  paymentRepo,
  contractRepo,
  serviceCallRepo,
  notificationRepo,
  checklistTemplateRepo,
  userRepoForEnquiry,
  counterRepo,
  withTransaction,
  inventoryCategoryRepo,
  inventoryLocationRepo,
  inventoryItemRepo,
  inventoryIssueRepo,
  inventoryTransactionRepo,
  planRepo,
  subscriptionRepo,
} = require('./repositories/businessRepositories.mongoose');

/**
 * Express app assembly.
 *
 * Foundation: authentication/tenant/role routes.
 * Business modules mounted so far: Enquiry (create/edit/follow-up/mark
 * Lost/reopen/convert-to-SalesOrder/search/reporting), SalesOrder
 * (standalone create/edit/read/list/report — shares its creation cascade
 * with the Enquiry conversion path via src/services/salesOrderCascade.js),
 * and Payment/Finance (the full ledger: part-payments, milestone edits,
 * raise-to-finance, follow-ups, reports), and Project Execution (stage/
 * status transitions incl. the completion gate, engineer assignment,
 * timeline, checklist execution/approval, execution updates, delivery
 * challans, reports -- created only via the SalesOrder cascade, no
 * standalone create route), Contract (AMC / Warranty creation --
 * manual and Project-conversion -- plus list/search/dashboard/report; no
 * edit/delete, per CONTRACT_DECISION_LOCK.md Decisions 2-3), ServiceCall
 * (Complaint/PM registration, assignment, report draft/completion,
 * Chargeable Payment creation, Contract PM-slot update, search/report --
 * see SERVICECALL_DECISION_LOCK.md; no edit/delete/cancel/reopen, per that
 * document's §21/§23), and Inventory (Category/Location/Item CRUD, Issue,
 * Return request/accept/reject, Mark Used, Transfer, Adjustments,
 * dashboard/reports -- see PWA_COVERAGE_AUDIT_INVENTORY.md /
 * INVENTORY_DECISION_LOCK.md; no edit/delete for InventoryTransaction,
 * append-only).
 *
 * This module wires the REAL Mongoose-backed repositories — it is not
 * exercised by the test suite (which injects in-memory fakes instead, so no
 * live database is used in tests). It exists so the foundation is actually
 * runnable once a MongoDB connection is configured and src/server.js is started.
 */
function createApp(overrideConfig) {
  const config = overrideConfig || getConfig();
  const authDeps = {
    userRepo,
    sessionRepo,
    companyRepo,
    userWriteRepo,
    passwordHasher: { hashPassword, verifyPassword },
    config,
  };
  const businessDeps = {
    ...authDeps,
    enquiryRepo,
    salesOrderRepo,
    projectRepo,
    paymentRepo,
    contractRepo,
    serviceCallRepo,
    notificationRepo,
    checklistTemplateRepo,
    userRepoForEnquiry,
    counterRepo,
    withTransaction,
    inventoryCategoryRepo,
    inventoryLocationRepo,
    inventoryItemRepo,
    inventoryIssueRepo,
    inventoryTransactionRepo,
    planRepo,
    subscriptionRepo,
  };

  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.status(200).json({ ok: true }));
  app.use('/api/auth', createAuthRouter(authDeps));
  app.use('/api/companies', createCompanyRouter(businessDeps)); // FIX-6-03: deleteCompany's cascade needs the business repos + withTransaction, not just authDeps
  app.use('/api/users', createUserRouter(authDeps));
  app.use('/api/enquiries', createEnquiryRouter(businessDeps));
  app.use('/api/sales-orders', createSalesOrderRouter(businessDeps));
  app.use('/api/payments', createPaymentRouter(businessDeps));
  app.use('/api/projects', createProjectRouter(businessDeps));
  app.use('/api/contracts', createContractRouter(businessDeps));
  app.use('/api/service-calls', createServiceCallRouter(businessDeps));
  app.use('/api/inventory', createInventoryRouter(businessDeps));
  app.use('/api/checklist-templates', createChecklistTemplateRouter(businessDeps));
  app.use('/api/notifications', createNotificationRouter(businessDeps));
  app.use('/api/subscriptions', createSubscriptionRouter(businessDeps));

  app.startDelayCheckScheduler = (options) => startDelayCheckScheduler(businessDeps, options);

  return app;
}

module.exports = { createApp };
