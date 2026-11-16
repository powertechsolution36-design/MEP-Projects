'use strict';

/**
 * DEFECT, reported from production 16 Nov 2026: "Internal error" on every
 * attempt to raise a sales order that has no lead behind it — both the
 * standalone "+ New SO" and the conversion of a quotation raised directly.
 *
 * Cause: SalesOrder.enquiryId (and, since 14 Nov, quotationId) defaulted to
 * null while carrying a unique SPARSE index. A sparse index skips a document
 * whose field is ABSENT but indexes an explicit null, so the first such
 * order put null in the index and every one after it collided. The
 * duplicate-key error was then re-thrown as a bare Error with no status,
 * which the route could not recognise, so it answered 500 "Internal error."
 *
 * These tests raise several orders with no lead in a row, which is exactly
 * what failed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const salesOrderService = require('../src/services/salesOrderService');
const quotationService = require('../src/services/quotationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'sales', name: 'Priya Sales', ...o });
const store = () => createEnquiryFakeStore({
  checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
});
const walkIn = (n) => ({
  division: 'Solar',
  projectName: `Walk-in ${n}`,
  contacts: [{ name: 'Anita', phone: '9000011111' }],
  totalCost: 1000,
  paymentMilestones: [],
});

test('three walk-in sales orders in a row all succeed — none has a lead, and that is not a clash', async () => {
  const s = store();
  const numbers = [];
  for (let i = 1; i <= 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await salesOrderService.createSalesOrder(walkIn(i), auth(), s);
    numbers.push(r.salesOrder.orderNumber);
  }
  assert.deepEqual(numbers, [1, 2, 3]);
});

test('a walk-in order still reports both links as null, so the API shape is unchanged', async () => {
  const s = store();
  const r = await salesOrderService.createSalesOrder(walkIn(1), auth(), s);
  assert.equal(r.salesOrder.enquiryId, null);
  assert.equal(r.salesOrder.quotationId, null);
  const fetched = await salesOrderService.getSalesOrder(r.salesOrder.id, auth(), s);
  assert.equal(fetched.enquiryId, null);
  assert.equal(fetched.quotationId, null);
});

test('two quotations raised without a lead both convert — neither carries an enquiry', async () => {
  const s = createEnquiryFakeStore({
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
    quotations: [
      { id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', status: 'Sent', division: 'Solar', customerName: 'A', grandTotal: 1000, enquiryId: null },
      { id: 'qt2', companyId: 'co1', quotationNumber: 'QTN-0002', status: 'Sent', division: 'Solar', customerName: 'B', grandTotal: 2000, enquiryId: null },
    ],
  });
  const first = await quotationService.convertQuotationToSalesOrder('qt1', { projectName: 'One', paymentMilestones: [] }, auth(), s);
  const second = await quotationService.convertQuotationToSalesOrder('qt2', { projectName: 'Two', paymentMilestones: [] }, auth(), s);
  assert.equal(first.salesOrder.enquiryId, null);
  assert.equal(second.salesOrder.enquiryId, null);
  assert.equal(String(first.salesOrder.quotationId), 'qt1');
  assert.equal(String(second.salesOrder.quotationId), 'qt2');
  assert.notEqual(first.salesOrder.orderNumber, second.salesOrder.orderNumber);
});

test('a walk-in order and a converted one can live side by side', async () => {
  const s = createEnquiryFakeStore({
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
    quotations: [{ id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', status: 'Sent', division: 'Solar', customerName: 'A', grandTotal: 1000, enquiryId: null }],
  });
  await salesOrderService.createSalesOrder(walkIn(1), auth(), s);
  const converted = await quotationService.convertQuotationToSalesOrder('qt1', { projectName: 'From quote', paymentMilestones: [] }, auth(), s);
  await salesOrderService.createSalesOrder(walkIn(2), auth(), s);
  assert.ok(converted.salesOrder.id);
  const all = await salesOrderService.listSalesOrders(auth(), {}, s);
  assert.equal(all.length, 3);
});

test('the real duplicate is still refused, and now says so properly instead of failing as a server error', async () => {
  const s = createEnquiryFakeStore({
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
    quotations: [{ id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', status: 'Sent', division: 'Solar', customerName: 'A', grandTotal: 1000, enquiryId: null }],
  });
  await quotationService.convertQuotationToSalesOrder('qt1', { projectName: 'One', paymentMilestones: [] }, auth(), s);
  await assert.rejects(
    () => quotationService.convertQuotationToSalesOrder('qt1', { projectName: 'Again', paymentMilestones: [] }, auth(), s),
    (err) => err.code === 'DUPLICATE_CONVERSION' && err.status === 409
  );
});
