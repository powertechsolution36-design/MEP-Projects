'use strict';

/**
 * REGRESSION GUARD: records written BEFORE this week's work must keep
 * working, untouched, exactly as they are.
 *
 * Between 14 and 17 Nov 2026 several models gained fields: a sales order
 * records the quotation it came from, a checklist point can release a
 * payment milestone, contracts and service calls carry a division, a
 * quotation remembers its lead. Every one of those is absent from the
 * records already in the database — and one of them, SalesOrder.enquiryId,
 * is present but explicitly null on orders raised before 16 Nov.
 *
 * These tests build records in the OLD shapes on purpose and put them
 * through the flows that read and change them. Nothing here should need a
 * migration; if one of these fails, something does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const salesOrderService = require('../src/services/salesOrderService');
const projectService = require('../src/services/projectService');
const contractService = require('../src/services/contractService');
const serviceCallService = require('../src/services/serviceCallService');
const portalService = require('../src/services/portalService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Suhas Admin', ...o });

/* A sales order as it was written BEFORE 14 Nov: enquiryId explicitly null,
   no quotationId key at all. */
const legacySalesOrder = (o) => ({
  id: 'so_old', companyId: 'co1', orderNumber: 7, division: 'HVAC',
  projectName: 'Poonawalla KP87', enquiryId: null,
  contacts: [{ name: 'Mr Shah', phone: '9820011223' }],
  totalCost: 1366200,
  paymentMilestones: [{ description: 'Advance 30%', amount: 409860, received: true }],
  ...o,
});

/* A project as it was: checklist points with none of the new keys. */
const legacyProject = (o) => ({
  id: 'prj_old', companyId: 'co1', salesOrderId: 'so_old', division: 'HVAC',
  name: 'Poonawalla KP87', customer: 'Intervalve', stage: 'Installation', status: 'Ongoing',
  startDate: new Date('2026-02-01'), endDate: new Date('2026-06-30'),
  assignedEngineerIds: [], timelineSet: true, revision: 0,
  executionUpdates: [], deliveryChallans: [], stageHistory: [],
  checklist: [
    { text: 'Material at site', signResponsibility: 'ENGINEER', done: true,
      completedDate: new Date('2026-02-20'), targetDate: new Date('2026-02-18'),
      approval: { approverName: 'Amol', approvedDate: new Date('2026-02-21') }, photos: [], pmSigned: false, remark: '' },
    { text: 'Ducting erection', signResponsibility: 'ENGINEER', done: false,
      completedDate: null, targetDate: new Date('2026-03-10'), approval: null, photos: [], pmSigned: false, remark: '' },
  ],
  ...o,
});

const legacyStore = (extra = {}) => createEnquiryFakeStore({
  salesOrders: [legacySalesOrder()],
  projects: [legacyProject()],
  ...extra,
});

/* ---------------- sales orders ---------------- */

test('an old sales order — enquiryId null, no quotationId — still lists and opens', async () => {
  const store = legacyStore();
  const list = await salesOrderService.listSalesOrders(auth(), {}, store);
  assert.equal(list.length, 1);
  assert.equal(list[0].orderNumber, 7);

  const one = await salesOrderService.getSalesOrder('so_old', auth(), store);
  assert.equal(one.projectName, 'Poonawalla KP87');
  // The shape the screens read is unchanged: both links present, both null.
  assert.equal(one.enquiryId, null);
  assert.equal(one.quotationId, null);
});

test('a new order can still be raised alongside an old one carrying a stored null', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [legacySalesOrder()],
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'HVAC', name: 'Std', isDefault: true, items: [] }],
  });
  const r = await salesOrderService.createSalesOrder(
    { division: 'HVAC', projectName: 'New walk-in', contacts: [{ name: 'A', phone: '9000000000' }], totalCost: 1, paymentMilestones: [] },
    auth({ role: 'sales' }),
    store
  );
  assert.ok(r.salesOrder.id);
  assert.equal((await salesOrderService.listSalesOrders(auth(), {}, store)).length, 2);
});

test('an old order is still editable, and the CSV export still renders it', async () => {
  const store = legacyStore();
  const edited = await salesOrderService.editSalesOrder('so_old', { siteAddress: 'Undri, Pune' }, auth(), store);
  assert.equal(edited.siteAddress, 'Undri, Pune');
  const csv = await salesOrderService.exportSalesOrdersCsv(auth(), {}, store);
  assert.ok(csv.includes('Poonawalla KP87'));
});

/* ---------------- projects and their checklists ---------------- */

test('an old checklist point — no milestone link on it — ticks and approves as before', async () => {
  const store = legacyStore();
  const ticked = await projectService.setChecklistItemDone('prj_old', 1, true, auth(), store);
  assert.equal(ticked.checklist[1].done, true);
  // Nothing was released: there is nothing linked, and no payment exists.
  assert.equal(await store.paymentRepo.findBySalesOrderAndMilestone('co1', 'so_old', 0), null);

  const approved = await projectService.approveChecklistItem('prj_old', 1, {}, auth(), store);
  assert.ok(approved.checklist[1].approval.approverName);
});

