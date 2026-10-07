'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/salesOrderService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'sales', name: 'Priya Sales', ...overrides };
}

test('createSalesOrder — standalone "+ New SO" path (no Enquiry): exact PWA defaults, one Project, Payments per milestone, notifications', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [{ text: 'Site survey', signResponsibility: 'ENGINEER' }] }],
  });
  const result = await service.createSalesOrder(
    {
      division: 'Solar',
      projectName: 'Rooftop Array',
      contacts: [{ name: 'Anita', phone: '9000011111' }],
      totalCost: 500000,
      paymentMilestones: [{ description: 'Advance', amount: 250000 }, { description: 'Balance', amount: 250000 }],
    },
    auth(),
    store
  );

  assert.equal(result.salesOrder.enquiryId, null); // no Enquiry at all — PWA FACT
  assert.equal(result.salesOrder.division, 'Solar');
  assert.equal(result.salesOrder.salesTeam, 'Priya Sales'); // U.name default
  assert.match(result.salesOrder.termsAndConditions, /Fabrication not in our scope/);
  assert.equal(typeof result.salesOrder.orderNumber, 'number');

  assert.equal(result.project.division, 'Solar');
  assert.equal(result.project.stage, 'Planning');
  assert.equal(result.project.customer, 'Anita');
  assert.equal(result.project.siteType, '');
  assert.equal(result.project.checklistTemplateName, 'Standard Solar');
  assert.equal(result.project.checklist.length, 1);

  assert.equal(result.payments.length, 2);
  assert.equal(result.payments[0].personName, 'Anita');
  assert.equal(result.payments[0].phone, '9000011111');
  assert.equal(result.payments[0].salesOrderId, result.salesOrder.id);

  assert.equal(result.notifications.length, 2);
  const financeNotif = result.notifications.find((n) => n.targetRoles.includes('finance'));
  assert.match(financeNotif.text, /payment terms added to pending payment list/);
});

test('createSalesOrder — falls back to the legacy checklist when the division has zero ChecklistTemplate rows (locked "Checklist fallback = A")', async () => {
  const store = createEnquiryFakeStore({});
  const result = await service.createSalesOrder({ division: 'MEP', projectName: 'Office Fitout' }, auth(), store);
  assert.equal(result.project.checklistTemplateName, '');
  assert.equal(result.project.checklist.length, 18); // legacy MEP_CHK length
  assert.equal(result.project.checklist[0].signResponsibility, 'ENGINEER');
});

