'use strict';

/**
 * FIX-6-03 (B2 -- Company deletion/cascade).
 *
 * Verifies companyService.deleteCompany against the exact PWA-traced
 * cascade (delCompany, MEP_PROJECTS_PWA/index.html:1811-1817): a hard
 * delete of the Company plus exactly its 8 cascaded collections (users,
 * enquiries, salesOrders, projects, serviceCalls, contracts, payments,
 * notifications), with Inventory and ChecklistTemplate records for that
 * company deliberately left untouched (the PWA's own cascade list omits
 * them), and a second, unrelated company's data of every kind left
 * completely untouched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { deleteCompany } = require('../src/services/companyService');

function auth(overrides) {
  return { userId: 'super1', companyId: null, role: 'super', name: 'Super Admin', ...overrides };
}

function seedTwoCompanies() {
  return createEnquiryFakeStore({
    companies: [
      { id: 'co1', name: 'Disposable Test Co' },
      { id: 'co2', name: 'Control Co (must survive)' },
    ],
    users: [
      { id: 'u1', companyId: 'co1', name: 'Admin One', username: 'admin1', role: 'admin' },
      { id: 'u2', companyId: 'co2', name: 'Admin Two', username: 'admin2', role: 'admin' },
    ],
    enquiries: [
      { id: 'enq1', companyId: 'co1', customer: 'X', status: 'Open' },
      { id: 'enq2', companyId: 'co2', customer: 'Y', status: 'Open' },
    ],
    salesOrders: [
      { id: 'so1', companyId: 'co1', orderNumber: 1 },
      { id: 'so2', companyId: 'co2', orderNumber: 1 },
    ],
    projects: [
      { id: 'proj1', companyId: 'co1', name: 'P1', checklist: [] },
      { id: 'proj2', companyId: 'co2', name: 'P2', checklist: [] },
    ],
    serviceCalls: [
      { id: 'sc1', companyId: 'co1', complaintNumber: 1 },
      { id: 'sc2', companyId: 'co2', complaintNumber: 1 },
    ],
    contracts: [
      { id: 'ct1', companyId: 'co1' },
      { id: 'ct2', companyId: 'co2' },
    ],
    payments: [
      { id: 'pay1', companyId: 'co1', projectOrReference: 'P1', amount: 1000 },
      { id: 'pay2', companyId: 'co2', projectOrReference: 'P2', amount: 1000 },
    ],
    notifications: [
      { id: 'notif1', companyId: 'co1', text: 'x', targetRoles: ['*'] },
      { id: 'notif2', companyId: 'co2', text: 'y', targetRoles: ['*'] },
    ],
    // NOT part of the PWA's cascade list -- must survive for BOTH companies.
    inventoryCategories: [
      { id: 'cat1', companyId: 'co1', name: 'Cat1' },
      { id: 'cat2', companyId: 'co2', name: 'Cat2' },
    ],
    inventoryItems: [
      { id: 'item1', companyId: 'co1', name: 'Item1' },
      { id: 'item2', companyId: 'co2', name: 'Item2' },
    ],
    checklistTemplates: [
      { id: 'tpl1', companyId: 'co1', division: 'HVAC' },
      { id: 'tpl2', companyId: 'co2', division: 'HVAC' },
    ],
  });
}

test('FIX-6-03: deleteCompany requires the super role', async () => {
  const store = seedTwoCompanies();
  await assert.rejects(
    () => deleteCompany('co1', auth({ role: 'admin' }), store),
    (err) => err.code === 'FORBIDDEN' && err.status === 403
  );
  // Nothing was touched.
  assert.equal(store.state.companies.length, 2);
});

test('FIX-6-03: deleteCompany 404s for an unknown company id', async () => {
  const store = seedTwoCompanies();
  await assert.rejects(
    () => deleteCompany('no-such-company', auth(), store),
    (err) => err.code === 'NOT_FOUND' && err.status === 404
  );
});

test('FIX-6-03: deleteCompany hard-deletes the company and the PWA-demonstrated 8-collection cascade, leaving Inventory/ChecklistTemplates and the OTHER company completely untouched', async () => {
  const store = seedTwoCompanies();
  const result = await deleteCompany('co1', auth(), store);
  assert.equal(result.deletedCompanyId, 'co1');

  // The company itself is gone.
  assert.equal(store.state.companies.some((c) => c.id === 'co1'), false);

  // Exactly the PWA's 8 cascaded collections are purged for co1.
  assert.equal(store.state.users.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.enquiries.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.salesOrders.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.projects.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.serviceCalls.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.contracts.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.payments.some((x) => x.companyId === 'co1'), false);
  assert.equal(store.state.notifications.some((x) => x.companyId === 'co1'), false);

  // PWA FACT (preserved, not "fixed"): Inventory and ChecklistTemplate
  // records are NOT part of the PWA's own cascade list and must survive.
  assert.equal(store.state.inventoryCategories.some((x) => x.companyId === 'co1'), true);
  assert.equal(store.state.inventoryItems.some((x) => x.companyId === 'co1'), true);
  assert.equal(store.state.checklistTemplates.some((x) => x.companyId === 'co1'), true);

  // The OTHER company (co2) is completely untouched, in every collection.
  assert.equal(store.state.companies.some((c) => c.id === 'co2'), true);
  assert.equal(store.state.users.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.enquiries.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.salesOrders.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.projects.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.serviceCalls.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.contracts.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.payments.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.notifications.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.inventoryCategories.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.inventoryItems.filter((x) => x.companyId === 'co2').length, 1);
  assert.equal(store.state.checklistTemplates.filter((x) => x.companyId === 'co2').length, 1);
});

test('FIX-6-03: deleteCompany is atomic -- a failure partway through the cascade rolls back the whole operation', async () => {
  const store = seedTwoCompanies();
  const originalDeleteMany = store.paymentRepo.deleteManyByCompany;
  store.paymentRepo.deleteManyByCompany = async () => {
    throw new Error('simulated failure mid-cascade');
  };
  await assert.rejects(() => deleteCompany('co1', auth(), store));
  // Nothing rolled forward: company, users, enquiries etc. for co1 are all still present.
  assert.equal(store.state.companies.some((c) => c.id === 'co1'), true);
  assert.equal(store.state.users.some((x) => x.companyId === 'co1'), true);
  assert.equal(store.state.enquiries.some((x) => x.companyId === 'co1'), true);
  store.paymentRepo.deleteManyByCompany = originalDeleteMany;
});
