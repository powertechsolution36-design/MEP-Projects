'use strict';

/**
 * Owner request, 14 Nov 2026 — two changes, tested together because both
 * hang off the same enquiry -> quotation -> sales order -> project chain:
 *
 *   1. A Project Manager sees the quotation their site was won on, without
 *      being given the Quotations screens.
 *   2. Sales Team and Project Team are chosen from a list, not typed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const salesOrderService = require('../src/services/salesOrderService');
const projectService = require('../src/services/projectService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const USERS = [
  { id: 'u_admin', companyId: 'co1', name: 'Suhas Admin', username: 'admin', role: 'admin', active: true },
  { id: 'u_sales', companyId: 'co1', name: 'Priya Sales', username: 'sales', role: 'sales', active: true },
  { id: 'u_sales2', companyId: 'co1', name: 'Amol Sales', username: 'amol', role: 'sales', active: false },
  { id: 'u_solar', companyId: 'co1', name: 'Akshay Solar', username: 'akshay', role: 'solar_pm', active: true },
  { id: 'u_hvac', companyId: 'co1', name: 'Vinod HVAC', username: 'vinod', role: 'hvac_pm', active: true },
  { id: 'u_eng', companyId: 'co1', name: 'Israr Engineer', username: 'israr', role: 'engineer', active: true },
  { id: 'u_other', companyId: 'co2', name: 'Someone Else', username: 'other', role: 'sales', active: true },
];

function auth(overrides) {
  return { userId: 'u_sales', companyId: 'co1', role: 'sales', name: 'Priya Sales', ...overrides };
}

/* ---------------- 1. the team dropdowns ---------------- */

test('team candidates: Sales Team offers Admin and Sales, Project Team offers Admin and the division Managers', async () => {
  const store = createEnquiryFakeStore({ users: USERS });
  const { sales, project } = await salesOrderService.listTeamCandidates(auth(), store);

  assert.deepEqual(sales.map((u) => u.name), ['Amol Sales', 'Priya Sales', 'Suhas Admin']);
  assert.deepEqual(project.map((u) => u.name), ['Akshay Solar', 'Suhas Admin', 'Vinod HVAC']);

  // The engineer is in neither list, and no other company's user appears.
  const everyName = [...sales, ...project].map((u) => u.name);
  assert.ok(!everyName.includes('Israr Engineer'));
  assert.ok(!everyName.includes('Someone Else'));
});

test('team candidates: a deactivated user is still offered, and said to be inactive', async () => {
  const store = createEnquiryFakeStore({ users: USERS });
  const { sales } = await salesOrderService.listTeamCandidates(auth(), store);
  const amol = sales.find((u) => u.name === 'Amol Sales');
  assert.equal(amol.active, false);
  assert.equal(sales.find((u) => u.name === 'Priya Sales').active, true);
});

test('team candidates: the roles that fill the form may read the list; the others may not', async () => {
  const store = createEnquiryFakeStore({ users: USERS });
  for (const role of ['sales', 'admin', 'solar_pm']) {
    const r = await salesOrderService.listTeamCandidates(auth({ role }), store);
    assert.ok(Array.isArray(r.sales), `${role} should get the list`);
  }
  for (const role of ['engineer', 'finance', 'hvac_pm', 'inventory', 'service_mgr']) {
    await assert.rejects(
      () => salesOrderService.listTeamCandidates(auth({ role }), store),
      (err) => err.code === 'FORBIDDEN' && err.status === 403,
      `${role} should be refused`
    );
  }
});

/* ---------------- 2. the quotation behind a project ---------------- */

