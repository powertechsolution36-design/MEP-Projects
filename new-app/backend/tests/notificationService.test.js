'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const service = require('../src/services/notificationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'finance', name: 'Fin User', ...overrides };
}

function notif(overrides) {
  return {
    id: 'n1', companyId: 'co1', text: 'Something happened', date: new Date('2026-01-05'),
    targetRoles: ['finance'], readByUserIds: [], ...overrides,
  };
}

/* ================= listing: recipient correctness + tenant scoping ================= */

test('listNotifications — a role sees only notifications targeting its own role or the "*" all-roles marker, scoped to its own company', async () => {
  const store = createEnquiryFakeStore({
    notifications: [
      notif({ id: 'n1', targetRoles: ['finance'] }),
      notif({ id: 'n2', targetRoles: ['admin'] }),
      notif({ id: 'n3', targetRoles: ['*'] }),
      notif({ id: 'n4', companyId: 'co2', targetRoles: ['finance'] }), // other company — must never leak
      notif({ id: 'n5', targetRoles: ['service_mgr', 'finance'] }),
    ],
  });
  const list = await service.listNotifications(auth({ role: 'finance' }), {}, store);
  assert.deepEqual(list.map((n) => n.id).sort(), ['n1', 'n3', 'n5']);

  const adminList = await service.listNotifications(auth({ role: 'admin' }), {}, store);
  assert.deepEqual(adminList.map((n) => n.id).sort(), ['n2', 'n3']);

  const otherCompany = await service.listNotifications(auth({ role: 'finance', companyId: 'co2' }), {}, store);
  assert.deepEqual(otherCompany.map((n) => n.id), ['n4']);
});

test('listNotifications — newest first', async () => {
  const store = createEnquiryFakeStore({
    notifications: [
      notif({ id: 'old', date: new Date('2026-01-01') }),
      notif({ id: 'new', date: new Date('2026-03-01') }),
      notif({ id: 'mid', date: new Date('2026-02-01') }),
    ],
  });
  const list = await service.listNotifications(auth(), {}, store);
  assert.deepEqual(list.map((n) => n.id), ['new', 'mid', 'old']);
});

/* ================= mark read ================= */

test('markNotificationRead — PWA FACT (vNotifs): appends the acting user id to readByUserIds, idempotent, no un-read action exists', async () => {
  const store = createEnquiryFakeStore({ notifications: [notif({ readByUserIds: [] })] });
  const marked = await service.markNotificationRead('n1', auth({ userId: 'u1' }), store);
  assert.deepEqual(marked.readByUserIds, ['u1']);

  // idempotent — marking again does not duplicate
  const markedAgain = await service.markNotificationRead('n1', auth({ userId: 'u1' }), store);
  assert.deepEqual(markedAgain.readByUserIds, ['u1']);

  // a different user marking it read adds their id too (append-only per-user, PWA FACT)
  const secondReader = await service.markNotificationRead('n1', auth({ userId: 'u2' }), store);
  assert.deepEqual(secondReader.readByUserIds.sort(), ['u1', 'u2']);
});

test('markNotificationRead — tenant isolated: cannot mark a different company\'s notification read', async () => {
  const store = createEnquiryFakeStore({ notifications: [notif({ companyId: 'co1' })] });
  await assert.rejects(
    () => service.markNotificationRead('n1', auth({ companyId: 'co2' }), store),
    (err) => err.code === 'NOT_FOUND'
  );
});

/* ================= generic across modules ================= */

test('notificationRepo.create is already called from every business module\'s service (SalesOrder/Project/Contract/ServiceCall/Payment/Inventory) — this module only adds the read side on top, unchanged', () => {
  const servicesDir = path.join(__dirname, '..', 'src', 'services');
  const modules = ['salesOrderCascade.js', 'projectService.js', 'contractService.js', 'serviceCallService.js', 'paymentService.js', 'inventoryService.js'];
  modules.forEach((file) => {
    const src = fs.readFileSync(path.join(servicesDir, file), 'utf8');
    assert.ok(/notificationRepo\.create\(/.test(src), `${file} should already call notificationRepo.create()`);
  });
});

/* ================= Inventory: confirmed absence of Transfer/Mark-Used notifications, preserved ================= */

test('Inventory: transferStock and markUsed have NO notification call — this fix must not add one (PWA-confirmed absence, preserved)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'inventoryService.js'), 'utf8');
  const fnBody = (name) => {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} should exist`);
    const nextFn = src.indexOf('\nasync function ', start + 1);
    return src.slice(start, nextFn === -1 ? src.length : nextFn);
  };
  assert.ok(!/notificationRepo\.create/.test(fnBody('transferStock')), 'transferStock must not create a notification');
  assert.ok(!/notificationRepo\.create/.test(fnBody('markUsed')), 'markUsed must not create a notification');
});


/* ================= FIX-3.7-04: exact-text content-fidelity assertions (Pass 3.7 rows 3, 4, 15, 18, 24, 25) ================= */

test('FIX-3.7-04: exact notification text fidelity for the 6 content-fidelity fixes from Pass 3.7', async () => {
  const fs = require('fs');
  const path = require('path');
  const servicesDir = path.join(__dirname, '..', 'src', 'services');

  // Row 3: Project delay-check — warning emoji + em dash restored (projectService.js)
  const projectSrc = fs.readFileSync(path.join(servicesDir, 'projectService.js'), 'utf8');
  assert.ok(projectSrc.includes('\u26a0 PROJECT DELAYED \u2014 "'), 'delay-check text should keep the PWA warning-emoji + em-dash prefix');

  // Row 15: Inventory low/out-of-stock warning — warning emoji + em dash restored (inventoryService.js)
  const invSrc = fs.readFileSync(path.join(servicesDir, 'inventoryService.js'), 'utf8');
  assert.ok(invSrc.includes('text: `\u26a0 ${state.label}:'), 'low-stock warning text should keep the PWA warning-emoji prefix, not literal "WARNING"');

  // Row 18: Inventory return-request raised — mailbox emoji restored (inventoryService.js)
  assert.ok(invSrc.includes('\u{1F4E5} Return request:'), 'return-request text should keep the PWA mailbox-emoji prefix');

  // Row 4 / 24 / 25: Payment milestone raised / fully received / part received — money() + full clause restored (paymentService.js)
  const paySrc = fs.readFileSync(path.join(servicesDir, 'paymentService.js'), 'utf8');
  assert.ok(paySrc.includes('Payment milestone raised by ${actorAuth.name || actorAuth.role} for'), 'raise-to-finance text should include "by <name>" like PWA\'s doRaise()');
  assert.ok(paySrc.includes('${money(computeBalance(updated))} due'), 'raise-to-finance text should use money() formatting');
  assert.ok(paySrc.includes('. Collect by ${dueByDate || \'\'}.`'), 'raise-to-finance text should restore the trailing "Collect by <date>." clause (FIX-3.7-02)');
  assert.ok(paySrc.includes('Payment fully received: ${money(updated.amount)}'), 'fully-received text should use money() formatting (FIX-3.7-03)');
  assert.ok(paySrc.includes('Part payment received: ${money(amt)} for ${updated.projectOrReference}. Balance ${money(balanceAfter)}.'), 'part-payment text should use money() formatting (FIX-3.7-03)');
});
