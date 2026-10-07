'use strict';
// Pass/Stage 4 (SECURITY / TENANT / AUTHORIZATION VERIFICATION) tenant-
// isolation regression test: direct cross-tenant lookup attempts against
// SalesOrder and Payment -- the two entities in the 4.4 tenant-isolation
// matrix that had no existing dedicated test (salesOrderService.test.js /
// paymentService.test.js exercised business logic but not the
// cross-company 404 path already enforced by
// salesOrderRepo.findById(companyId,id) / paymentRepo.findById(companyId,id)).
// Added while verifying, not fixing, a gap -- the underlying enforcement
// already existed; this closes the TEST COVERAGE GAP only.

const test = require('node:test');
const assert = require('node:assert/strict');

const salesOrderService = require('../src/services/salesOrderService');
const paymentService = require('../src/services/paymentService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { ServiceError } = require('../src/errors');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin One', ...overrides };
}

test('getSalesOrder direct lookup — cross-company access is rejected', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [{ id: 'so_other', companyId: 'co2', division: 'HVAC', orderNumber: 1, paymentMilestones: [] }],
  });
  await assert.rejects(
    () => salesOrderService.getSalesOrder('so_other', auth({ companyId: 'co1' }), store),
    (err) => err instanceof ServiceError && err.status === 404
  );
});

test('editSalesOrder direct lookup — cross-company edit is rejected', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [{ id: 'so_other', companyId: 'co2', division: 'HVAC', orderNumber: 1, paymentMilestones: [] }],
  });
  await assert.rejects(
    () => salesOrderService.editSalesOrder('so_other', { division: 'Solar' }, auth({ companyId: 'co1' }), store),
    (err) => err instanceof ServiceError && err.status === 404
  );
});

test('getPayment direct lookup — cross-company access is rejected', async () => {
  const store = createEnquiryFakeStore({
    payments: [{ id: 'pay_other', companyId: 'co2', status: 'Pending', amount: 1000, partPayments: [] }],
  });
  await assert.rejects(
    () => paymentService.getPayment('pay_other', auth({ companyId: 'co1', role: 'finance' }), store),
    (err) => err instanceof ServiceError && err.status === 404
  );
});

test('deletePaymentRecord direct lookup — cross-company delete is rejected', async () => {
  const store = createEnquiryFakeStore({
    payments: [{ id: 'pay_other2', companyId: 'co2', status: 'Pending', amount: 1000, partPayments: [], salesOrderId: null }],
  });
  await assert.rejects(
    () => paymentService.deletePaymentRecord('pay_other2', auth({ companyId: 'co1', role: 'finance' }), store),
    (err) => err instanceof ServiceError && err.status === 404
  );
});

test('getEnquiry direct lookup — cross-company access is rejected (companion to the existing editEnquiry tenant test)', async () => {
  const enquiryService = require('../src/services/enquiryService');
  const store = createEnquiryFakeStore({
    enquiries: [{ id: 'enq_other', companyId: 'co2', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  await assert.rejects(
    () => enquiryService.getEnquiry('enq_other', auth({ companyId: 'co1', role: 'sales' }), store),
    (err) => err instanceof ServiceError && err.status === 404
  );
});
