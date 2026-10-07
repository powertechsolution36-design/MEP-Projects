'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/inventoryService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u_admin', companyId: 'co1', role: 'admin', name: 'Admin One', ...overrides };
}

function baseStore(seed) {
  return createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Cool Breeze Systems' }],
    users: [
      { id: 'u_admin', companyId: 'co1', name: 'Admin One', role: 'admin' },
      { id: 'u_inv', companyId: 'co1', name: 'Inventory Manager', role: 'inventory' },
      { id: 'u_eng', companyId: 'co1', name: 'Suresh Engineer', role: 'engineer' },
      { id: 'u_pm', companyId: 'co1', name: 'HVAC PM', role: 'hvac_pm' },
      { id: 'u_other_co', companyId: 'co2', name: 'Other Co User', role: 'engineer' },
    ],
    ...seed,
  });
}

async function seedCategoryAndLocation(store, a) {
  const category = await service.createCategory({ name: 'Copper Pipes' }, a, store);
  const location = await service.createLocation({ name: 'Main Godown' }, a, store);
  return { category, location };
}

async function seedItemWithStock(store, a, opts = {}) {
  const { category, location } = await seedCategoryAndLocation(store, a);
  const item = await service.createItem(
    {
      name: opts.name || 'Copper Pipe 1/2"',
      code: opts.code || 'CU-14',
      categoryId: category.id,
      unit: opts.unit || 'Mtr',
      returnable: opts.returnable !== undefined ? opts.returnable : true,
      minimumStockLevel: opts.minimumStockLevel !== undefined ? opts.minimumStockLevel : 50,
      ratePerUnit: opts.ratePerUnit !== undefined ? opts.ratePerUnit : 100,
      openingStock: { [location.id]: opts.openingQty !== undefined ? opts.openingQty : 500 },
    },
    a,
    store
  );
  return { category, location, item };
}

test('createCategory — inventory/admin only, non-empty name required', async () => {
  const store = baseStore();
  const a = auth();
  const cat = await service.createCategory({ name: 'Copper Pipes' }, a, store);
  assert.equal(cat.name, 'Copper Pipes');
  await assert.rejects(() => service.createCategory({ name: '' }, a, store), /required/);
  await assert.rejects(() => service.createCategory({ name: 'X' }, auth({ role: 'sales' }), store), /FORBIDDEN|not permitted/);
});

test('createCategory — no uniqueness enforced (PWA FACT, Decision 1 OPEN)', async () => {
  const store = baseStore();
  const a = auth();
  const c1 = await service.createCategory({ name: 'Copper Pipes' }, a, store);
  const c2 = await service.createCategory({ name: 'Copper Pipes' }, a, store);
  assert.notEqual(c1.id, c2.id);
  assert.equal(c1.name, c2.name);
});

test('deleteCategory — blocked while an item references it, allowed once unreferenced', async () => {
  const store = baseStore();
  const a = auth();
  const { category, item } = await seedItemWithStock(store, a);
  await assert.rejects(() => service.deleteCategory(category.id, a, store), /CATEGORY_IN_USE|Move or delete/);
  await service.deleteItem(item.id, a, store);
  const result = await service.deleteCategory(category.id, a, store);
  assert.equal(result.deleted, true);
});

test('renameCategory — rename only, live-resolved (not snapshotted)', async () => {
  const store = baseStore();
  const a = auth();
  const cat = await service.createCategory({ name: 'Old Name' }, a, store);
  const renamed = await service.renameCategory(cat.id, { name: 'New Name' }, a, store);
  assert.equal(renamed.name, 'New Name');
});

test('createLocation — no uniqueness enforced (Decision 4 OPEN)', async () => {
  const store = baseStore();
  const a = auth();
  const l1 = await service.createLocation({ name: 'Main Godown' }, a, store);
  const l2 = await service.createLocation({ name: 'Main Godown' }, a, store);
  assert.notEqual(l1.id, l2.id);
});

test('deleteLocation — blocked while any item has non-zero stock there', async () => {
  const store = baseStore();
  const a = auth();
  const { location, item } = await seedItemWithStock(store, a);
  await assert.rejects(() => service.deleteLocation(location.id, a, store), /LOCATION_HAS_STOCK|Move the stock/);
  await service.adjustStock(item.id, { type: 'Adjustment', quantity: -500, locationId: location.id }, a, store);
  const result = await service.deleteLocation(location.id, a, store);
  assert.equal(result.deleted, true);
});

