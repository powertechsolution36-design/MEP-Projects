'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const {
  Company,
  User,
  Enquiry,
  SalesOrder,
  Project,
  ServiceCall,
  Contract,
  Payment,
  Notification,
  ChecklistTemplate,
  InventoryCategory,
  InventoryLocation,
  InventoryItem,
  InventoryIssue,
  InventoryTransaction,
} = require('../src/models');

const oid = () => new Types.ObjectId();

// 2/3. Required fields + types, via validateSync() against an empty/near-empty
// document (no DB connection opened).

test('2/3. required fields are declared as required on the schema', () => {
  // Checked directly on the compiled schema (Model.schema.path(x).isRequired)
  // rather than via validateSync on an empty document, because several
  // required fields also carry a default (e.g. Company.status defaults to
  // 'Trial'), so an empty document would never surface them as *missing* —
  // that does not mean they are not required.
  const cases = [
    { Model: Company, requiredPaths: ['name', 'divisions', 'status', 'since'] },
    { Model: User, requiredPaths: ['name', 'role', 'username', 'passwordHash'] },
    { Model: Enquiry, requiredPaths: ['companyId', 'name', 'segment', 'status'] },
    { Model: SalesOrder, requiredPaths: ['companyId', 'orderNumber', 'division', 'projectName', 'startDate'] },
    { Model: Project, requiredPaths: ['companyId', 'salesOrderId', 'division', 'name', 'stage', 'startDate'] },
    { Model: ServiceCall, requiredPaths: ['companyId', 'complaintNumber', 'type', 'customer', 'registeredDate'] },
    // NOTE: endDate is intentionally NOT required (CONTRACT_DECISION_LOCK.md
    // Decision 8 -- the PWA's manual saveContract() stores a blank `end` with
    // no fallback/validation; Contract.js's endDate is `default: null` so that
    // storage constraint never rejects what the PWA itself accepted -- see
    // Contract.js's own comment and contractService.js's class doc).
    { Model: Contract, requiredPaths: ['companyId', 'site', 'startDate', 'amcType', 'category'] },
    { Model: Payment, requiredPaths: ['companyId', 'projectOrReference', 'personName', 'amount', 'status'] },
    { Model: Notification, requiredPaths: ['companyId', 'text', 'date', 'targetRoles'] },
    { Model: ChecklistTemplate, requiredPaths: ['companyId', 'division', 'name', 'createdByUserId', 'createdDate'] },
    { Model: InventoryCategory, requiredPaths: ['companyId', 'name'] },
    { Model: InventoryLocation, requiredPaths: ['companyId', 'name'] },
    { Model: InventoryItem, requiredPaths: ['companyId', 'name', 'unit', 'returnable'] },
    { Model: InventoryIssue, requiredPaths: ['companyId', 'itemId', 'quantityIssued', 'staffId', 'site', 'fromLocationId', 'date', 'returnable', 'issuedByUserId'] },
    { Model: InventoryTransaction, requiredPaths: ['companyId', 'date', 'type', 'itemId', 'quantity', 'recordedByUserId'] },
  ];

  for (const { Model, requiredPaths } of cases) {
    for (const p of requiredPaths) {
      const schemaPath = Model.schema.path(p);
      assert.ok(schemaPath, `${Model.modelName}.${p} should exist`);
      assert.ok(schemaPath.isRequired, `${Model.modelName}.${p} should be required`);
    }
  }

  // Cross-check with an actually-empty document too, for the fields that have
  // no default and so DO surface as missing:
  const emptyCompany = new Company({});
  const err = emptyCompany.validateSync();
  assert.ok(err, 'an empty Company should fail validation');
  for (const p of ['name', 'divisions', 'since']) {
    assert.ok(err.errors[p], `Company.${p} should be reported missing on an empty document`);
  }
});

test('3. field types are enforced (wrong type rejected by validateSync)', () => {
  const badCompany = new Company({
    name: 'Acme',
    divisions: ['HVAC'],
    status: 'Active',
    since: new Date(),
    subscriptionRate: 'not-a-number', // wrong type
    subscriptionCycle: 'Monthly',
    subscriptionStart: new Date(),
  });
  const err = badCompany.validateSync();
  assert.ok(err && err.errors['subscriptionRate'], 'non-numeric subscriptionRate should fail cast/validation');

  const badPayment = new Payment({
    companyId: oid(),
    projectOrReference: 'X',
    personName: 'Y',
    amount: 'five-hundred', // wrong type
  });
  const perr = badPayment.validateSync();
  assert.ok(perr && perr.errors['amount'], 'non-numeric Payment.amount should fail');
});

