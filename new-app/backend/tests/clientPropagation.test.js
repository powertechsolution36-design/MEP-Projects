'use strict';

/**
 * Owner request (18 Nov 2026): "In admin, in client if I change client name
 * or address it should change the name, address or any information it
 * should change the name everywhere in AMC/PM, Sales order, Payment,
 * Projects and Quotation."
 *
 * Every one of those records carries the customer's details as somebody
 * typed them, so until now a client renamed on the Clients screen stayed
 * renamed only there.
 *
 * The two rules that make the correction safe are what most of these tests
 * are about: a field is rewritten ONLY where it still holds the old value,
 * and nothing that has left the office is rewritten at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/clientService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Suhas Admin', ...o });

const OLD = 'Intervalve Poonawalla Pvt Ltd';
const NEW = 'Intervalve Poonawalla Private Limited';
const OLD_PHONE = '9820011223';
const NEW_PHONE = '9820099887';
const OLD_ADDR = 'Undri, Pune';
const NEW_ADDR = 'Hadapsar, Pune 411028';

/** A company whose records all carry the client's OLD details. */
function world(extra = {}) {
  return createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
    contracts: [{
      id: 'ct1', companyId: 'co1', customer: OLD, phone: OLD_PHONE,
      email: 'old@example.com', site: OLD_ADDR, category: 'AMC', amcType: 'Quarterly',
      startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), contacts: [],
    }],
    salesOrders: [{
      id: 'so1', companyId: 'co1', orderNumber: 1, projectName: OLD, siteAddress: OLD_ADDR,
      division: 'HVAC', contacts: [{ name: OLD, designation: 'Owner', phone: OLD_PHONE }],
    }],
    projects: [{
      id: 'pr1', companyId: 'co1', salesOrderId: 'so1', division: 'HVAC',
      name: OLD, customer: OLD, stage: 'Design', status: 'Active',
    }],
    quotations: [{
      id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', division: 'HVAC',
      status: 'Draft', customerName: OLD, customerPhone: OLD_PHONE,
      customerAddress: OLD_ADDR, customerEmail: 'old@example.com', customerGst: 'GST-1',
    }],
    payments: [{
      id: 'pm1', companyId: 'co1', projectOrReference: 'Site work', personName: OLD,
      phone: OLD_PHONE, amount: 1000, status: 'Pending',
    }],
    serviceCalls: [{
      id: 'sc1', companyId: 'co1', complaintNumber: 1, type: 'Complaint',
      customer: OLD, phone: OLD_PHONE, site: OLD_ADDR, status: 'Registered',
    }],
    ...extra,
  });
}

async function makeClient(s, over = {}) {
  return service.createClient({
    companyName: OLD, clientName: 'Mr Shah', phone: OLD_PHONE,
    address: OLD_ADDR, email: 'old@example.com', gst: 'GST-1', ...over,
  }, auth(), s);
}

test('renaming a client renames them on every record that still said the old name', async () => {
  const s = world();
  const c = await makeClient(s);
  const saved = await service.updateClient(c.id, { companyName: NEW }, auth(), s);

  assert.deepEqual(saved.propagated.changed, ['name']);
  assert.equal((await s.contractRepo.listByCompany('co1'))[0].customer, NEW);
  assert.equal((await s.salesOrderRepo.listByCompany('co1'))[0].projectName, NEW);
  assert.equal((await s.projectRepo.listByCompany('co1'))[0].customer, NEW);
  assert.equal((await s.projectRepo.listByCompany('co1'))[0].name, NEW);
  assert.equal((await s.quotationRepo.listByCompany('co1'))[0].customerName, NEW);
  assert.equal((await s.paymentRepo.listByCompany('co1'))[0].personName, NEW);
  assert.equal((await s.serviceCallRepo.listByCompany('co1'))[0].customer, NEW);
});

test('and the report says what it reached, one line per kind', async () => {
  const s = world();
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.deepEqual(propagated.updated, {
    contracts: 1, salesOrders: 1, projects: 1, quotations: 1, payments: 1, serviceCalls: 1,
  });
  assert.deepEqual(propagated.failed, []);
});

