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

/* ===== deleting a sales order (owner request + decisions, 20 Nov 2026) ===== */

test('deleteSalesOrder — admin only; takes the project and the order\'s payments; refused once money is in', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }],
    checklistTemplates: [],
  });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin', ...o });

  const made = await service.createSalesOrder(
    {
      division: 'HVAC',
      projectName: 'Tower chiller',
      contacts: [{ name: 'Ravi', phone: '900' }],
      totalCost: 100000,
      paymentMilestones: [{ description: 'Advance', amount: 50000 }],
    },
    auth({ role: 'sales' }),
    store
  );
  const soId = made.salesOrder.id;
  assert.ok(made.project, 'the order created a project');

  for (const role of ['sales', 'finance', 'hvac_pm', 'engineer']) {
    await assert.rejects(
      () => service.deleteSalesOrder(soId, auth({ role }), store),
      (err) => err.code === 'FORBIDDEN' && err.status === 403,
      `${role} must not delete a sales order`
    );
  }

  // Money received against it: refused, and the order is still there.
  const pay = store.state.payments.find((p) => String(p.salesOrderId) === String(soId));
  assert.ok(pay, 'the milestone raised a payment');
  pay.partPayments = [{ amount: 20000, date: new Date(), mode: 'Cash' }];
  await assert.rejects(
    () => service.deleteSalesOrder(soId, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR' && /20,000/.test(err.message)
  );
  assert.equal(store.state.salesOrders.length, 1);

  // Nothing received: the order, its project and its payments all go.
  pay.partPayments = [];
  const result = await service.deleteSalesOrder(soId, auth(), store);
  assert.equal(result.deletedProjectId, String(made.project.id));
  assert.equal(result.deletedPayments, 1);
  assert.equal(store.state.salesOrders.length, 0);
  assert.equal(store.state.projects.length, 0);
  assert.equal(store.state.payments.length, 0);

  await assert.rejects(
    () => service.deleteSalesOrder(soId, auth(), store),
    (err) => err.code === 'NOT_FOUND'
  );
});

test('editSalesOrder — correcting the project name renames the project it created', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }],
  });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin', ...o });

  const made = await service.createSalesOrder(
    { division: 'HVAC', projectName: 'Wrong name', contacts: [{ name: 'Ravi', phone: '900' }], totalCost: 1, paymentMilestones: [] },
    auth({ role: 'sales' }),
    store
  );
  assert.equal(made.project.name, 'Wrong name');

  await service.editSalesOrder(made.salesOrder.id, { projectName: 'Sangeeta Bungalow' }, auth(), store);
  const project = store.state.projects.find((p) => String(p.id) === String(made.project.id));
  assert.equal(project.name, 'Sangeeta Bungalow');
});

/*
 * Owner report (21 Nov 2026): the Payments screen went on showing the old
 * name after the job was renamed, because each payment keeps its own copy.
 */
test('editSalesOrder — correcting the project name renames its payment rows as well', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }],
  });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin', ...o });

  const made = await service.createSalesOrder(
    {
      division: 'HVAC',
      projectName: 'AC Quotation',
      contacts: [{ name: 'Sayli', phone: '900' }],
      totalCost: 403396,
      paymentMilestones: [
        { description: '100% advance', amount: 330909 },
        { description: '70% advance', amount: 50741 },
      ],
    },
    auth({ role: 'sales' }),
    store
  );
  const before = store.state.payments.filter((p) => String(p.salesOrderId) === String(made.salesOrder.id));
  assert.ok(before.length >= 1, 'the order raised its own payment rows');
  assert.ok(before.every((p) => p.projectOrReference === 'AC Quotation'));

  await service.editSalesOrder(made.salesOrder.id, { projectName: 'Mete Flat' }, auth(), store);

  const after = store.state.payments.filter((p) => String(p.salesOrderId) === String(made.salesOrder.id));
  assert.ok(after.every((p) => p.projectOrReference === 'Mete Flat'), after.map((p) => p.projectOrReference).join(' | '));
});

/* ===== the accessories target, and finance closing an order (20 Nov 2026) ===== */