// 4. Enums

test('4. enum fields reject out-of-list values', () => {
  const cases = [
    () => new Company({ name: 'A', divisions: ['NotADivision'], status: 'Active', since: new Date() }),
    () => new User({ companyId: oid(), name: 'A', role: 'not_a_role', username: 'u', passwordHash: 'h' }),
    () => new SalesOrder({ companyId: oid(), orderNumber: 1, division: 'Nope', projectName: 'P', startDate: new Date() }),
    () => new Project({ companyId: oid(), salesOrderId: oid(), division: 'Nope', name: 'P', stage: 'S', startDate: new Date() }),
    () => new ServiceCall({ companyId: oid(), complaintNumber: 1, type: 'NotAType', customer: 'C', registeredDate: new Date() }),
    () => new Contract({ companyId: oid(), site: 'S', startDate: new Date(), endDate: new Date(), amcType: 'Weekly', category: 'AMC' }),
    () => new Payment({ companyId: oid(), projectOrReference: 'P', personName: 'X', amount: 1, status: 'NotAStatus' }),
    () => new InventoryItem({ companyId: oid(), name: 'Item', unit: 'Gallons', returnable: false }),
    () => new InventoryIssue({
      companyId: oid(), itemId: oid(), quantityIssued: 1, staffId: oid(), site: 'S',
      fromLocationId: oid(), date: new Date(), returnable: true, issuedByUserId: oid(), status: 'NotAStatus',
    }),
    () => new InventoryTransaction({ companyId: oid(), date: new Date(), type: 'NotAType', itemId: oid(), quantity: 1, recordedByUserId: oid() }),
  ];
  for (const build of cases) {
    const doc = build();
    const err = doc.validateSync();
    assert.ok(err, `${doc.constructor.modelName} should reject an out-of-enum value`);
  }
});

// 5. References — reference (ObjectId ref) fields point at the correct model.

test('5. reference fields declare the correct ref target', () => {
  const refChecks = [
    [User, 'companyId', 'Company'],
    [Enquiry, 'companyId', 'Company'],
    [SalesOrder, 'companyId', 'Company'],
    [SalesOrder, 'enquiryId', 'Enquiry'],
    [Project, 'salesOrderId', 'SalesOrder'],
    [Project, 'assignedEngineerIds', 'User'],
    [ServiceCall, 'engineerId', 'User'],
    [ServiceCall, 'contractId', 'Contract'],
    [Contract, 'originatingProjectId', 'Project'],
    [Payment, 'salesOrderId', 'SalesOrder'],
    [ChecklistTemplate, 'createdByUserId', 'User'],
    [InventoryItem, 'categoryId', 'InventoryCategory'],
    [InventoryIssue, 'itemId', 'InventoryItem'],
    [InventoryIssue, 'staffId', 'User'],
    [InventoryIssue, 'fromLocationId', 'InventoryLocation'],
    [InventoryIssue, 'projectId', 'Project'],
    [InventoryTransaction, 'itemId', 'InventoryItem'],
    [InventoryTransaction, 'fromLocationId', 'InventoryLocation'],
    [InventoryTransaction, 'toLocationId', 'InventoryLocation'],
    [InventoryTransaction, 'recordedByUserId', 'User'],
  ];
  for (const [Model, pathName, expectedRef] of refChecks) {
    const path = Model.schema.path(pathName);
    assert.ok(path, `${Model.modelName}.${pathName} should exist`);
    // Singular ObjectId refs expose it at path.options.ref; array-of-ObjectId
    // refs (e.g. assignedEngineerIds) expose it on the embedded schema type.
    const ref =
      (path.options && path.options.ref) ||
      (path.embeddedSchemaType && path.embeddedSchemaType.options && path.embeddedSchemaType.options.ref);
    assert.equal(ref, expectedRef, `${Model.modelName}.${pathName} should ref "${expectedRef}"`);
  }
});
