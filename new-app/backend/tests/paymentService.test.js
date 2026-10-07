'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/paymentService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'finance', ...overrides };
}

function soLinkedPayment(overrides) {
  return {
    id: 'pay1', companyId: 'co1', projectOrReference: 'Tower A', personName: 'Ravi', phone: '900', amount: 100000,
    remark: 'SO 1 milestone 1: Advance', status: 'Pending', salesOrderId: 'so1', milestoneIndex: 0,
    partPayments: [], raisedToFinance: null, receivedDate: null, ...overrides,
  };
}
function baseSalesOrder(overrides) {
  return {
    id: 'so1', companyId: 'co1', orderNumber: 1, division: 'HVAC', projectName: 'Tower A', contacts: [{ name: 'Ravi', phone: '900' }],
    paymentMilestones: [{ description: 'Advance', amount: 100000, received: false }], ...overrides,
  };
}

test('addPartPayment — full payment clears balance, syncs status to Received, sets SO milestone rcv=true, notifies admin+sales', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment()], salesOrders: [baseSalesOrder()] });
  const updated = await service.addPartPayment('pay1', { amount: 100000, mode: 'UPI' }, auth(), store);
  assert.equal(updated.status, 'Received');
  assert.ok(updated.receivedDate);
  const so = await store.salesOrderRepo.findById('co1', 'so1');
  assert.equal(so.paymentMilestones[0].received, true);
  const notif = store.state.notifications.find((n) => /fully received/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles.sort(), ['admin', 'sales']);
});

test('addPartPayment — part payment keeps status Pending, milestone stays unreceived, "part payment received" notification', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment()], salesOrders: [baseSalesOrder()] });
  const updated = await service.addPartPayment('pay1', { amount: 40000, mode: 'Cash' }, auth(), store);
  assert.equal(updated.status, 'Pending');
  assert.equal(updated.receivedDate, null);
  const so = await store.salesOrderRepo.findById('co1', 'so1');
  assert.equal(so.paymentMilestones[0].received, false);
  const notif = store.state.notifications.find((n) => /Part payment received/.test(n.text));
  assert.ok(notif);
  assert.match(notif.text, /Balance ₹ 60,000/); // FIX-3.7-03: money() formatting restored
});

test('addPartPayment — over-payment rejected without confirmOverpayment, allowed with it (PWA FACT: confirm() dialog)', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment({ amount: 1000 })] });
  await assert.rejects(
    () => service.addPartPayment('pay1', { amount: 5000 }, auth(), store),
    (err) => err.code === 'OVERPAYMENT_CONFIRMATION_REQUIRED'
  );
  const updated = await service.addPartPayment('pay1', { amount: 5000, confirmOverpayment: true }, auth(), store);
  assert.equal(updated.status, 'Received'); // balance <= 0 even though over-paid
});

test('removePartPayment — deleting an entry can flip a Received milestone back to Pending (PWA FACT reversal)', async () => {
  const store = createEnquiryFakeStore({
    payments: [soLinkedPayment({ status: 'Received', receivedDate: new Date(), partPayments: [{ id: 'pp1', amount: 100000, date: new Date(), mode: 'UPI', recordedByUserId: 'u1' }] })],
    salesOrders: [baseSalesOrder({ paymentMilestones: [{ description: 'Advance', amount: 100000, received: true }] })],
  });
  const updated = await service.removePartPayment('pay1', 'pp1', auth(), store);
  assert.equal(updated.status, 'Pending');
  assert.equal(updated.receivedDate, null);
  const so = await store.salesOrderRepo.findById('co1', 'so1');
  assert.equal(so.paymentMilestones[0].received, false);
});

test('editPartPayment — stamps editedBy/editedOn and re-syncs status', async () => {
  const store = createEnquiryFakeStore({
    payments: [soLinkedPayment({ partPayments: [{ id: 'pp1', amount: 50000, date: new Date(), mode: 'Cash', recordedByUserId: 'u9' }] })],
    salesOrders: [baseSalesOrder()],
  });
  const updated = await service.editPartPayment('pay1', 'pp1', { amount: 100000 }, auth({ userId: 'u2' }), store);
  assert.equal(updated.partPayments[0].amount, 100000);
  assert.equal(updated.partPayments[0].editedByUserId, 'u2');
  assert.ok(updated.partPayments[0].editedOn);
  assert.equal(updated.status, 'Received'); // now fully covers the 100000 milestone
});

