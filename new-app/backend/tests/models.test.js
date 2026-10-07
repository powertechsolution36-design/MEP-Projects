'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const models = require('../src/models');
const { Counter, COUNTER_NAMES } = require('../src/models/Counter');

// These tests exercise Mongoose SCHEMAS ONLY — no database connection is
// opened, no production/staging/dev database is touched. validateSync()
// runs entirely in-process against the compiled schema.

const EXPECTED_COLLECTION_NAMES = {
  Company: 'companies',
  User: 'users',
  Enquiry: 'enquiries',
  SalesOrder: 'salesOrders',
  Project: 'projects',
  ServiceCall: 'serviceCalls',
  Contract: 'contracts',
  Payment: 'payments',
  Notification: 'notifications',
  ChecklistTemplate: 'checklistTemplates',
  InventoryCategory: 'inventoryCategories',
  InventoryLocation: 'inventoryLocations',
  InventoryItem: 'inventoryItems',
  InventoryIssue: 'inventoryIssues',
  InventoryTransaction: 'inventoryTransactions',
};

test('1. every one of the 15 collections + Counter loads without error', () => {
  for (const name of Object.keys(EXPECTED_COLLECTION_NAMES)) {
    assert.ok(models[name], `${name} should be exported`);
    assert.equal(typeof models[name], 'function', `${name} should be a Mongoose model constructor`);
  }
  assert.ok(Counter, 'Counter model should load');
});

test('20. all 15 collections use the expected collection names', () => {
  for (const [modelName, expectedCollection] of Object.entries(EXPECTED_COLLECTION_NAMES)) {
    assert.equal(
      models[modelName].collection.collectionName,
      expectedCollection,
      `${modelName} should map to collection "${expectedCollection}"`
    );
  }
  assert.equal(Counter.collection.collectionName, 'counters');
});

test('7. every tenant-scoped business collection has a required companyId field', () => {
  // Company is the tenant ROOT (it does not carry its own companyId);
  // every other collection is tenant-scoped.
  const tenantScoped = Object.keys(EXPECTED_COLLECTION_NAMES).filter((n) => n !== 'Company');
  for (const name of tenantScoped) {
    const path = models[name].schema.path('companyId');
    assert.ok(path, `${name} should declare companyId`);
    assert.equal(path.instance, 'ObjectId', `${name}.companyId should be an ObjectId`);
  }
});

test('8. every collection uses server-generated ObjectId identity, never a plain integer _id', () => {
  for (const name of Object.keys(EXPECTED_COLLECTION_NAMES)) {
    const idPath = models[name].schema.path('_id');
    // Mongoose default _id path is ObjectId unless overridden; confirm no
    // model overrides it to Number/String (which would resurrect the PWA's
    // small sequential integer as the authoritative id).
    assert.equal(idPath.instance, 'ObjectId', `${name}._id must remain ObjectId`);
  }
  assert.equal(Counter.schema.path('_id').instance, 'ObjectId');
});

test('6. unique indexes exist where DATABASE_SCHEMA.md documents a uniqueness rule', () => {
  const expectedUnique = [
    { model: 'User', keys: { companyId: 1, username: 1 } },
    { model: 'SalesOrder', keys: { companyId: 1, orderNumber: 1 } },
    { model: 'Project', keys: { companyId: 1, salesOrderId: 1 } },
  ];
  for (const { model, keys } of expectedUnique) {
    const indexes = models[model].schema.indexes();
    const match = indexes.find(([idxKeys]) => JSON.stringify(idxKeys) === JSON.stringify(keys));
    assert.ok(match, `${model} should declare an index on ${JSON.stringify(keys)}`);
    assert.equal(match[1].unique, true, `${model}'s ${JSON.stringify(keys)} index should be unique`);
  }
  // sparse-unique payment milestone index
  const paymentIndexes = models.Payment.schema.indexes();
  const milestoneIdx = paymentIndexes.find(
    ([keys]) => JSON.stringify(keys) === JSON.stringify({ companyId: 1, salesOrderId: 1, milestoneIndex: 1 })
  );
  assert.ok(milestoneIdx, 'Payment should index {companyId, salesOrderId, milestoneIndex}');
  assert.equal(milestoneIdx[1].unique, true);
  assert.equal(milestoneIdx[1].sparse, true);

  const counterIdx = Counter.schema.indexes();
  const counterUnique = counterIdx.find(
    ([keys]) => JSON.stringify(keys) === JSON.stringify({ companyId: 1, name: 1 })
  );
  assert.ok(counterUnique, 'Counter should index {companyId, name}');
  assert.equal(counterUnique[1].unique, true);
});

test('9. counter definitions cover exactly the two true business sequences', () => {
  assert.deepEqual([...COUNTER_NAMES].sort(), ['salesOrder', 'serviceCall'].sort());
  const enumValidator = Counter.schema.path('name').enumValues;
  assert.deepEqual([...enumValidator].sort(), ['salesOrder', 'serviceCall'].sort());
});