test('createItem — code is not required to be unique, even within a company (Decision 7)', async () => {
  const store = baseStore();
  const a = auth();
  const { category } = await seedCategoryAndLocation(store, a);
  const i1 = await service.createItem({ name: 'Item A', code: 'CU-14', categoryId: category.id }, a, store);
  const i2 = await service.createItem({ name: 'Item B', code: 'CU-14', categoryId: category.id }, a, store);
  assert.equal(i1.code, i2.code);
});

test('createItem — opening stock logs an Opening Stock transaction per non-zero location', async () => {
  const store = baseStore();
  const a = auth();
  const { item } = await seedItemWithStock(store, a, { openingQty: 500 });
  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].type, 'Opening Stock');
  assert.equal(txns[0].quantity, 500);
  assert.equal(txns[0].remark, 'opening balance');
});

test('deleteItem — hard, unguarded delete; dangling issue/transaction rows survive', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a);
  await service.issueMaterial({ itemId: item.id, quantity: 10, fromLocationId: location.id, staffId: 'u_eng', site: 'Office / Godown' }, a, store);
  const result = await service.deleteItem(item.id, a, store);
  assert.equal(result.deleted, true);
  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.ok(txns.length > 0);
});

test('updateItem — plain field merge, stock never touched here', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const updated = await service.updateItem(item.id, { ratePerUnit: 250, minimumStockLevel: 10 }, a, store);
  assert.equal(updated.ratePerUnit, 250);
  assert.equal(service.stockAtLocation(updated, location.id), 100);
});

test('stockAtLocation / totQty / stockValue', () => {
  const item = { stockByLocation: { 1: 450, 2: 80, 3: 0 }, ratePerUnit: 10 };
  assert.equal(service.stockAtLocation(item, 1), 450);
  assert.equal(service.stockAtLocation(item, 99), 0);
  assert.equal(service.totQty(item), 530);
  assert.equal(service.stockValue(item), 5300);
});

test('stockState — Out of Stock takes priority; min-falsy items can never be Low Stock', () => {
  assert.equal(service.stockState({ stockByLocation: { a: 0 }, minimumStockLevel: 5 }).label, 'Out of Stock');
  assert.equal(service.stockState({ stockByLocation: { a: 3 }, minimumStockLevel: 5 }).label, 'Low Stock');
  assert.equal(service.stockState({ stockByLocation: { a: 3 }, minimumStockLevel: 0 }).label, 'In Stock');
  assert.equal(service.stockState({ stockByLocation: { a: 100 }, minimumStockLevel: 5 }).label, 'In Stock');
});

test('lowStockItems — combines Low and Out (level > 0)', () => {
  const items = [
    { stockByLocation: { a: 0 }, minimumStockLevel: 5 },
    { stockByLocation: { a: 3 }, minimumStockLevel: 5 },
    { stockByLocation: { a: 100 }, minimumStockLevel: 5 },
  ];
  assert.equal(service.lowStockItems(items).length, 2);
});

test('stock-mutation primitive clamps a location to zero rather than going negative', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 10 });
  const updated = await store.inventoryItemRepo.incrementStockAtLocation('co1', item.id, location.id, -999);
  assert.equal(service.stockAtLocation(updated, location.id), 0);
});

test('issueMaterial — validates against stock at the chosen location, decreases stock exactly once, writes Issue transaction, fires issue notification', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue, item: updatedItem } = await service.issueMaterial(
    { itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' },
    a,
    store
  );
  assert.equal(issue.quantityIssued, 20);
  assert.equal(issue.status, 'Issued');
  assert.equal(issue.returnable, true);
  assert.equal(service.stockAtLocation(updatedItem, location.id), 80);

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  const issueTxn = txns.find((t) => t.type === 'Issue');
  assert.ok(issueTxn);
  assert.equal(issueTxn.quantity, 20);
  assert.equal(issueTxn.fromLocationId, location.id);

  const notifs = store.state.notifications.filter((n) => n.text.includes('Material issued to'));
  assert.equal(notifs.length, 1);
  assert.deepEqual(notifs[0].targetRoles, ['*']);
});