test('editMilestone — Payment-side amount edit writes FORWARD to the SO milestone (locked asymmetric sync), rejects below-received, does NOT call syncPayStatus (PWA FACT)', async () => {
  const store = createEnquiryFakeStore({
    payments: [soLinkedPayment({ partPayments: [{ id: 'pp1', amount: 30000, date: new Date(), mode: 'Cash', recordedByUserId: 'u1' }] })],
    salesOrders: [baseSalesOrder()],
  });
  await assert.rejects(
    () => service.editMilestone('pay1', { amount: 10000 }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  const updated = await service.editMilestone('pay1', { amount: 150000 }, auth(), store);
  assert.equal(updated.amount, 150000);
  const so = await store.salesOrderRepo.findById('co1', 'so1');
  assert.equal(so.paymentMilestones[0].amount, 150000); // written forward
  // status is NOT recomputed here (PWA FACT: savePayEdit never calls syncPayStatus) —
  // it stays whatever it was before this edit (still Pending from the seed).
  assert.equal(updated.status, 'Pending');
});

test('editSalesOrder (SO-side) amount edit does NOT push forward to the Payment record (locked asymmetric sync, other direction)', async () => {
  const salesOrderService = require('../src/services/salesOrderService');
  const store = createEnquiryFakeStore({
    payments: [soLinkedPayment()],
    salesOrders: [baseSalesOrder()],
  });
  await salesOrderService.editSalesOrder('so1', { paymentMilestones: [{ description: 'Advance', amount: 999999 }] }, { userId: 'u1', companyId: 'co1', role: 'admin' }, store);
  const payment = await store.paymentRepo.findById('co1', 'pay1');
  assert.equal(payment.amount, 100000); // untouched — SO edit never syncs to Payment
});

test('raiseToFinance — creates the Payment on the fly if missing, populates raised, notifies finance+admin, enforces division-matched PM role', async () => {
  const store = createEnquiryFakeStore({ salesOrders: [baseSalesOrder({ paymentMilestones: [{ description: 'Advance', amount: 100000, received: false }] })] });
  const updated = await service.raiseToFinance('so1', 0, { note: 'Site ready', priority: 'Urgent' }, auth({ role: 'hvac_pm' }), store);
  assert.equal(updated.salesOrderId, 'so1');
  assert.equal(updated.milestoneIndex, 0);
  assert.ok(updated.raisedToFinance);
  assert.equal(updated.raisedToFinance.priority, 'Urgent');
  const notif = store.state.notifications.find((n) => /URGENT/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles.sort(), ['admin', 'finance']);

  await assert.rejects(
    () => service.raiseToFinance('so1', 0, { note: 'x' }, auth({ role: 'solar_pm' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('deletePaymentRecord — only permitted when NOT SO-linked (PWA FACT delPayRow)', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment(), { id: 'pay2', companyId: 'co1', projectOrReference: 'Manual', personName: 'X', amount: 500, status: 'Pending', partPayments: [], salesOrderId: null }] });
  await assert.rejects(() => service.deletePaymentRecord('pay1', auth(), store), (err) => err.code === 'FORBIDDEN');
  const ok = await service.deletePaymentRecord('pay2', auth(), store);
  assert.equal(ok, true);
});

test('createManualPayment — no SO link, requires project/reference and amount (PWA FACT savePayNew)', async () => {
  const store = createEnquiryFakeStore({});
  await assert.rejects(() => service.createManualPayment({ projectOrReference: 'X' }, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  const payment = await service.createManualPayment({ projectOrReference: 'Other receivable', amount: 5000 }, auth(), store);
  assert.equal(payment.salesOrderId, null);
  assert.equal(payment.status, 'Pending');
});

test('role enforcement: only finance/admin manage the payment ledger', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment()] });
  await assert.rejects(
    () => service.addPartPayment('pay1', { amount: 100 }, auth({ role: 'sales' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const asAdmin = await service.addPartPayment('pay1', { amount: 100 }, auth({ role: 'admin' }), store);
  assert.ok(asAdmin);
});

/* ================= FIX-6-05: exportPendingPaymentsCsv full scope ================= */

test('FIX-6-05 — exportPendingPaymentsCsv reproduces dlPayments() in full: ALL payments (not just Pending), with SO No, Status and Part-Payments columns from the correct related records', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [baseSalesOrder({ id: 'so1', orderNumber: 36002 })],
    users: [{ id: 'u1', companyId: 'co1', name: 'Vaibhavi Finance' }],
    payments: [
      soLinkedPayment({
        id: 'pay1', salesOrderId: 'so1', milestoneIndex: 0, status: 'Pending', amount: 200000,
        raisedToFinance: { raisedByUserId: 'u1', raisedByRole: 'admin', raisedDate: new Date('2026-06-01'), collectByDate: new Date('2026-06-10'), priority: 'Normal' },
        partPayments: [{ id: 'pp1', amount: 50000, date: new Date('2026-06-05'), mode: 'Cash', recordedByUserId: 'u1' }],
      }),
      // A fully Received payment — MUST appear now (previously hard-filtered to status:'Pending' only, so this row was silently dropped).
      { id: 'pay2', companyId: 'co1', projectOrReference: 'Other Job', personName: 'Kunal', phone: '999', amount: 30000, status: 'Received', salesOrderId: null, partPayments: [{ id: 'pp2', amount: 30000, date: new Date('2026-05-01'), mode: 'UPI', recordedByUserId: 'u1' }] },
      // Cross-tenant payment — must never leak into co1's export.
      { id: 'pay3', companyId: 'co2', projectOrReference: 'Other Co', personName: 'X', amount: 1000, status: 'Pending', partPayments: [] },
    ],
  });
  const csv = await service.exportPendingPaymentsCsv(auth(), store);
  const [, , header, ...bodyLines] = csv.split('\n');
  assert.deepEqual(
    header.split(','),
    ['Project', 'SO No', 'Person', 'Phone', 'Milestone Amount', 'Received', 'Balance', 'Status', 'Raised by PM', 'Raised On', 'Collect By', 'Last Call', 'Discussion', 'Next Call', 'Remark', 'Part Payments']
  );
  // Received-status row must be present (the FIX-6-05 defect hard-filtered it out).
  assert.ok(bodyLines.some((l) => l.startsWith('Other Job')), 'Received payment must not be dropped from the export');
  const row1 = bodyLines.find((l) => l.startsWith('Tower A'));
  assert.ok(row1);
  const cells1 = row1.split(',');
  assert.equal(cells1[1], '36002'); // SO No, from the linked SalesOrder's orderNumber
  assert.equal(cells1[4], '200000'); // Milestone Amount
  assert.equal(cells1[5], '50000'); // Received
  assert.equal(cells1[6], '150000'); // Balance
  assert.equal(cells1[7], 'Pending'); // Status, read directly off the payment record
  assert.equal(cells1[8], 'Vaibhavi Finance'); // Raised by PM (resolved name), own column
  assert.equal(cells1[9], '2026-06-01'); // Raised On, own column
  assert.equal(cells1[10], '2026-06-10'); // Collect By, own column
  assert.equal(cells1[15], '1'); // Part Payments count
  // No row for the other company's payment.
  assert.ok(!bodyLines.some((l) => l.startsWith('Other Co')));
  // TOTAL row matches PWA's short, un-padded `["TOTAL","","","",t,r,b]` shape, preceded by a blank line.
  const totalIdx = bodyLines.findIndex((l) => l.startsWith('TOTAL'));
  assert.equal(bodyLines[totalIdx - 1], '');
  assert.equal(bodyLines[totalIdx], 'TOTAL,,,,230000,80000,150000');
});

test('FIX-6-05 — role restriction unaffected: only finance/admin can export payment reports', async () => {
  const store = createEnquiryFakeStore({ payments: [soLinkedPayment()] });
  await assert.rejects(
    () => service.exportPendingPaymentsCsv(auth({ role: 'sales' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const csv = await service.exportPendingPaymentsCsv(auth({ role: 'admin' }), store);
  assert.match(csv, /PAYMENTS REPORT/);
});

/* ================= FIX-6-06: exportReceiptsCsv ordering ================= */

test('FIX-6-06 — exportReceiptsCsv preserves raw insertion order (PWA dlReceipts has no sort); a newer-dated entry inserted first stays first', async () => {
  const store = createEnquiryFakeStore({
    payments: [
      soLinkedPayment({
        id: 'pay1', salesOrderId: 'so1', milestoneIndex: 0,
        // Insertion order: pp-newer (2026-06-20) THEN pp-older (2026-01-05) — a newest-first
        // sort would reverse this; PWA's dlReceipts has no `.sort()`, so the fix must not either.
        partPayments: [
          { id: 'pp-newer', amount: 10000, date: new Date('2026-06-20'), mode: 'UPI', recordedByUserId: 'u1', reference: 'REF-NEW' },
          { id: 'pp-older', amount: 20000, date: new Date('2026-01-05'), mode: 'Cash', recordedByUserId: 'u1', reference: 'REF-OLD' },
        ],
      }),
    ],
  });
  const csv = await service.exportReceiptsCsv(auth(), store);
  const bodyLines = csv.split('\n').slice(3); // title, blank, header
  const idxNew = bodyLines.findIndex((l) => l.includes('REF-NEW'));
  const idxOld = bodyLines.findIndex((l) => l.includes('REF-OLD'));
  assert.ok(idxNew >= 0 && idxOld >= 0);
  assert.ok(idxNew < idxOld, 'insertion order must be preserved: the newer-dated but first-inserted entry comes first, proving there is no newest-first sort');
});

test('FIX-6-06 — a second Payment record inserted after the first keeps its receipts after the first Payment\'s receipts (outer insertion order, across payments)', async () => {
  const store = createEnquiryFakeStore({
    payments: [
      soLinkedPayment({ id: 'pay1', partPayments: [{ id: 'ppA', amount: 1000, date: new Date('2026-01-01'), mode: 'Cash', recordedByUserId: 'u1', reference: 'FIRST-PAYMENT-ROW' }] }),
      { id: 'pay2', companyId: 'co1', projectOrReference: 'Second Job', personName: 'Y', amount: 2000, status: 'Pending', salesOrderId: null, partPayments: [{ id: 'ppB', amount: 2000, date: new Date('2026-12-01'), mode: 'Cash', recordedByUserId: 'u1', reference: 'SECOND-PAYMENT-ROW' }] },
    ],
  });
  const csv = await service.exportReceiptsCsv(auth(), store);
  const idxFirst = csv.indexOf('FIRST-PAYMENT-ROW');
  const idxSecond = csv.indexOf('SECOND-PAYMENT-ROW');
  assert.ok(idxFirst >= 0 && idxFirst < idxSecond, 'even though the second payment\'s receipt is dated much later, it must still come after the first payment\'s receipt (array insertion order, not date order)');
});
