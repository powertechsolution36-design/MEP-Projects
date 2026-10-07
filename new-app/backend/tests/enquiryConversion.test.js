'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/enquiryService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'sales', ...overrides };
}

function baseEnquiry(overrides) {
  return {
    id: 'enq1',
    companyId: 'co1',
    name: 'Sneh Resort AC',
    segment: 'AMC', // exercises the AMC -> HVAC transform
    phone: '8605394494',
    estimatedValue: 200000,
    status: 'Open',
    followUpLog: [],
    ...overrides,
  };
}

test('convertEnquiryToSalesOrder — full cascade: field copy/transform/default, enquiryId population, project, payments, checklist, notifications, Won+remark+log', async () => {
  const store = createEnquiryFakeStore({
    enquiries: [baseEnquiry()],
    checklistTemplates: [
      { id: 'tpl1', companyId: 'co1', division: 'HVAC', name: 'Standard HVAC', isDefault: true, items: [{ text: 'Site survey', signResponsibility: 'ENGINEER' }, { text: 'Client sign-off', signResponsibility: 'CLIENT' }] },
      { id: 'tpl2', companyId: 'co1', division: 'HVAC', name: 'Alt HVAC', isDefault: false, items: [] },
    ],
    users: [{ id: 'u1', name: 'Priya Sales', role: 'sales', companyId: 'co1' }],
  });

  const result = await service.convertEnquiryToSalesOrder(
    'enq1',
    {
      contacts: [{ name: 'Yuvraj', designation: 'Owner' }],
      paymentMilestones: [
        { description: 'Advance', amount: 100000 },
        { description: 'Balance', amount: 100000 },
      ],
    },
    auth(),
    store
  );

  // --- SalesOrder: exact copy/transform/default behavior ---
  assert.equal(result.salesOrder.division, 'HVAC'); // AMC -> HVAC transform
  assert.equal(result.salesOrder.projectName, 'Sneh Resort AC'); // copied from Enquiry.name
  assert.equal(result.salesOrder.totalCost, 200000); // copied from Enquiry.estimatedValue
  assert.equal(result.salesOrder.contacts[0].phone, '8605394494'); // copied from Enquiry.phone
  assert.equal(result.salesOrder.contacts[0].name, 'Yuvraj'); // from override (not derivable from Enquiry)
  assert.equal(result.salesOrder.salesTeam, 'Priya Sales'); // defaulted to converting user's name
  assert.match(result.salesOrder.termsAndConditions, /Fabrication not in our scope/); // fixed boilerplate default
  assert.ok(result.salesOrder.startDate);
  assert.equal(typeof result.salesOrder.orderNumber, 'number');

  // --- #20=D: enquiryId set automatically, never client-editable ---
  assert.equal(result.salesOrder.enquiryId, 'enq1');

  // --- Project: division's first stage, checklist from default template, customer from contact ---
  assert.equal(result.project.division, 'HVAC');
  assert.equal(result.project.stage, 'Planning'); // PROJECT_STAGES_BY_DIVISION.HVAC[0]
  assert.equal(result.project.customer, 'Yuvraj');
  assert.equal(result.project.siteType, '');
  assert.equal(result.project.capacity, '');
  assert.equal(result.project.checklistTemplateName, 'Standard HVAC'); // isDefault=true one, not the other
  assert.equal(result.project.checklist.length, 2);
  assert.equal(result.project.checklist[0].text, 'Site survey');
  assert.equal(result.project.checklist[0].done, false);
  assert.equal(result.project.salesOrderId, result.salesOrder.id);

  // --- Payments: one per milestone, all unreceived, exact field mapping ---
  assert.equal(result.payments.length, 2);
  assert.equal(result.payments[0].personName, 'Yuvraj');
  assert.equal(result.payments[0].phone, '8605394494');
  assert.equal(result.payments[0].amount, 100000);
  assert.equal(result.payments[0].status, 'Pending');
  assert.match(result.payments[0].remark, new RegExp(`SO ${result.salesOrder.orderNumber} milestone 1: Advance`));
  assert.equal(result.payments[1].milestoneIndex, 1);
  assert.equal(result.payments[0].salesOrderId, result.salesOrder.id);

  // --- Notifications: exact literal text, exact target roles ---
  assert.equal(result.notifications.length, 2);
  const soNotif = result.notifications.find((n) => n.targetRoles.includes('hvac_pm'));
  assert.ok(soNotif);
  assert.deepEqual(soNotif.targetRoles.sort(), ['admin', 'hvac_pm'].sort());
  assert.match(soNotif.text, /Project created — assign engineer/);
  const financeNotif = result.notifications.find((n) => n.targetRoles.includes('finance'));
  assert.ok(financeNotif);
  assert.match(financeNotif.text, /payment terms added to pending payment list/);

  // --- Enquiry: Won + remark overwrite + followUpLog entry ---
  assert.equal(result.enquiry.status, 'Won');
  assert.match(result.enquiry.remark, new RegExp(`Converted to SO-${result.salesOrder.orderNumber}`));
  assert.equal(result.enquiry.followUpLog.length, 1);
  assert.match(result.enquiry.followUpLog[0].text, new RegExp(`Confirmed\\. SO-${result.salesOrder.orderNumber} created\\.`));
});

test('convertEnquiryToSalesOrder — #19=B: rejects conversion of a non-Open Enquiry', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry({ status: 'Lost' })] });
  await assert.rejects(
    () => service.convertEnquiryToSalesOrder('enq1', {}, auth(), store),
    (err) => err.code === 'ENQUIRY_NOT_OPEN' && err.status === 409
  );
  assert.equal(store.state.salesOrders.length, 0); // nothing created
});