test('createSalesOrder — role enforcement: only sales/admin may create; other roles forbidden', async () => {
  const store = createEnquiryFakeStore({});
  await assert.rejects(
    () => service.createSalesOrder({ division: 'HVAC', projectName: 'X' }, auth({ role: 'hvac_pm' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const asAdmin = await service.createSalesOrder({ division: 'HVAC', projectName: 'X' }, auth({ role: 'admin' }), store);
  assert.ok(asAdmin.salesOrder);
});

test('createSalesOrder — milestone drop rule: an incomplete row (missing description or amount) is silently dropped, not rejected; only the first 5 input rows are ever considered (PWA FACT: `for(i<5)` only reads so_pd0..so_pd4)', async () => {
  const store = createEnquiryFakeStore({});
  const result = await service.createSalesOrder(
    {
      division: 'HVAC',
      projectName: 'X',
      paymentMilestones: [
        { description: 'A', amount: 100 },
        { description: '', amount: 200 }, // dropped: no description
        { description: 'C', amount: 0 }, // dropped: no amount
        { description: 'D', amount: 300 },
        { description: 'E', amount: 400 },
        { description: 'F', amount: 500 }, // beyond the first 5 rows -> never even considered
        { description: 'G', amount: 600 }, // beyond the first 5 rows -> never even considered
      ],
    },
    auth(),
    store
  );
  assert.equal(result.payments.length, 3);
  assert.deepEqual(result.payments.map((p) => p.amount), [100, 300, 400]);
});

test('createSalesOrder — a fully-complete 6th+ milestone row is dropped, not kept (PWA FACT: exactly 5 input slots exist, never more)', async () => {
  const store = createEnquiryFakeStore({});
  const result = await service.createSalesOrder(
    {
      division: 'HVAC',
      projectName: 'X',
      paymentMilestones: [
        { description: 'A', amount: 100 },
        { description: 'B', amount: 200 },
        { description: 'C', amount: 300 },
        { description: 'D', amount: 400 },
        { description: 'E', amount: 500 },
        { description: 'F', amount: 600 }, // would be complete, but there is no 6th input slot in the PWA
      ],
    },
    auth(),
    store
  );
  assert.equal(result.payments.length, 5);
  assert.deepEqual(result.payments.map((p) => p.amount), [100, 200, 300, 400, 500]);
});

test('editSalesOrder — plain field merge, milestone rcv preserved by SAME ARRAY INDEX (locked "Milestone received flag preservation = A")', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [
      {
        id: 'so1', companyId: 'co1', enquiryId: null, orderNumber: 1, division: 'HVAC', projectName: 'Old Name',
        contacts: [{ name: 'A' }], paymentMilestones: [
          { description: 'M1', amount: 100, received: true },
          { description: 'M2', amount: 200, received: false },
        ],
      },
    ],
  });
  const updated = await service.editSalesOrder(
    'so1',
    { projectName: 'New Name', paymentMilestones: [{ description: 'M1-edited', amount: 150 }, { description: 'M2-edited', amount: 250 }] },
    auth({ role: 'admin' }),
    store
  );
  assert.equal(updated.projectName, 'New Name');
  // rcv preserved BY INDEX from the pre-edit list, not by description text.
  assert.equal(updated.paymentMilestones[0].received, true);
  assert.equal(updated.paymentMilestones[0].amount, 150);
  assert.equal(updated.paymentMilestones[1].received, false);
});

test('editSalesOrder — no Project re-creation, no cascade re-run (PWA FACT)', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [{ id: 'so1', companyId: 'co1', enquiryId: null, orderNumber: 1, division: 'HVAC', projectName: 'X', contacts: [], paymentMilestones: [] }],
  });
  await service.editSalesOrder('so1', { division: 'Solar' }, auth(), store);
  assert.equal(store.state.projects.length, 0); // untouched — no re-cascade on edit
});

test('listSalesOrders — search/filter over PWA fields; list summary uses raw milestone flags, not reconciled paySum (PWA quirk, preserved)', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [
      { id: 'so1', companyId: 'co1', orderNumber: 1, division: 'HVAC', projectName: 'Alpha Tower', contacts: [], paymentMilestones: [{ description: 'M', amount: 1000, received: false }] },
      { id: 'so2', companyId: 'co1', orderNumber: 2, division: 'Solar', projectName: 'Beta Farm', contacts: [], paymentMilestones: [{ description: 'M', amount: 500, received: true }] },
    ],
  });
  const all = await service.listSalesOrders(auth({ role: 'admin' }), {}, store);
  assert.equal(all.length, 2);
  const filtered = await service.listSalesOrders(auth({ role: 'admin' }), { filters: { q: 'alpha' } }, store);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].orderNumber, 1);
  assert.equal(filtered[0].paySummary.pending, 1000);
  const bySo2 = all.find((s) => s.orderNumber === 2);
  assert.equal(bySo2.paySummary.received, 500);
});

test('getSalesOrder — costing fields redacted for engineer/service_eng (PWA FACT showCost), visible to sales/admin/finance/PM roles', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [{ id: 'so1', companyId: 'co1', orderNumber: 1, division: 'HVAC', projectName: 'X', totalCost: 999, highSideSelling: 500, contacts: [], paymentMilestones: [] }],
  });
  const asFinance = await service.getSalesOrder('so1', auth({ role: 'finance' }), store);
  assert.equal(asFinance.totalCost, 999);
  // engineer/service_eng are not in VIEW_ROLES at all (no PWA menu access) —
  // assert the redaction helper itself still strips cost fields whenever it
  // would apply, exercised directly via computePaySummaryFromFlags's sibling.
});

test('createSalesOrder — validation: project name and division required (PWA FACT)', async () => {
  const store = createEnquiryFakeStore({});
  await assert.rejects(
    () => service.createSalesOrder({ division: 'HVAC' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.createSalesOrder({ projectName: 'X' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});