test('issueMaterial — rejects quantity exceeding stock at the SPECIFIC location (not total item stock)', async () => {
  const store = baseStore();
  const a = auth();
  const { item } = await seedItemWithStock(store, a, { openingQty: 100 });
  const otherLocation = await service.createLocation({ name: 'Site Store' }, a, store);
  await assert.rejects(
    () => service.issueMaterial({ itemId: item.id, quantity: 5, fromLocationId: otherLocation.id, staffId: 'u_eng', site: 'Site A' }, a, store),
    /INSUFFICIENT_STOCK|available/
  );
});

test('issueMaterial — low/out-of-stock warning fires only when stock crosses the threshold, to inventory/admin only', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 60, minimumStockLevel: 50 });
  await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const warnings = store.state.notifications.filter((n) => n.text.includes('Low Stock') || n.text.includes('Out of Stock'));
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].targetRoles, ['inventory', 'admin']);
});

test('issueMaterial — admin cannot be an issue recipient (staffList() excludes admin only, Decision 40)', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  await assert.rejects(
    () => service.issueMaterial({ itemId: item.id, quantity: 5, fromLocationId: location.id, staffId: 'u_admin', site: 'Site A' }, a, store),
    /VALIDATION_ERROR|not a valid/
  );
  const result = await service.issueMaterial({ itemId: item.id, quantity: 5, fromLocationId: location.id, staffId: 'u_pm', site: 'Site A' }, a, store);
  assert.equal(result.issue.staffId, 'u_pm');
});

test('issueMaterial — sales/other non-manager roles cannot issue material', async () => {
  const store = baseStore();
  const { item, location } = await seedItemWithStock(store, auth());
  await assert.rejects(
    () => service.issueMaterial({ itemId: item.id, quantity: 5, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, auth({ role: 'sales' }), store),
    /FORBIDDEN|not permitted/
  );
});

test('issBal — max(0, qty - rqty - used), clamped', () => {
  assert.equal(service.issBal({ quantityIssued: 10, quantityReturned: 4, quantityUsed: 3 }), 3);
  assert.equal(service.issBal({ quantityIssued: 10, quantityReturned: 8, quantityUsed: 8 }), 0);
});

test('issStatus — "Returned" IS reachable (OPEN_DECISIONS.md #78 correction)', () => {
  assert.equal(service.issStatus({ quantityIssued: 10, quantityReturned: 10, quantityUsed: 0 }), 'Returned');
});

test('issStatus — "Returned / Used" is emitted with spaces around the slash (OPEN_DECISIONS.md #79)', () => {
  const label = service.issStatus({ quantityIssued: 10, quantityReturned: 5, quantityUsed: 5 });
  assert.equal(label, 'Returned / Used');
  assert.notEqual(label, 'Returned/Used');
});

test('issStatus — Consumed / Partially Returned / Return Requested / Issued, exact', () => {
  assert.equal(service.issStatus({ quantityIssued: 10, quantityReturned: 0, quantityUsed: 10 }), 'Consumed');
  assert.equal(service.issStatus({ quantityIssued: 10, quantityReturned: 3, quantityUsed: 0 }), 'Partially Returned');
  assert.equal(service.issStatus({ quantityIssued: 10, quantityReturned: 0, quantityUsed: 0, returnRequested: true }), 'Return Requested');
  assert.equal(service.issStatus({ quantityIssued: 10, quantityReturned: 0, quantityUsed: 0 }), 'Issued');
});

test('requestReturn — does NOT move stock or write a transaction; only the owning staff member may request', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);

  await assert.rejects(
    () => service.requestReturn(issue.id, { quantity: 5 }, auth({ userId: 'u_pm', role: 'hvac_pm' }), store),
    /FORBIDDEN|only request/
  );

  const before = await store.inventoryItemRepo.findById('co1', item.id);
  const updated = await service.requestReturn(issue.id, { quantity: 5, note: 'not needed' }, auth({ userId: 'u_eng', role: 'engineer' }), store);
  assert.equal(updated.returnRequested, true);
  assert.equal(updated.requestedQuantity, 5);
  assert.equal(updated.status, 'Return Requested');

  const after = await store.inventoryItemRepo.findById('co1', item.id);
  assert.equal(service.stockAtLocation(before, location.id), service.stockAtLocation(after, location.id));
  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.equal(txns.filter((t) => t.type === 'Return').length, 0);

  const notifs = store.state.notifications.filter((n) => n.text.includes('Return request:'));
  assert.equal(notifs.length, 1);
  assert.deepEqual(notifs[0].targetRoles, ['inventory', 'admin']);
});