test('an old project that completes its checklist is marked Completed, and nothing is asked of Finance', async () => {
  const store = legacyStore();
  await projectService.setChecklistItemDone('prj_old', 1, true, auth(), store);
  const done = await projectService.approveChecklistItem('prj_old', 1, {}, auth(), store);
  assert.equal(done.status, 'Completed');
  assert.equal(done.stage, 'Completed');
  // No point carries a link, so no milestone was raised.
  assert.equal(await store.paymentRepo.findBySalesOrderAndMilestone('co1', 'so_old', 0), null);
});

test('an old project still opens, and reports no quotation behind it', async () => {
  const store = legacyStore();
  const p = await projectService.getProject('prj_old', auth(), store);
  assert.equal(p.salesOrderNumber, 7);
  assert.equal(p.quotation, null, 'an order raised before the quotation flow has none');
  assert.deepEqual(p.paymentMilestones.map((m) => m.description), ['Advance 30%']);
});

/* ---------------- what the client sees ---------------- */

test('a client looking at an old project sees its checklist points, dated as they were', async () => {
  const store = legacyStore();
  const clientAuth = { companyId: 'co1', linkedProjectIds: ['prj_old'] };
  const [listed] = await portalService.listMyProjects(clientAuth, store);
  assert.equal(listed.name, 'Poonawalla KP87');
  // One of two points done: half way, by the project's own checklist.
  assert.equal(listed.progressPercent, 50);

  const detail = await portalService.getMyProject(clientAuth, 'prj_old', store);
  assert.deepEqual(detail.stages.map((s) => s.stage), ['Material at site', 'Ducting erection']);
  assert.deepEqual(detail.stages.map((s) => s.reached), [true, false]);
  assert.equal(new Date(detail.stages[0].at).toISOString().slice(0, 10), '2026-02-20');
  assert.equal(detail.finished, false);
  // And still nothing of ours: no remark, no approver, no target date.
  const body = JSON.stringify(detail);
  for (const secret of ['Amol', 'approverName', 'ENGINEER', 'targetDate', 'pmSigned']) {
    assert.ok(!body.includes(secret), `a client must not be shown ${secret}`);
  }
});

/* ---------------- contracts and service calls without a division ---------------- */

test('an AMC client saved before divisions existed still lists, opens and edits', async () => {
  const store = createEnquiryFakeStore({
    contracts: [{
      id: 'amc_old', companyId: 'co1', customer: 'Gastro Hub', site: 'Pimple Saudagar',
      phone: '9422011111', category: 'AMC', amcType: 'Quarterly',
      startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'),
      amount: 150000, scheduledVisits: [],
    }],
  });
  const list = await contractService.listContracts(auth(), {}, store);
  assert.equal(list.length, 1);
  assert.equal(list[0].division, undefined, 'it genuinely has no division');

  const one = await contractService.getContract('amc_old', auth(), store);
  assert.equal(one.customer, 'Gastro Hub');
});

test('a service call saved before divisions existed still lists and opens', async () => {
  const store = createEnquiryFakeStore({
    serviceCalls: [{
      id: 'svc_old', companyId: 'co1', pscNumber: 1, customer: 'Gastro Hub',
      complaint: 'No cooling', status: 'Registered', registeredDate: new Date('2026-05-01'),
      checklist: [], photos: [],
    }],
  });
  const list = await serviceCallService.listServiceCalls(auth(), {}, store);
  assert.equal(list.length, 1);
  const one = await serviceCallService.getServiceCall('svc_old', auth(), store);
  assert.equal(one.complaint, 'No cooling');
});

/* ---------------- the division Managers' narrower view ---------------- */

test('a division Manager no longer sees another division’s orders — a deliberate change, recorded here', async () => {
  const store = createEnquiryFakeStore({
    salesOrders: [legacySalesOrder({ id: 'so_h', division: 'HVAC' }), legacySalesOrder({ id: 'so_s', orderNumber: 8, division: 'Solar', enquiryId: undefined })],
    companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
  assert.deepEqual((await salesOrderService.listSalesOrders(auth({ role: 'hvac_pm' }), {}, store)).map((o) => o.division), ['HVAC']);
  assert.deepEqual((await salesOrderService.listSalesOrders(auth({ role: 'solar_pm' }), {}, store)).map((o) => o.division), ['Solar']);
  // Admin, sales and finance are untouched.
  assert.equal((await salesOrderService.listSalesOrders(auth(), {}, store)).length, 2);
  assert.equal((await salesOrderService.listSalesOrders(auth({ role: 'finance' }), {}, store)).length, 2);
});