test('convertEnquiryToSalesOrder — #19=B: rejects a second conversion of an already-Won Enquiry (pre-check)', async () => {
  const store = createEnquiryFakeStore({
    enquiries: [baseEnquiry({ status: 'Won' })],
    salesOrders: [{ id: 'so-existing', companyId: 'co1', enquiryId: 'enq1', orderNumber: 1 }],
  });
  await assert.rejects(
    () => service.convertEnquiryToSalesOrder('enq1', {}, auth(), store),
    (err) => err.status === 409
  );
});

test('convertEnquiryToSalesOrder — #20=D duplicate-key guard: a race that gets past the pre-check is still rejected atomically', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry()] });

  // Simulate two concurrent conversions racing past the pre-check by
  // directly inserting a competing SalesOrder for this Enquiry right before
  // the real create() call would run, exercising the repo's own duplicate
  // detection (the fake's analogue of the real unique index / 11000 error).
  const originalCreate = store.salesOrderRepo.create;
  let firstCall = true;
  store.salesOrderRepo.create = async (data, session) => {
    if (firstCall) {
      firstCall = false;
      store.state.salesOrders.push({ id: 'so-raced-in', companyId: data.companyId, enquiryId: data.enquiryId, orderNumber: 999 });
    }
    return originalCreate(data, session);
  };

  await assert.rejects(
    () => service.convertEnquiryToSalesOrder('enq1', {}, auth(), store),
    (err) => err.code === 'DUPLICATE_CONVERSION'
  );
});

test('convertEnquiryToSalesOrder — transactional cascade cannot partially succeed: a downstream failure rolls back everything, including the Enquiry Won transition', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry()] });

  // Force the Payment step to fail after the Enquiry has already been
  // marked Won and the SalesOrder + Project already created within the same
  // transaction attempt — asserting the whole cascade rolls back together.
  store.paymentRepo.create = async () => {
    throw new Error('simulated downstream failure');
  };

  await assert.rejects(
    () =>
      service.convertEnquiryToSalesOrder(
        'enq1',
        { paymentMilestones: [{ description: 'Advance', amount: 50000 }] },
        auth(),
        store
      ),
    /simulated downstream failure/
  );

  // Nothing partially committed — rolled back to the pre-transaction snapshot.
  assert.equal(store.state.salesOrders.length, 0);
  assert.equal(store.state.projects.length, 0);
  assert.equal(store.state.notifications.length, 0);
  const enquiry = await store.enquiryRepo.findById('co1', 'enq1');
  assert.equal(enquiry.status, 'Open'); // NOT left as Won from the rolled-back attempt
  assert.equal(enquiry.followUpLog.length, 0);
});

test('convertEnquiryToSalesOrder — with zero payment milestones still creates the SO/Project and both notifications (PWA does the finance notify unconditionally)', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry()] });
  const result = await service.convertEnquiryToSalesOrder('enq1', {}, auth(), store);
  assert.equal(result.payments.length, 0);
  assert.equal(result.notifications.length, 2);
});

test('convertEnquiryToSalesOrder — role/tenant enforcement: admin may convert, other roles and other companies may not', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry()] });
  const resultAsAdmin = await service.convertEnquiryToSalesOrder('enq1', {}, auth({ role: 'admin' }), store);
  assert.ok(resultAsAdmin.salesOrder);

  const store2 = createEnquiryFakeStore({ enquiries: [baseEnquiry()] });
  await assert.rejects(
    () => service.convertEnquiryToSalesOrder('enq1', {}, auth({ role: 'engineer' }), store2),
    (err) => err.code === 'FORBIDDEN'
  );

  const store3 = createEnquiryFakeStore({ enquiries: [baseEnquiry({ companyId: 'other-co' })] });
  await assert.rejects(
    () => service.convertEnquiryToSalesOrder('enq1', {}, auth({ companyId: 'co1' }), store3),
    /not found/i
  );
});

test('convertEnquiryToSalesOrder — falls back to any division template when none is marked isDefault', async () => {
  const store = createEnquiryFakeStore({
    enquiries: [baseEnquiry()],
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'HVAC', name: 'Only One', isDefault: false, items: [{ text: 'Step', signResponsibility: 'ENGINEER' }] }],
  });
  const result = await service.convertEnquiryToSalesOrder('enq1', {}, auth(), store);
  assert.equal(result.project.checklistTemplateName, 'Only One');
  assert.equal(result.project.checklist.length, 1);
});

test('convertEnquiryToSalesOrder — with no ChecklistTemplate at all, falls back to the legacy hardcoded checklist (locked decision "Checklist fallback = A"), not an empty list', async () => {
  const store = createEnquiryFakeStore({ enquiries: [baseEnquiry()] }); // segment "AMC" -> division "HVAC"
  const result = await service.convertEnquiryToSalesOrder('enq1', {}, auth(), store);
  // Blank template name (PWA FACT: `chkName:cl?cl.name:""` — the legacy
  // fallback is not a named ChecklistTemplate), but a NON-empty checklist
  // taken from the legacy HVAC_CHK list (13 points).
  assert.equal(result.project.checklistTemplateName, '');
  assert.equal(result.project.checklist.length, 13);
  assert.equal(result.project.checklist[0].text, 'Site takeover with all details and requirements from Sales Team');
  assert.equal(result.project.checklist[0].signResponsibility, 'SALES');
  assert.equal(result.project.checklist[0].done, false);
});