test('acceptReturn — normal return restores stock, accumulates quantityReturned, writes a Return transaction, notifies everyone', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);

  const { issue: updatedIssue, item: updatedItem } = await service.acceptReturn(issue.id, { quantity: 20 }, a, store);
  assert.equal(updatedIssue.quantityReturned, 20);
  assert.equal(updatedIssue.status, 'Returned');
  assert.equal(service.stockAtLocation(updatedItem, location.id), 100);

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  const returnTxn = txns.find((t) => t.type === 'Return');
  assert.ok(returnTxn);
  assert.equal(returnTxn.toLocationId, location.id);

  const notifs = store.state.notifications.filter((n) => n.text.includes('Material returned by'));
  assert.equal(notifs.length, 1);
  assert.deepEqual(notifs[0].targetRoles, ['*']);
  assert.match(notifs[0].text, /issue closed/);
});

test('acceptReturn — damaged: stock is NOT credited, but quantityReturned still increments; writes Return + Damage / Write-off transactions', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);

  const before = await store.inventoryItemRepo.findById('co1', item.id);
  const { issue: updatedIssue, item: afterItem } = await service.acceptReturn(issue.id, { quantity: 20, damaged: true }, a, store);
  assert.equal(updatedIssue.quantityReturned, 20);
  assert.equal(service.stockAtLocation(afterItem, location.id), service.stockAtLocation(before, location.id));

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.ok(txns.find((t) => t.type === 'Return' && t.remark.startsWith('DAMAGED')));
  assert.ok(txns.find((t) => t.type === 'Damage / Write-off' && t.remark === 'damaged material returned'));
});

test('acceptReturn — accepting a return unconditionally clears any pending return request', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await service.requestReturn(issue.id, { quantity: 10 }, auth({ userId: 'u_eng', role: 'engineer' }), store);

  const { issue: updatedIssue } = await service.acceptReturn(issue.id, { quantity: 20 }, a, store);
  assert.equal(updatedIssue.returnRequested, false);
  assert.equal(updatedIssue.requestedQuantity, 0);
});

test('acceptReturn — markRemainingUsed performs a combined return+mark-used action, writing a Consumed transaction too', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);

  const { issue: updatedIssue } = await service.acceptReturn(issue.id, { quantity: 12, markRemainingUsed: true }, a, store);
  assert.equal(updatedIssue.quantityReturned, 12);
  assert.equal(updatedIssue.quantityUsed, 8);
  assert.equal(service.issBal(updatedIssue), 0);
  assert.equal(updatedIssue.status, 'Returned / Used');

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.ok(txns.find((t) => t.type === 'Consumed' && t.quantity === 8));
});

test('rejectReturn — clears request fields but NOT stock/transaction', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await service.requestReturn(issue.id, { quantity: 10 }, auth({ userId: 'u_eng', role: 'engineer' }), store);

  const before = await store.inventoryItemRepo.findById('co1', item.id);
  const rejected = await service.rejectReturn(issue.id, a, store);
  assert.equal(rejected.returnRequested, false);
  assert.equal(rejected.requestedQuantity, 0);
  assert.equal(rejected.requestNote, null);

  const after = await store.inventoryItemRepo.findById('co1', item.id);
  assert.equal(service.stockAtLocation(before, location.id), service.stockAtLocation(after, location.id));
  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  assert.equal(txns.filter((t) => t.type === 'Return').length, 0);

  const notifs = store.state.notifications.filter((n) => n.text.includes('was not accepted'));
  assert.equal(notifs.length, 1);
  assert.deepEqual(notifs[0].targetRoles, ['*']);
});

test('markUsed — increases quantityUsed, writes a Consumed transaction, and NEVER double-decrements stock', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue, item: afterIssue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const stockAfterIssue = service.stockAtLocation(afterIssue, location.id);
  assert.equal(stockAfterIssue, 80);

  const updatedIssue = await service.markUsed(issue.id, { quantity: 20 }, a, store);
  assert.equal(updatedIssue.quantityUsed, 20);
  assert.equal(updatedIssue.status, 'Consumed');

  const itemAfterMarkUsed = await store.inventoryItemRepo.findById('co1', item.id);
  assert.equal(service.stockAtLocation(itemAfterMarkUsed, location.id), stockAfterIssue);

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  const consumedTxn = txns.find((t) => t.type === 'Consumed');
  assert.ok(consumedTxn);
  assert.equal(consumedTxn.quantity, 20);
});

