'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/dashboardService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

/*
 * Owner request (21 Nov 2026): "In pending payment if payment is lost its
 * Amount will not add in the total balance, lost data should be separate."
 *
 * The sales-order panel on the dashboard states what each order has taken
 * and what is still to come. A milestone whose payment has been written off
 * is not still to come.
 */
test('the sales-order panel stops counting a written-off milestone as pending', async () => {
  const store = createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze', divisions: ['HVAC'] }],
    salesOrders: [{
      id: 'so1', companyId: 'co1', orderNumber: 1, projectName: 'Mask Spaces', division: 'HVAC',
      totalCost: 300000,
      paymentMilestones: [
        { description: 'Advance', amount: 100000, received: true },
        { description: 'On delivery', amount: 125000, received: false },
        { description: 'On handover', amount: 75000, received: false },
      ],
    }],
    payments: [
      { id: 'p2', companyId: 'co1', salesOrderId: 'so1', milestoneIndex: 1, projectOrReference: 'Mask Spaces', amount: 125000, status: 'Pending', partPayments: [] },
      { id: 'p3', companyId: 'co1', salesOrderId: 'so1', milestoneIndex: 2, projectOrReference: 'Mask Spaces', amount: 75000, status: 'Pending', partPayments: [] },
    ],
  });
  const admin = { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin' };

  const before = (await service.getDashboard(admin, store)).panels.salesOrders.find((r) => String(r.salesOrderId) === 'so1');
  assert.equal(before.received, 100000);
  assert.equal(before.pending, 200000, 'both unpaid milestones are still to come');

  const payments = require('../src/services/paymentService');
  await payments.markPaymentLost('p3', { reason: 'Client refused' }, { ...admin, role: 'finance' }, store);

  const after = (await service.getDashboard(admin, store)).panels.salesOrders.find((r) => String(r.salesOrderId) === 'so1');
  assert.equal(after.received, 100000, 'writing one off collects nothing');
  assert.equal(after.pending, 125000, 'the written-off 75,000 is no longer counted as pending');
});