async function siteWonOnAQuotation() {
  const store = createEnquiryFakeStore({
    users: USERS,
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
    quotations: [{
      id: 'qt1',
      companyId: 'co1',
      quotationNumber: 'QTN-0007',
      date: '2026-11-01',
      status: 'Sent',
      division: 'Solar',
      subject: '120 kW rooftop',
      customerName: 'Anita',
      customerPhone: '9000011111',
      grandTotal: 500000,
      enquiryId: null,
      lineItems: [],
    }],
  });
  const quotationService = require('../src/services/quotationService');
  const result = await quotationService.convertQuotationToSalesOrder(
    'qt1',
    { projectName: 'Rooftop Array', totalCost: 500000, paymentMilestones: [] },
    auth(),
    store
  );
  return { store, result };
}

test('project detail carries the quotation the site was won on — number, date, status and value', async () => {
  const { store, result } = await siteWonOnAQuotation();
  const project = await projectService.getProject(result.project.id, auth({ role: 'solar_pm', userId: 'u_solar' }), store);

  assert.ok(project.quotation, 'the project should carry its quotation');
  assert.equal(project.quotation.quotationNumber, 'QTN-0007');
  assert.equal(project.quotation.date, '2026-11-01');
  assert.equal(project.quotation.status, 'Accepted'); // the conversion accepted it
  assert.equal(project.quotation.grandTotal, 500000);
  assert.equal(project.quotation.subject, '120 kW rooftop');
});

test('project detail shows no costing or line items from the quotation — only the summary', async () => {
  const { store, result } = await siteWonOnAQuotation();
  const project = await projectService.getProject(result.project.id, auth({ role: 'solar_pm' }), store);
  const keys = Object.keys(project.quotation).sort();
  assert.deepEqual(keys, ['customerName', 'date', 'division', 'grandTotal', 'id', 'quotationNumber', 'status', 'subject']);
});

test('a walk-in order has no quotation, and the project says so rather than failing', async () => {
  const store = createEnquiryFakeStore({
    users: USERS,
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Standard Solar', isDefault: true, items: [] }],
  });
  const result = await salesOrderService.createSalesOrder(
    { division: 'Solar', projectName: 'Walk-in', contacts: [{ name: 'Anita', phone: '9000011111' }], totalCost: 100, paymentMilestones: [] },
    auth(),
    store
  );
  const project = await projectService.getProject(result.project.id, auth({ role: 'solar_pm' }), store);
  assert.equal(project.quotation, null);
});

test('the quotation PDF link is reached through the project, and refused when there is no quotation', async () => {
  const { store, result } = await siteWonOnAQuotation();
  const link = await projectService.getProjectQuotationPdfLink(result.project.id, auth({ role: 'solar_pm' }), store);
  assert.match(link.pdfToken, /^[0-9a-f]{48}$/);

  // Asking twice gives the same token — it is minted once, not re-rolled.
  const again = await projectService.getProjectQuotationPdfLink(result.project.id, auth({ role: 'solar_pm' }), store);
  assert.equal(again.pdfToken, link.pdfToken);

  // A walk-in project has nothing to open.
  const walkIn = await salesOrderService.createSalesOrder(
    { division: 'Solar', projectName: 'Walk-in', contacts: [{ name: 'Anita', phone: '9000011111' }], totalCost: 100, paymentMilestones: [] },
    auth(),
    store
  );
  await assert.rejects(
    () => projectService.getProjectQuotationPdfLink(walkIn.project.id, auth({ role: 'solar_pm' }), store),
    (err) => err.code === 'NOT_FOUND' && err.status === 404
  );
});

test('another company cannot reach a project, or its quotation, by id', async () => {
  const { store, result } = await siteWonOnAQuotation();
  await assert.rejects(
    () => projectService.getProject(result.project.id, auth({ companyId: 'co2', role: 'admin' }), store),
    (err) => err.status === 404
  );
  await assert.rejects(
    () => projectService.getProjectQuotationPdfLink(result.project.id, auth({ companyId: 'co2', role: 'admin' }), store),
    (err) => err.status === 404
  );
});

/* ---------------- 3. a division Manager's sales orders ----------------
   Owner report (14 Nov 2026): "Solar Manager is able to see HVAC Sales
   order ... can only see Solar Sales order". */