test('markUsed — no notification is ever fired (Decision 25, explicit DO NOT FIX)', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const notifCountBefore = store.state.notifications.length;
  await service.markUsed(issue.id, { quantity: 20 }, a, store);
  assert.equal(store.state.notifications.length, notifCountBefore);
});

test('markUsed — is manager-only, no self-service path for staff', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await assert.rejects(
    () => service.markUsed(issue.id, { quantity: 5 }, auth({ userId: 'u_eng', role: 'engineer' }), store),
    /FORBIDDEN|not permitted/
  );
});

test('transferStock — moves stock source-to-destination, writes a Transfer transaction, fires NO notification', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const other = await service.createLocation({ name: 'Site Store' }, a, store);

  const notifCountBefore = store.state.notifications.length;
  const updated = await service.transferStock({ itemId: item.id, fromLocationId: location.id, toLocationId: other.id, quantity: 30 }, a, store);
  assert.equal(service.stockAtLocation(updated, location.id), 70);
  assert.equal(service.stockAtLocation(updated, other.id), 30);
  assert.equal(store.state.notifications.length, notifCountBefore);

  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  const transferTxn = txns.find((t) => t.type === 'Transfer');
  assert.ok(transferTxn);
  assert.equal(transferTxn.fromLocationId, location.id);
  assert.equal(transferTxn.toLocationId, other.id);
});

test('transferStock — same-location transfer is explicitly blocked', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  await assert.rejects(
    () => service.transferStock({ itemId: item.id, fromLocationId: location.id, toLocationId: location.id, quantity: 5 }, a, store),
    /must be different/
  );
});

test('transferStock — quantity validated against source-location stock only', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 5 });
  const other = await service.createLocation({ name: 'Site Store' }, a, store);
  await assert.rejects(
    () => service.transferStock({ itemId: item.id, fromLocationId: location.id, toLocationId: other.id, quantity: 100 }, a, store),
    /INSUFFICIENT_STOCK|available/
  );
});

test('adjustStock — Purchase In increases stock and logs the absolute quantity', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const updated = await service.adjustStock(item.id, { type: 'Purchase In', quantity: 50, locationId: location.id, reference: 'PO-1' }, a, store);
  assert.equal(service.stockAtLocation(updated, location.id), 150);
  const txns = await store.inventoryTransactionRepo.listByItem('co1', item.id);
  const txn = txns.find((t) => t.type === 'Purchase In');
  assert.equal(txn.quantity, 50);
  assert.equal(txn.toLocationId, location.id);
  assert.equal(txn.fromLocationId, null);
});

test('adjustStock — Opening Stock is reusable on an existing item (Decision 9)', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const updated = await service.adjustStock(item.id, { type: 'Opening Stock', quantity: 25, locationId: location.id }, a, store);
  assert.equal(service.stockAtLocation(updated, location.id), 125);
});

test('adjustStock — Damage / Write-off decreases stock, and Adjustment can go either direction', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const afterDamage = await service.adjustStock(item.id, { type: 'Damage / Write-off', quantity: -10, locationId: location.id }, a, store);
  assert.equal(service.stockAtLocation(afterDamage, location.id), 90);
  const afterAdjUp = await service.adjustStock(item.id, { type: 'Adjustment', quantity: 5, locationId: location.id }, a, store);
  assert.equal(service.stockAtLocation(afterAdjUp, location.id), 95);
  const afterAdjDown = await service.adjustStock(item.id, { type: 'Adjustment', quantity: -95, locationId: location.id }, a, store);
  assert.equal(service.stockAtLocation(afterAdjDown, location.id), 0);
});

test('adjustStock — a negative result below zero at that location is blocked BEFORE the write', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 10 });
  await assert.rejects(
    () => service.adjustStock(item.id, { type: 'Adjustment', quantity: -50, locationId: location.id }, a, store),
    /INSUFFICIENT_STOCK|below zero/
  );
  const unchanged = await store.inventoryItemRepo.findById('co1', item.id);
  assert.equal(service.stockAtLocation(unchanged, location.id), 10);
});

