'use strict';

/**
 * Owner request (18 Nov 2026): "first add edit option to Sales order and
 * qoutation" ... "in Project manager login."
 *
 * A division Manager runs the job and was the one person who could not
 * correct the order or the quotation describing it. They may now — but on
 * the sales order they edit the JOB, not the deal: the cost, the margin and
 * the payment milestones stay with sales and admin (owner's decision, asked
 * and answered). On a quotation they edit as sales does, prices included.
 *
 * Both are confined to their own division, the rule their other screens
 * already follow.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const salesOrderService = require('../src/services/salesOrderService');
const quotationService = require('../src/services/quotationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (role, o = {}) => ({ userId: 'u1', companyId: 'co1', role, name: role, ...o });

const so = (over = {}) => ({
  id: 'so1', companyId: 'co1', orderNumber: 1, division: 'HVAC',
  projectName: 'Undri site', siteAddress: 'Undri, Pune',
  contacts: [{ name: 'Mr Shah', designation: 'Owner', phone: '9820011223' }],
  salesTeam: 'Sales One', projectTeam: 'PM One', crucialPoints: '',
  totalCost: 100000, highSideSelling: 90000, highSidePurchase: 70000,
  lowSideCost: 10000, lowSideTargetExpense: 5000, lowSideActualExpense: 0,
  termsAndConditions: 'Standard', paymentMilestones: [{ description: 'Advance', amount: 50000, received: false }],
  ...over,
});

const store = (salesOrders = [so()], extra = {}) => createEnquiryFakeStore({
  companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
  salesOrders,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * The sales order
 * ------------------------------------------------------------------ */

test('a Manager corrects the job on their own division’s order', async () => {
  const s = store();
  const after = await salesOrderService.editSalesOrder('so1', {
    siteAddress: 'Plant 2, Chakan',
    crucialPoints: 'Crane needed on the 3rd',
  }, auth('hvac_pm'), s);
  assert.equal(after.siteAddress, 'Plant 2, Chakan');
  assert.equal(after.crucialPoints, 'Crane needed on the 3rd');
});

test('every field a Manager may change is accepted together', async () => {
  const s = store();
  const after = await salesOrderService.editSalesOrder('so1', {
    projectName: 'Undri site — phase 2',
    startDate: '2026-12-01',
    endDate: '2027-03-01',
    siteAddress: 'Undri, Pune 411060',
    contacts: [{ name: 'Mr Patil', designation: 'Maintenance', phone: '9820044556' }],
    projectTeam: 'PM Two',
    crucialPoints: 'Night work only',
    termsAndConditions: 'Revised',
  }, auth('mep_pm', { role: 'hvac_pm' }), s);
  assert.equal(after.projectName, 'Undri site — phase 2');
  assert.equal(after.contacts[0].name, 'Mr Patil');
  assert.equal(after.projectTeam, 'PM Two');
});

for (const field of ['totalCost', 'highSideSelling', 'highSidePurchase', 'lowSideCost', 'lowSideTargetExpense', 'lowSideActualExpense', 'paymentMilestones', 'division', 'salesTeam']) {
  test(`a Manager cannot change ${field}`, async () => {
    const s = store();
    await assert.rejects(
      () => salesOrderService.editSalesOrder('so1', { [field]: field === 'paymentMilestones' ? [] : 1 }, auth('hvac_pm'), s),
      (err) => err.code === 'FORBIDDEN' && err.status === 403 && err.message.includes(field)
    );
    // And nothing was written on the way to being refused.
    assert.equal((await s.salesOrderRepo.listByCompany('co1'))[0].totalCost, 100000);
  });
}

test('sales and admin still change the money', async () => {
  const s = store();
  const after = await salesOrderService.editSalesOrder('so1', { highSidePurchase: 65000 }, auth('sales'), s);
  assert.equal(after.highSidePurchase, 65000);
});

test('another division’s order is not theirs to edit — 404, not 403', async () => {
  const s = store([so({ division: 'Solar' })]);
  await assert.rejects(
    () => salesOrderService.editSalesOrder('so1', { crucialPoints: 'x' }, auth('hvac_pm'), s),
    (err) => err.status === 404
  );
});

test('a role with no business here still cannot edit', async () => {
  const s = store();
  for (const role of ['engineer', 'inventory', 'service_eng', 'finance']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      () => salesOrderService.editSalesOrder('so1', { crucialPoints: 'x' }, auth(role), s),
      (err) => err.status === 403
    );
  }
});

/* ------------------------------------------------------------------ *
 * The quotation
 * ------------------------------------------------------------------ */

test('a Manager is among the roles that may read and edit a quotation', () => {
  for (const role of ['hvac_pm', 'solar_pm', 'mep_pm']) {
    assert.ok(quotationService.VIEW_ROLES.includes(role));
    assert.ok(quotationService.EDIT_ROLES.includes(role));
    assert.ok(!quotationService.COMMERCIAL_ROLES.includes(role), 'but not raising or exporting one');
  }
});

test('a Manager is confined to their own division’s quotation', () => {
  assert.equal(quotationService.divisionScope(auth('hvac_pm')), 'HVAC');
  assert.equal(quotationService.divisionScope(auth('solar_pm')), 'Solar');
  assert.equal(quotationService.divisionScope(auth('mep_pm')), 'MEP');
  assert.equal(quotationService.divisionScope(auth('sales')), '', 'sales sees them all');
  assert.equal(quotationService.divisionScope(auth('admin')), '');
});

test('another division’s quotation answers 404, not 403', () => {
  assert.throws(
    () => quotationService.assertDivisionVisible(auth('hvac_pm'), { division: 'Solar' }),
    (err) => err.status === 404 && /not found/i.test(err.message)
  );
  // Their own passes, and so does everyone else's view of anything.
  quotationService.assertDivisionVisible(auth('hvac_pm'), { division: 'HVAC' });
  quotationService.assertDivisionVisible(auth('sales'), { division: 'Solar' });
  quotationService.assertDivisionVisible(auth('admin'), { division: 'MEP' });
});