const SO_ROWS = [
  { id: 'so_solar', companyId: 'co1', orderNumber: 1, division: 'Solar', projectName: 'Rooftop', paymentMilestones: [] },
  { id: 'so_hvac', companyId: 'co1', orderNumber: 2, division: 'HVAC', projectName: 'Chiller', paymentMilestones: [] },
  { id: 'so_mep', companyId: 'co1', orderNumber: 3, division: 'MEP', projectName: 'Plumbing', paymentMilestones: [] },
];

function divisionStore() {
  return createEnquiryFakeStore({
    users: USERS,
    salesOrders: SO_ROWS.map((r) => ({ ...r })),
    companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
  });
}

test('the Solar Manager sees only Solar sales orders, never the HVAC ones', async () => {
  const store = divisionStore();
  const list = await salesOrderService.listSalesOrders(auth({ role: 'solar_pm' }), {}, store);
  assert.deepEqual(list.map((o) => o.division), ['Solar']);
  assert.deepEqual(list.map((o) => o.projectName), ['Rooftop']);
});

test('each division Manager sees its own, and admin, sales and finance still see all three', async () => {
  const store = divisionStore();
  for (const [role, division] of [['solar_pm', 'Solar'], ['hvac_pm', 'HVAC'], ['mep_pm', 'MEP']]) {
    const list = await salesOrderService.listSalesOrders(auth({ role }), {}, store);
    assert.deepEqual(list.map((o) => o.division), [division], `${role} should see only ${division}`);
  }
  for (const role of ['admin', 'sales', 'finance']) {
    const list = await salesOrderService.listSalesOrders(auth({ role }), {}, store);
    assert.equal(list.length, 3, `${role} should still see every division`);
  }
});

test('another division’s sales order is not reachable by id either', async () => {
  const store = divisionStore();
  const solar = auth({ role: 'solar_pm' });
  assert.equal((await salesOrderService.getSalesOrder('so_solar', solar, store)).division, 'Solar');
  for (const id of ['so_hvac', 'so_mep']) {
    await assert.rejects(
      () => salesOrderService.getSalesOrder(id, solar, store),
      (err) => err.code === 'NOT_FOUND' && err.status === 404,
      `${id} should be out of reach`
    );
  }
  // Admin is unaffected.
  assert.equal((await salesOrderService.getSalesOrder('so_hvac', auth({ role: 'admin' }), store)).division, 'HVAC');
});

test('the sales order CSV a division Manager exports carries only its own division', async () => {
  const store = divisionStore();
  const csv = await salesOrderService.exportSalesOrdersCsv(auth({ role: 'solar_pm' }), {}, store);
  assert.ok(csv.includes('Rooftop'), 'its own order should be in the export');
  assert.ok(!csv.includes('Chiller'), 'another division should not be');
  assert.ok(!csv.includes('Plumbing'), 'nor the third');
});

test('the Solar Manager may raise an enquiry, a complaint and an AMC client of its own', async () => {
  const enquiryService = require('../src/services/enquiryService');
  const serviceCallService = require('../src/services/serviceCallService');
  const contractService = require('../src/services/contractService');
  const store = divisionStore();
  const solar = auth({ role: 'solar_pm', userId: 'u_solar', name: 'Akshay Solar' });

  const enq = await enquiryService.createEnquiry({ name: 'Solar lead', segment: 'Solar', siteType: 'Commercial' }, solar, store);
  assert.equal(enq.segment, 'Solar');

  const { serviceCall } = await serviceCallService.registerComplaint({ customer: 'Walk-in', complaint: 'Inverter tripping' }, solar, store);
  assert.equal(serviceCall.division, 'Solar');

  const amc = await contractService.createManualContract(
    { site: 'Solar site', customer: 'Solar Client', division: 'Solar', category: 'AMC', amcType: 'Quarterly', start: '2026-11-01', end: '2027-10-31' },
    solar,
    store
  );
  assert.equal(amc.division, 'Solar');
});