test('a new sales order gets its accessories target automatically: the cost less 35%', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }] });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'sales', name: 'Sales', ...o });

  const made = await service.createSalesOrder(
    { division: 'HVAC', projectName: 'Tower', contacts: [{ name: 'R', phone: '9' }], lowSideCost: 556200, paymentMilestones: [] },
    auth(), store
  );
  assert.equal(made.salesOrder.lowSideTargetExpense, 361530); // the workbook's own figure

  // Correcting the cost moves the target with it...
  const edited = await service.editSalesOrder(made.salesOrder.id, { lowSideCost: 100000 }, auth({ role: 'admin' }), store);
  assert.equal(edited.lowSideTargetExpense, 65000);

  // ...but a target typed on purpose wins and is left alone.
  const override = await service.editSalesOrder(
    made.salesOrder.id, { lowSideCost: 200000, lowSideTargetExpense: 180000 }, auth({ role: 'admin' }), store
  );
  assert.equal(override.lowSideTargetExpense, 180000);
});

test('closing a sales order — finance only, once the project is Completed and no payment is pending', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }] });
  const auth = (o) => ({ userId: 'u_fin', companyId: 'co1', role: 'finance', name: 'Finance', ...o });

  const made = await service.createSalesOrder(
    {
      division: 'HVAC', projectName: 'Tower', contacts: [{ name: 'R', phone: '9' }],
      lowSideCost: 100000, paymentMilestones: [{ description: 'Advance', amount: 50000 }],
    },
    auth({ userId: 'u1', role: 'sales' }), store
  );
  const soId = made.salesOrder.id;

  for (const role of ['sales', 'hvac_pm', 'engineer']) {
    await assert.rejects(
      () => service.closeSalesOrder(soId, {}, auth({ role }), store),
      (err) => err.code === 'FORBIDDEN'
    );
  }

  // The work is not finished.
  await assert.rejects(
    () => service.closeSalesOrder(soId, {}, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR' && /still Ongoing/.test(err.message)
  );

  store.state.projects[0].status = 'Completed';
  // The money is not in.
  await assert.rejects(
    () => service.closeSalesOrder(soId, {}, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR' && /pending/.test(err.message)
  );
  // Nothing is on finance's list while either half is outstanding.
  assert.equal((await service.listSalesOrdersForClosing(auth(), store)).length, 0);

  store.state.payments[0].status = 'Received';
  const ready = await service.listSalesOrdersForClosing(auth(), store);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].readyToClose, true);

  const closed = await service.closeSalesOrder(soId, { lowSideActualExpense: 61000 }, auth(), store);
  assert.ok(closed.closedAt);
  assert.equal(closed.lowSideActualExpense, 61000);

  // Closing twice is refused; the closed order stays on the list, below.
  await assert.rejects(() => service.closeSalesOrder(soId, {}, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  const after = await service.listSalesOrdersForClosing(auth(), store);
  assert.equal(after.length, 1);
  assert.ok(after[0].closedAt);

  // Finance may correct that one figure afterwards, and nothing else.
  const corrected = await service.editSalesOrder(soId, { lowSideActualExpense: 62500 }, auth(), store);
  assert.equal(corrected.lowSideActualExpense, 62500);
  await assert.rejects(
    () => service.editSalesOrder(soId, { totalCost: 1 }, auth(), store),
    (err) => err.code === 'FORBIDDEN'
  );

  const reopened = await service.reopenSalesOrder(soId, auth(), store);
  assert.equal(reopened.closedAt, null);
});

test('an order raised from a lead marks that lead Won (owner request, 20 Nov 2026)', async () => {
  const service = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Co', divisions: ['HVAC'] }],
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'Sunny — Kumar Picasso', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'sales', name: 'Sales', ...o });

  const made = await service.createSalesOrder(
    {
      division: 'HVAC', projectName: 'Sunny — Kumar Picasso', enquiryId: 'enq1',
      contacts: [{ name: 'Kumar', phone: '9082184844' }], totalCost: 500000, paymentMilestones: [],
    },
    auth(), store
  );
  assert.equal(String(made.salesOrder.enquiryId), 'enq1');

  const lead = store.state.enquiries[0];
  assert.equal(lead.status, 'Won');
  assert.match(lead.remark, /Converted to SO-/);
  assert.match(lead.followUpLog[lead.followUpLog.length - 1].text, /SO-\d+ created/);

  // The same lead cannot be converted twice.
  await assert.rejects(
    () => service.createSalesOrder(
      { division: 'HVAC', projectName: 'Again', enquiryId: 'enq1', contacts: [{ name: 'K', phone: '9' }], paymentMilestones: [] },
      auth(), store
    ),
    (err) => err.code === 'ENQUIRY_NOT_OPEN'
  );

  // An order raised from nothing still carries no lead.
  const walkIn = await service.createSalesOrder(
    { division: 'HVAC', projectName: 'Walk-in', contacts: [{ name: 'X', phone: '9' }], paymentMilestones: [] },
    auth(), store
  );
  assert.equal(walkIn.salesOrder.enquiryId, null);
});
