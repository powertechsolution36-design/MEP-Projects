'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const {
  User,
  SalesOrder,
  Project,
  ServiceCall,
  Contract,
  Payment,
  InventoryIssue,
  InventoryTransaction,
} = require('../src/models');

const oid = () => new Types.ObjectId();

// 10. SalesOrder payment milestones

test('10. SalesOrder.paymentMilestones preserves description/amount/received, max 5', () => {
  const shape = SalesOrder.schema.path('paymentMilestones');
  assert.ok(shape, 'paymentMilestones should exist');
  const sub = shape.schema;
  for (const f of ['description', 'amount', 'received']) {
    assert.ok(sub.path(f), `paymentMilestones[].${f} should exist`);
  }

  const tooMany = new SalesOrder({
    companyId: oid(),
    orderNumber: 1,
    division: 'HVAC',
    projectName: 'P',
    startDate: new Date(),
    paymentMilestones: Array.from({ length: 6 }, (_, i) => ({ description: `M${i}`, amount: 100, received: false })),
  });
  const err = tooMany.validateSync();
  assert.ok(err && err.errors['paymentMilestones'], 'more than 5 milestones should fail validation');
});

// 11. Payment part-payment ledger structure — every PWA field preserved

test('11. Payment.partPayments preserves every documented part-payment field', () => {
  const shape = Payment.schema.path('partPayments');
  const sub = shape.schema;
  const expected = [
    'amount', 'date', 'mode', 'reference', 'remark',
    'invoiceIssued', 'recordedByUserId', 'editedByUserId', 'editedOn',
  ];
  for (const f of expected) {
    assert.ok(sub.path(f), `partPayments[].${f} should exist`);
  }
  const modeEnum = sub.path('mode').enumValues;
  assert.deepEqual(
    [...modeEnum].sort(),
    ['Bank Transfer/NEFT', 'Cheque', 'UPI', 'Cash', 'RTGS'].sort()
  );
});

// 12. Payment.raisedToFinance structure

test('12. Payment.raisedToFinance preserves raise-to-finance fields', () => {
  const shape = Payment.schema.path('raisedToFinance');
  const sub = shape.schema;
  for (const f of ['raisedByUserId', 'raisedDate', 'collectByDate', 'priority', 'note']) {
    assert.ok(sub.path(f), `raisedToFinance.${f} should exist`);
  }
  assert.deepEqual([...sub.path('priority').enumValues].sort(), ['Normal', 'Urgent'].sort());
});

// 13. ServiceCall chargeable -> Payment relationship fields

test('13. ServiceCall.report carries the chargeable-payment fields (serviceType/amount)', () => {
  const reportShape = ServiceCall.schema.path('report');
  const sub = reportShape.schema;
  assert.ok(sub.path('serviceType'));
  assert.deepEqual(
    [...sub.path('serviceType').enumValues].sort(),
    ['Installation', 'Warranty', 'AMC', 'Chargeable'].sort()
  );
  assert.ok(sub.path('amount'));

  // A completed chargeable report with amount > 0 is documented as the
  // trigger for creating a Payment (service-layer logic, not enforced here) —
  // confirm the schema at least allows this exact shape to be stored.
  const call = new ServiceCall({
    companyId: oid(),
    complaintNumber: 1,
    type: 'Complaint',
    customer: 'Cust',
    registeredDate: new Date(),
    status: 'Completed',
    report: { serviceType: 'Chargeable', amount: 1500 },
  });
  const err = call.validateSync();
  assert.ok(!err, 'a chargeable report should validate cleanly');
});

// 14. Project checklist structure

test('14. Project.checklist preserves every ChecklistExecutionItem field', () => {
  const shape = Project.schema.path('checklist');
  const sub = shape.schema;
  const expected = ['text', 'signResponsibility', 'done', 'completedDate', 'pmSigned', 'remark', 'photos', 'targetDate', 'approval'];
  for (const f of expected) {
    assert.ok(sub.path(f), `checklist[].${f} should exist`);
  }
  assert.deepEqual(
    [...sub.path('signResponsibility').enumValues].sort(),
    ['ENGINEER', 'CLIENT', 'SALES', 'SERVICE'].sort()
  );
  const approvalSub = sub.path('approval').schema;
  for (const f of ['approverName', 'approvedByRole', 'approvedDate', 'approvalRemark', 'signatureImage', 'enteredByUserId']) {
    assert.ok(approvalSub.path(f), `checklist[].approval.${f} should exist`);
  }
  // approverName is free text (NOT a User ref) -- a CLIENT approver is never
  // a system User. enteredByUserId is the durable ref to the staff member
  // who recorded the approval. These are deliberately different fields.
  assert.equal(approvalSub.path('approverName').instance, 'String');
  assert.ok(!approvalSub.path('approvedByUserId'), 'approvedByUserId should no longer exist (split into approverName + enteredByUserId)');
});

// 15. Contract PM schedule structure

