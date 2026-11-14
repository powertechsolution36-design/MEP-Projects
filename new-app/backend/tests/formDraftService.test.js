'use strict';

/**
 * Owner request, 14 Nov 2026: "add save as draft option" on the quotation
 * and the sales order.
 *
 * The point of these tests is the promise a draft makes — that nothing has
 * happened yet. A draft takes no number and raises nothing downstream; it is
 * the submit that does all of it, unchanged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/formDraftService');
const quotationService = require('../src/services/quotationService');
const salesOrderService = require('../src/services/salesOrderService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const USERS = [
  { id: 'u_admin', companyId: 'co1', name: 'Suhas Admin', role: 'admin', active: true },
  { id: 'u_sales', companyId: 'co1', name: 'Priya Sales', role: 'sales', active: true },
  { id: 'u_sales2', companyId: 'co1', name: 'Amol Sales', role: 'sales', active: true },
];
const auth = (o) => ({ userId: 'u_sales', companyId: 'co1', role: 'sales', name: 'Priya Sales', ...o });
const store = () => createEnquiryFakeStore({
  users: USERS,
  checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
});

test('a draft saves a half-filled form — no customer, no division, nothing required', async () => {
  const s = store();
  const d = await service.saveDraft(
    { kind: 'quotation', label: '', payload: { form: { subject: 'Rooftop, rest to follow' } } },
    auth(),
    s
  );
  assert.ok(d.id);
  assert.equal(d.kind, 'quotation');
  assert.equal(d.payload.form.subject, 'Rooftop, rest to follow');
  // Nothing about a quotation came into being.
  assert.equal((await s.quotationRepo.listByCompany('co1', {})).length, 0);
});

test('saving a draft twice replaces it rather than piling up copies', async () => {
  const s = store();
  const first = await service.saveDraft({ kind: 'quotation', label: 'A', payload: { form: { subject: 'one' } } }, auth(), s);
  const second = await service.saveDraft({ id: first.id, kind: 'quotation', label: 'B', payload: { form: { subject: 'two' } } }, auth(), s);
  assert.equal(second.id, first.id);
  assert.equal(second.label, 'B');
  assert.equal(second.payload.form.subject, 'two');
  assert.equal((await service.listDrafts('quotation', auth(), s)).length, 1);
});

test('a sales order draft raises no order number, no project, no payments and no notifications', async () => {
  const s = store();
  await service.saveDraft(
    { kind: 'salesOrder', label: 'Rooftop Array', payload: { form: { division: 'Solar', projectName: 'Rooftop Array', totalCost: 500000 } } },
    auth(),
    s
  );
  assert.equal((await s.salesOrderRepo.listByCompany('co1', {})).length, 0);
  assert.equal((await s.projectRepo.listByCompany('co1', {})).length, 0);
  assert.equal((await s.paymentRepo.listByCompany('co1', {})).length, 0);
  assert.equal((await s.notificationRepo.listForRole('co1', 'admin', {})).length, 0);
});

test('finishing a draft is the ordinary submit: everything is raised then, and the draft goes', async () => {
  const s = store();
  const d = await service.saveDraft(
    { kind: 'salesOrder', label: 'Rooftop Array', payload: { form: { division: 'Solar', projectName: 'Rooftop Array' } } },
    auth(),
    s
  );
  const result = await salesOrderService.createSalesOrder(
    {
      division: 'Solar',
      projectName: 'Rooftop Array',
      contacts: [{ name: 'Anita', phone: '9000011111' }],
      totalCost: 500000,
      paymentMilestones: [{ description: 'Advance', amount: 500000 }],
    },
    auth(),
    s
  );
  assert.equal(typeof result.salesOrder.orderNumber, 'number');
  assert.ok(result.project.id);
  assert.equal(result.payments.length, 1);

  await service.deleteDraft(d.id, auth(), s);
  assert.equal((await service.listDrafts('salesOrder', auth(), s)).length, 0);
});

test('an abandoned quotation draft leaves no gap in the numbering', async () => {
  const s = store();
  await service.saveDraft({ kind: 'quotation', label: 'never finished', payload: { form: {} } }, auth(), s);
  const q = await quotationService.createQuotation(
    'co1',
    { division: 'Solar', customerName: 'Anita', equipmentItems: [], accessoriesItems: [] },
    'u_sales',
    s
  );
  assert.equal(q.quotationNumber, 'QTN-0001'); // the draft took no number
});

test('a draft is personal: another sales person cannot see it or open it, but the admin can', async () => {
  const s = store();
  const mine = await service.saveDraft({ kind: 'quotation', label: 'mine', payload: { form: {} } }, auth(), s);

  const other = auth({ userId: 'u_sales2', name: 'Amol Sales' });
  assert.equal((await service.listDrafts('quotation', other, s)).length, 0);
  await assert.rejects(() => service.getDraft(mine.id, other, s), (e) => e.status === 404);
  await assert.rejects(() => service.deleteDraft(mine.id, other, s), (e) => e.status === 404);

  const admin = auth({ userId: 'u_admin', role: 'admin', name: 'Suhas Admin' });
  assert.equal((await service.listDrafts('quotation', admin, s)).length, 1);
  assert.equal((await service.getDraft(mine.id, admin, s)).label, 'mine');
});

test('drafts of one kind do not show up in the other kind’s list', async () => {
  const s = store();
  await service.saveDraft({ kind: 'quotation', label: 'q', payload: { form: {} } }, auth(), s);
  await service.saveDraft({ kind: 'salesOrder', label: 'so', payload: { form: {} } }, auth(), s);
  assert.deepEqual((await service.listDrafts('quotation', auth(), s)).map((d) => d.label), ['q']);
  assert.deepEqual((await service.listDrafts('salesOrder', auth(), s)).map((d) => d.label), ['so']);
});

test('only the roles that may submit the form may keep its drafts', async () => {
  const s = store();
  for (const role of ['admin', 'sales', 'finance']) {
    assert.ok(await service.saveDraft({ kind: 'quotation', label: role, payload: { form: {} } }, auth({ role }), s));
  }
  for (const role of ['engineer', 'inventory', 'service_mgr', 'hvac_pm']) {
    await assert.rejects(
      () => service.saveDraft({ kind: 'quotation', label: 'x', payload: { form: {} } }, auth({ role }), s),
      (e) => e.code === 'FORBIDDEN' && e.status === 403,
      `${role} should not keep quotation drafts`
    );
  }
  // A sales order draft is the sales order's roles, which are not the same.
  assert.ok(await service.saveDraft({ kind: 'salesOrder', label: 'x', payload: { form: {} } }, auth({ role: 'solar_pm' }), s));
  await assert.rejects(
    () => service.saveDraft({ kind: 'salesOrder', label: 'x', payload: { form: {} } }, auth({ role: 'finance' }), s),
    (e) => e.code === 'FORBIDDEN'
  );
});

test('a draft is refused an unknown kind, and a payload that is not a form', async () => {
  const s = store();
  await assert.rejects(
    () => service.saveDraft({ kind: 'invoice', payload: {} }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR'
  );
  for (const payload of [null, undefined, 'a string', [1, 2]]) {
    await assert.rejects(
      () => service.saveDraft({ kind: 'quotation', payload }, auth(), s),
      (e) => e.code === 'VALIDATION_ERROR',
      `payload ${JSON.stringify(payload)} should be refused`
    );
  }
});

test('another company cannot reach a draft by id', async () => {
  const s = store();
  const mine = await service.saveDraft({ kind: 'quotation', label: 'mine', payload: { form: {} } }, auth(), s);
  await assert.rejects(
    () => service.getDraft(mine.id, auth({ companyId: 'co2', role: 'admin', userId: 'u_x' }), s),
    (e) => e.status === 404
  );
});

test('a draft cannot be turned into the other kind of form behind its back', async () => {
  const s = store();
  const q = await service.saveDraft({ kind: 'quotation', label: 'q', payload: { form: {} } }, auth(), s);
  await assert.rejects(
    () => service.saveDraft({ id: q.id, kind: 'salesOrder', label: 'q', payload: { form: {} } }, auth(), s),
    (e) => e.code === 'VALIDATION_ERROR'
  );
});

test('a person keeps at most 25 drafts of a kind; the oldest makes room', async () => {
  const s = store();
  for (let i = 0; i < service.MAX_DRAFTS_PER_KIND + 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.saveDraft({ kind: 'quotation', label: `d${i}`, payload: { form: { i } } }, auth(), s);
  }
  const list = await service.listDrafts('quotation', auth(), s);
  assert.equal(list.length, service.MAX_DRAFTS_PER_KIND);
});