test('a new number follows them too, however it was punctuated', async () => {
  const s = world({
    serviceCalls: [{
      id: 'sc1', companyId: 'co1', complaintNumber: 1, type: 'Complaint',
      customer: OLD, phone: '+91 98200-11223', site: OLD_ADDR, status: 'Registered',
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { phone: NEW_PHONE }, auth(), s);
  assert.equal((await s.serviceCallRepo.listByCompany('co1'))[0].phone, NEW_PHONE);
  assert.equal((await s.contractRepo.listByCompany('co1'))[0].phone, NEW_PHONE);
});

test('a new address follows them where the record held THEIR address', async () => {
  const s = world();
  const c = await makeClient(s);
  await service.updateClient(c.id, { address: NEW_ADDR }, auth(), s);
  assert.equal((await s.quotationRepo.listByCompany('co1'))[0].customerAddress, NEW_ADDR);
  assert.equal((await s.salesOrderRepo.listByCompany('co1'))[0].siteAddress, NEW_ADDR);
  assert.equal((await s.contractRepo.listByCompany('co1'))[0].site, NEW_ADDR);
});

/* ------------------------------------------------------------------ *
 * Rule 1 — only what still holds the old value is replaced
 * ------------------------------------------------------------------ */

test('a site typed for THAT job is never overwritten by the client’s address', async () => {
  const s = world({
    contracts: [{
      id: 'ct1', companyId: 'co1', customer: OLD, phone: OLD_PHONE,
      site: 'Plant 2, Chakan', category: 'AMC', amcType: 'Quarterly',
      startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), contacts: [],
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { address: NEW_ADDR }, auth(), s);
  const ct = (await s.contractRepo.listByCompany('co1'))[0];
  assert.equal(ct.site, 'Plant 2, Chakan', 'a branch site is that job’s, not the client’s');
});

test('a project named for the work keeps its name when the client is renamed', async () => {
  const s = world({
    projects: [{
      id: 'pr1', companyId: 'co1', salesOrderId: 'so1', division: 'HVAC',
      name: 'Undri Phase 2 ducting', customer: OLD, stage: 'Design', status: 'Active',
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  const pr = (await s.projectRepo.listByCompany('co1'))[0];
  assert.equal(pr.name, 'Undri Phase 2 ducting', 'the project is not the customer');
  assert.equal(pr.customer, NEW, 'but the customer on it is');
});

test('spacing and case do not stop a match', async () => {
  const s = world({
    serviceCalls: [{
      id: 'sc1', companyId: 'co1', complaintNumber: 1, type: 'Complaint',
      customer: '  intervalve   poonawalla PVT LTD ', phone: OLD_PHONE,
      site: OLD_ADDR, status: 'Registered',
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal((await s.serviceCallRepo.listByCompany('co1'))[0].customer, NEW);
});

test('another firm’s records are not touched', async () => {
  const s = world({
    serviceCalls: [{
      id: 'sc1', companyId: 'co1', complaintNumber: 1, type: 'Complaint',
      customer: 'Someone Else Entirely', phone: '9000000000', site: 'Kothrud',
      status: 'Registered',
    }],
  });
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal((await s.serviceCallRepo.listByCompany('co1'))[0].customer, 'Someone Else Entirely');
  assert.equal(propagated.updated.serviceCalls, undefined);
});

test('running it twice changes nothing the second time', async () => {
  const s = world();
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  const again = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.deepEqual(again.propagated.changed, [], 'nothing changed, so nothing to carry');
  assert.deepEqual(again.propagated.updated, {});
});

test('clearing a client’s number does not wipe it off their records', async () => {
  const s = world();
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { phone: '' }, auth(), s);
  assert.ok(!propagated.changed.includes('phone'), 'a blank is not a correction');
  assert.equal((await s.contractRepo.listByCompany('co1'))[0].phone, OLD_PHONE);
});

test('editing something no record copies leaves every record alone', async () => {
  const s = world();
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { notes: 'Pays on time' }, auth(), s);
  assert.deepEqual(propagated.changed, []);
  assert.deepEqual(propagated.updated, {});
});

/* ------------------------------------------------------------------ *
 * Rule 2 — what has left the office is never rewritten
 * ------------------------------------------------------------------ */

test('a quotation already sent keeps the name it went out with', async () => {
  const s = world({
    quotations: [{
      id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', division: 'HVAC',
      status: 'Sent', customerName: OLD, customerPhone: OLD_PHONE,
      customerAddress: OLD_ADDR, customerEmail: 'old@example.com', customerGst: 'GST-1',
    }],
  });
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal((await s.quotationRepo.listByCompany('co1'))[0].customerName, OLD);
  assert.equal(propagated.leftAlone.quotations, 1);
  assert.equal(propagated.updated.quotations, undefined);
});

test('an accepted quotation is left alone too, and a draft beside it is not', async () => {
  const s = world({
    quotations: [
      { id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', division: 'HVAC', status: 'Accepted', customerName: OLD },
      { id: 'qt2', companyId: 'co1', quotationNumber: 'QTN-0002', division: 'HVAC', status: 'Draft', customerName: OLD },
    ],
  });
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  const rows = await s.quotationRepo.listByCompany('co1');
  assert.equal(rows.find((r) => r.id === 'qt1').customerName, OLD);
  assert.equal(rows.find((r) => r.id === 'qt2').customerName, NEW);
  assert.equal(propagated.leftAlone.quotations, 1);
  assert.equal(propagated.updated.quotations, 1);
});

test('a payment already collected keeps its wording', async () => {
  const s = world({
    payments: [{
      id: 'pm1', companyId: 'co1', projectOrReference: 'Site work', personName: OLD,
      phone: OLD_PHONE, amount: 1000, status: 'Received',
    }],
  });
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal((await s.paymentRepo.listByCompany('co1'))[0].personName, OLD);
  assert.equal(propagated.leftAlone.payments, 1);
});

test('a payment part-collected is history too', async () => {
  const s = world({
    payments: [{
      id: 'pm1', companyId: 'co1', projectOrReference: 'Site work', personName: OLD,
      phone: OLD_PHONE, amount: 1000, status: 'Pending',
      partPayments: [{ id: 'p1', amount: 400, paidOn: new Date('2026-11-01') }],
    }],
  });
  const c = await makeClient(s);
  const { propagated } = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal((await s.paymentRepo.listByCompany('co1'))[0].personName, OLD);
  assert.equal(propagated.leftAlone.payments, 1);
});

/* ------------------------------------------------------------------ *
 * The people on a record follow the client's people
 * ------------------------------------------------------------------ */

test('a person on a sales order is renamed with the client they are', async () => {
  const s = world();
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW, phone: NEW_PHONE }, auth(), s);
  const so = (await s.salesOrderRepo.listByCompany('co1'))[0];
  assert.equal(so.contacts[0].name, NEW);
  assert.equal(so.contacts[0].phone, NEW_PHONE);
  assert.equal(so.contacts[0].designation, 'Owner', 'what they do there is untouched');
});

test('a different person on the record is left as they are', async () => {
  const s = world({
    salesOrders: [{
      id: 'so1', companyId: 'co1', orderNumber: 1, projectName: OLD, siteAddress: OLD_ADDR,
      division: 'HVAC',
      contacts: [{ name: 'Mr Patil', designation: 'Maintenance', phone: '9820044556' }],
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW, phone: NEW_PHONE }, auth(), s);
  const so = (await s.salesOrderRepo.listByCompany('co1'))[0];
  assert.equal(so.contacts[0].name, 'Mr Patil');
  assert.equal(so.contacts[0].phone, '9820044556');
});

/* ------------------------------------------------------------------ *
 * It never turns a saved edit into an error
 * ------------------------------------------------------------------ */

test('a sweep that fails is reported, and the client is still saved', async () => {
  const s = world();
  const c = await makeClient(s);
  s.contractRepo.listByCompany = async () => { throw new Error('database away'); };
  const saved = await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  assert.equal(saved.companyName, NEW, 'the client edit itself stands');
  assert.deepEqual(saved.propagated.failed.map((f) => f.kind), ['contracts']);
  assert.equal(saved.propagated.updated.quotations, 1, 'the other kinds still ran');
});

/* ------------------------------------------------------------------ *
 * What they used to be called still finds them
 * ------------------------------------------------------------------ */

test('a document left with the old name is still theirs after the rename', async () => {
  const s = world({
    quotations: [{
      id: 'qt1', companyId: 'co1', quotationNumber: 'QTN-0001', division: 'HVAC',
      status: 'Sent', customerName: OLD, customerPhone: '',
    }],
  });
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);

  // The quotation still says the old name, on purpose. It must not fall off
  // their page because of that.
  const after = await service.getClient(c.id, auth(), s);
  assert.ok((after.formerNames || []).includes('intervalve poonawalla pvt ltd'));
  const records = await service.getClientRecords(c.id, auth(), s);
  assert.equal((records.quotations || []).length, 1);
  assert.equal(records.quotations[0].matchedOn, 'name');
});

test('an old number keeps finding them too', async () => {
  const s = world();
  const c = await makeClient(s);
  await service.updateClient(c.id, { phone: NEW_PHONE }, auth(), s);
  const after = await service.getClient(c.id, auth(), s);
  assert.ok((after.formerPhones || []).includes('9820011223'));
});

test('renaming twice keeps both old names, and never the same one twice', async () => {
  const s = world();
  const c = await makeClient(s);
  await service.updateClient(c.id, { companyName: 'Middlename Ltd' }, auth(), s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  await service.updateClient(c.id, { companyName: NEW }, auth(), s);
  const after = await service.getClient(c.id, auth(), s);
  const names = after.formerNames || [];
  assert.ok(names.includes('intervalve poonawalla pvt ltd'));
  assert.ok(names.includes('middlename ltd'));
  assert.equal(new Set(names).size, names.length, 'no duplicates');
});