test('15. Contract.scheduledVisits preserves month/completedDate, amcType enum matches cadence', () => {
  const shape = Contract.schema.path('scheduledVisits');
  const sub = shape.schema;
  assert.ok(sub.path('month'));
  assert.ok(sub.path('completedDate'));
  assert.deepEqual(
    [...Contract.schema.path('amcType').enumValues].sort(),
    ['Monthly', 'Quarterly', 'Half-Yearly'].sort()
  );
});

// 16. InventoryIssue state-related fields

test('16. InventoryIssue preserves the full balance/state-machine field set', () => {
  const expected = [
    'quantityIssued', 'quantityReturned', 'quantityUsed', 'status',
    'returnRequested', 'requestedQuantity', 'requestedDate', 'requestNote',
  ];
  for (const f of expected) {
    assert.ok(InventoryIssue.schema.path(f), `InventoryIssue.${f} should exist`);
  }
  // Enum value corrected from 'Returned/Used' to 'Returned / Used' per
  // OPEN_DECISIONS.md #79 / INVENTORY_DECISION_LOCK.md section 24
  // Correction 2, to exactly match the PWA's rendered status text
  // (matchTxt() build a spaced string), once Inventory was authorized
  // and implemented.
  assert.deepEqual(
    [...InventoryIssue.schema.path('status').enumValues].sort(),
    ['Issued', 'Return Requested', 'Partially Returned', 'Returned', 'Returned / Used', 'Consumed'].sort()
  );
});

// 17. InventoryTransaction ledger structure

test('17. InventoryTransaction is a complete, append-only ledger record', () => {
  const expected = ['type', 'itemId', 'quantity', 'fromLocationId', 'toLocationId', 'recordedByUserId', 'referenceText', 'remark'];
  for (const f of expected) {
    assert.ok(InventoryTransaction.schema.path(f), `InventoryTransaction.${f} should exist`);
  }
  assert.deepEqual(
    [...InventoryTransaction.schema.path('type').enumValues].sort(),
    ['Opening Stock', 'Purchase In', 'Damage / Write-off', 'Adjustment', 'Issue', 'Return', 'Transfer', 'Consumed'].sort()
  );
  // No update/delete workflow is exposed at the schema/application-policy
  // level: every field is immutable once written (append-only).
  for (const f of ['type', 'itemId', 'quantity', 'fromLocationId', 'toLocationId', 'recordedByUserId', 'referenceText', 'remark']) {
    assert.equal(InventoryTransaction.schema.path(f).options.immutable, true, `InventoryTransaction.${f} should be immutable`);
  }
  // updatedAt is intentionally not tracked for an append-only ledger.
  assert.equal(InventoryTransaction.schema.get('timestamps').updatedAt, false);
});

// 18. User durable references replacing PWA name strings

test('18. durable ObjectId references replace every PWA name-string field', () => {
  assert.equal(Project.schema.path('assignedEngineerIds').embeddedSchemaType.options.ref, 'User');
  assert.equal(ServiceCall.schema.path('engineerId').options.ref, 'User');
  assert.equal(InventoryIssue.schema.path('staffId').options.ref, 'User');
  assert.equal(InventoryIssue.schema.path('issuedByUserId').options.ref, 'User');
  assert.equal(Payment.schema.path('partPayments').schema.path('recordedByUserId').options.ref, 'User');
  assert.equal(Payment.schema.path('partPayments').schema.path('editedByUserId').options.ref, 'User');
  assert.equal(Payment.schema.path('raisedToFinance').schema.path('raisedByUserId').options.ref, 'User');
  assert.equal(Project.schema.path('checklist').schema.path('approval').schema.path('enteredByUserId').options.ref, 'User');
  assert.equal(Project.schema.path('executionUpdates').schema.path('enteredByUserId').options.ref, 'User');
  assert.equal(Project.schema.path('deliveryChallans').schema.path('recordedByUserId').options.ref, 'User');
  assert.equal(InventoryTransaction.schema.path('recordedByUserId').options.ref, 'User');
  // None of these paths are declared as a plain String (which would mean the
  // PWA's name-string reference was carried forward unchanged).
  const shouldBeObjectId = [
    [ServiceCall, 'engineerId'],
    [InventoryIssue, 'staffId'],
    [InventoryTransaction, 'recordedByUserId'],
  ];
  for (const [Model, p] of shouldBeObjectId) {
    assert.equal(Model.schema.path(p).instance, 'ObjectId');
  }
});

// 19. Hashed-password field presence / plaintext password absence

test('19. User has a passwordHash field and no plaintext password field', () => {
  assert.ok(User.schema.path('passwordHash'), 'User.passwordHash should exist');
  assert.equal(User.schema.path('passwordHash').instance, 'String');
  assert.equal(User.schema.path('pw'), undefined, 'User should not carry the PWA plaintext `pw` field');
  assert.equal(User.schema.path('password'), undefined, 'User should not carry a plaintext `password` field');

  const u = new User({ companyId: oid(), name: 'A', role: 'admin', username: 'a', passwordHash: '$2b$...' });
  const err = u.validateSync();
  assert.ok(!err);
});