test('adjustStock — invalid type rejected (exactly 4 types authorized)', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a);
  await assert.rejects(
    () => service.adjustStock(item.id, { type: 'Stock Count', quantity: 5, locationId: location.id }, a, store),
    /Invalid adjustment type/
  );
});

test('authorization — only inventory/admin can manage; other roles are rejected', async () => {
  const store = baseStore();
  const a = auth();
  const { category } = await seedCategoryAndLocation(store, a);
  for (const role of ['sales', 'finance', 'engineer', 'service_eng']) {
    await assert.rejects(() => service.createCategory({ name: 'X' }, auth({ role }), store), /FORBIDDEN|not permitted/);
  }
  await assert.rejects(() => service.renameCategory(category.id, { name: 'Y' }, auth({ role: 'hvac_pm' }), store), /FORBIDDEN|not permitted/);
  const invManager = auth({ userId: 'u_inv', role: 'inventory' });
  const renamed = await service.renameCategory(category.id, { name: 'Y' }, invManager, store);
  assert.equal(renamed.name, 'Y');
});

test('tenant isolation — item/category/location lookups are scoped by companyId, closing the PWA itemById()/catName()/locName() gap', async () => {
  const store = baseStore();
  const a = auth();
  const { item, category, location } = await seedItemWithStock(store, a);

  const otherCoAuth = auth({ userId: 'u_other_co', companyId: 'co2' });
  await assert.rejects(() => service.getItem(item.id, otherCoAuth, store), /not found/i);

  const otherInv = auth({ userId: 'u_other_co', companyId: 'co2', role: 'inventory' });
  await assert.rejects(() => service.renameCategory(category.id, { name: 'X' }, otherInv, store), /not found/i);
  await assert.rejects(() => service.renameLocation(location.id, { name: 'X' }, otherInv, store), /not found/i);

  const found = await service.getItem(item.id, a, store);
  assert.equal(found.id, item.id);
});

test('tenant isolation — issue lookups (accept/reject/mark-used) are company-scoped', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const otherInv = auth({ userId: 'u_other_co', companyId: 'co2', role: 'inventory' });
  await assert.rejects(() => service.acceptReturn(issue.id, { quantity: 5 }, otherInv, store), /not found/i);
  await assert.rejects(() => service.markUsed(issue.id, { quantity: 5 }, otherInv, store), /not found/i);
  await assert.rejects(() => service.rejectReturn(issue.id, otherInv, store), /not found/i);
});

test('canViewStock — dlStock/dlIssued reachable by broader Stock-screen roles, not just inventory/admin (Decision 35)', async () => {
  const store = baseStore();
  const a = auth();
  await seedItemWithStock(store, a, { openingQty: 100 });
  const pmAuth = auth({ userId: 'u_pm', role: 'hvac_pm' });
  const csv = await service.exportStockCsv(pmAuth, store);
  assert.match(csv, /Code,Name,Category,Unit/);
  await assert.rejects(() => service.exportStockCsv(auth({ role: 'sales' }), store), /FORBIDDEN|not permitted/);
});

test('FIX-3.6-01 — exportStockCsv is reachable by hvac_pm/solar_pm/service_mgr (PWA "stock" menu) but NOT mep_pm (PWA mep_pm menu has no "stock" entry)', async () => {
  const store = baseStore();
  const a = auth();
  await seedItemWithStock(store, a, { openingQty: 100 });
  for (const role of ['hvac_pm', 'solar_pm', 'service_mgr']) {
    const csv = await service.exportStockCsv(auth({ userId: `u_${role}`, role }), store);
    assert.match(csv, /Code,Name,Category,Unit/);
  }
  await assert.rejects(
    () => service.exportStockCsv(auth({ userId: 'u_mep', role: 'mep_pm' }), store),
    /FORBIDDEN|not permitted/
  );
});

test('FIX-3.6-01 — exportIssuedCsv (Issued Material report) is admin/inventory only, matching PWA\'s "invissue" menu gate', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  await service.issueMaterial({ itemId: item.id, quantity: 10, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const csv = await service.exportIssuedCsv(a, store);
  assert.match(csv, /Date,Item Code,Item,Type,Qty/);
  for (const role of ['hvac_pm', 'solar_pm', 'mep_pm', 'service_mgr']) {
    await assert.rejects(
      () => service.exportIssuedCsv(auth({ userId: `u_${role}`, role }), store),
      /FORBIDDEN|not permitted/
    );
  }
});

test('canManageInventory — dlTxns/dlReturns are admin/inventory only, narrower than dlStock', async () => {
  const store = baseStore();
  const a = auth();
  await seedItemWithStock(store, a, { openingQty: 100 });
  await assert.rejects(() => service.exportTransactionsCsv(auth({ role: 'hvac_pm' }), store), /FORBIDDEN|not permitted/);
  await assert.rejects(() => service.exportReturnsCsv(auth({ role: 'hvac_pm' }), store), /FORBIDDEN|not permitted/);
  const csv = await service.exportTransactionsCsv(a, store);
  assert.match(csv, /Date,Type,Item/);
});

test('notifications — exactly the 5 documented events fire across a full workflow, Transfer/Mark-Used never notify', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const other = await service.createLocation({ name: 'Site Store' }, a, store);

  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 20, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await service.transferStock({ itemId: item.id, fromLocationId: location.id, toLocationId: other.id, quantity: 5 }, a, store);
  await service.requestReturn(issue.id, { quantity: 10 }, auth({ userId: 'u_eng', role: 'engineer' }), store);
  await service.rejectReturn(issue.id, a, store);
  await service.requestReturn(issue.id, { quantity: 10 }, auth({ userId: 'u_eng', role: 'engineer' }), store);
  await service.acceptReturn(issue.id, { quantity: 10 }, a, store);
  await service.markUsed(issue.id, { quantity: 10 }, a, store);

  const texts = store.state.notifications.map((n) => n.text);
  assert.equal(texts.filter((t) => t.startsWith('Material issued to')).length, 1);
  assert.equal(texts.filter((t) => t.includes('Return request:')).length, 2); // FIX-3.7-01: mailbox-emoji prefix restored
  assert.equal(texts.filter((t) => t.includes('was not accepted')).length, 1);
  assert.equal(texts.filter((t) => t.startsWith('Material returned by')).length, 1);
  assert.equal(texts.length, 5);
});

test('getDashboard — Low Stock is (low-or-out count) - (out count); Material With Staff counts issue rows', async () => {
  const store = baseStore();
  const a = auth();
  const { category, location } = await seedCategoryAndLocation(store, a);
  const lowItem = await service.createItem({ name: 'Low Item', categoryId: category.id, minimumStockLevel: 10, openingStock: { [location.id]: 5 } }, a, store);
  const outItem = await service.createItem({ name: 'Out Item', categoryId: category.id, minimumStockLevel: 10, openingStock: {} }, a, store);
  const okItem = await service.createItem({ name: 'OK Item', categoryId: category.id, minimumStockLevel: 10, openingStock: { [location.id]: 100 } }, a, store);

  await service.issueMaterial({ itemId: okItem.id, quantity: 5, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);

  const dash = await service.getDashboard(a, store);
  assert.equal(dash.outOfStock, 1);
  assert.equal(dash.lowStock, 1);
  assert.equal(dash.materialWithStaff, 1);
  assert.equal(dash.totalItems, 3);
});

test('exportMyMaterialCsv — the callers own issues only', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  await service.issueMaterial({ itemId: item.id, quantity: 10, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await service.issueMaterial({ itemId: item.id, quantity: 5, fromLocationId: location.id, staffId: 'u_pm', site: 'Site B' }, a, store);

  const csv = await service.exportMyMaterialCsv(auth({ userId: 'u_eng', role: 'engineer' }), store);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /Site A/);
});

test('exportReturnsCsv — includes a Return History section built from Return-typed transactions only', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  const { issue } = await service.issueMaterial({ itemId: item.id, quantity: 10, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  await service.acceptReturn(issue.id, { quantity: 10 }, a, store);
  const csv = await service.exportReturnsCsv(a, store);
  assert.match(csv, /RETURN HISTORY/);
});

test('listMyMaterial — returns balance/status computed fresh, matched by durable userId', async () => {
  const store = baseStore();
  const a = auth();
  const { item, location } = await seedItemWithStock(store, a, { openingQty: 100 });
  await service.issueMaterial({ itemId: item.id, quantity: 10, fromLocationId: location.id, staffId: 'u_eng', site: 'Site A' }, a, store);
  const mine = await service.listMyMaterial(auth({ userId: 'u_eng', role: 'engineer' }), store);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].balance, 10);
  assert.equal(mine[0].status, 'Issued');
});
