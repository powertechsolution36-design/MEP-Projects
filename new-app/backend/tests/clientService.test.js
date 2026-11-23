'use strict';

/**
 * The client directory (owner request, 16 Nov 2026, recorded call):
 * "add the client ... next time when you add the client's name it should
 * come directly, in the drop down ... on the admin page the client's list
 * should be shown ... I can edit the client there ... the company's name,
 * client's name, client's GST address ... and there should be multiple
 * contact numbers added in it."
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/clientService');
const enquiryService = require('../src/services/enquiryService');
const quotationService = require('../src/services/quotationService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Suhas Admin', ...o });
const store = (seed) => createEnquiryFakeStore({
  companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
  ...seed,
});

test('a client carries a company name, a person, a GST and several contacts', async () => {
  const s = store();
  const c = await service.createClient({
    companyName: 'Intervalve Poonawalla Pvt Ltd',
    clientName: 'Mr Shah',
    designation: 'Owner',
    phone: '9820011223',
    gst: '27AABCU9603R1ZM, Undri, Pune',
    address: 'Undri, Pune',
    email: 'shah@example.com',
    contacts: [
      { name: 'Mr Shah', designation: 'Owner', phone: '9820011223' },
      { name: 'Mr Patil', designation: 'Maintenance In-charge', phone: '9820044556' },
    ],
  }, auth(), s);

  assert.equal(c.companyName, 'Intervalve Poonawalla Pvt Ltd');
  assert.equal(c.clientName, 'Mr Shah');
  assert.equal(c.gst, '27AABCU9603R1ZM, Undri, Pune');
  assert.equal(c.contacts.length, 2);
  assert.equal(c.contacts[1].designation, 'Maintenance In-charge');
  assert.equal(c.normalizedName, 'intervalve poonawalla pvt ltd');
});

test('a client needs a name of some kind', async () => {
  const s = store();
  await assert.rejects(
    () => service.createClient({ phone: '9820011223' }, auth(), s),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  // A person with no company is fine.
  const solo = await service.createClient({ clientName: 'Mr Nemade' }, auth(), s);
  assert.equal(solo.normalizedName, 'mr nemade');
});

test('the list is searched by company, person, number or GST', async () => {
  const s = store();
  await service.createClient({ companyName: 'Gastro Hub', phone: '9422011111', gst: '27AAAAA0000A1Z5' }, auth(), s);
  await service.createClient({
    companyName: 'Moto Central', clientName: 'Mr Rao',
    contacts: [{ name: 'Mr Rao', designation: 'Purchase Manager', phone: '9820044556' }],
  }, auth(), s);

  const byName = await service.listClients(auth(), { search: 'gastro' }, s);
  assert.deepEqual(byName.map((c) => c.companyName), ['Gastro Hub']);

  const byPhone = await service.listClients(auth(), { search: '98200 44556' }, s);
  assert.deepEqual(byPhone.map((c) => c.companyName), ['Moto Central'], 'a contact’s number finds them too');

  const byGst = await service.listClients(auth(), { search: '27AAAAA' }, s);
  assert.deepEqual(byGst.map((c) => c.companyName), ['Gastro Hub']);

  const byDesignation = await service.listClients(auth(), { search: 'purchase manager' }, s);
  assert.deepEqual(byDesignation.map((c) => c.companyName), ['Moto Central']);

  assert.equal((await service.listClients(auth(), {}, s)).length, 2, 'no search lists everyone');
});

test('a client can be edited, and the search name keeps up with a rename', async () => {
  const s = store();
  const c = await service.createClient({ companyName: 'Old Name Ltd' }, auth(), s);
  const renamed = await service.updateClient(c.id, { companyName: 'New Name Ltd', gst: '27ZZZZZ1111Z1Z9' }, auth(), s);
  assert.equal(renamed.companyName, 'New Name Ltd');
  assert.equal(renamed.normalizedName, 'new name ltd');
  assert.equal(renamed.gst, '27ZZZZZ1111Z1Z9');
  assert.deepEqual((await service.listClients(auth(), { search: 'new name' }, s)).map((x) => x.id), [c.id]);
});

test('everyone but the engineers may use the list; only an admin removes from it', async () => {
  const s = store();
  const c = await service.createClient({ companyName: 'Gastro Hub' }, auth(), s);
  for (const role of ['admin', 'sales', 'finance', 'service_mgr', 'inventory', 'hvac_pm', 'solar_pm', 'mep_pm']) {
    assert.ok(Array.isArray(await service.listClients(auth({ role }), {}, s)), `${role} should see the list`);
  }
  for (const role of ['engineer', 'service_eng']) {
    await assert.rejects(
      () => service.listClients(auth({ role }), {}, s),
      (err) => err.code === 'FORBIDDEN',
      `${role} should not`
    );
  }
  await assert.rejects(
    () => service.deleteClient(c.id, auth({ role: 'sales' }), s),
    (err) => err.code === 'FORBIDDEN'
  );
  assert.deepEqual(await service.deleteClient(c.id, auth(), s), { deletedClientId: String(c.id) });
});

test('another company cannot see or open a client', async () => {
  const s = store();
  const c = await service.createClient({ companyName: 'Gastro Hub' }, auth(), s);
  assert.equal((await service.listClients(auth({ companyId: 'co2' }), {}, s)).length, 0);
  await assert.rejects(
    () => service.getClient(c.id, auth({ companyId: 'co2' }), s),
    (err) => err.status === 404
  );
});

/* ---------------- the list fills itself ---------------- */

test('a new enquiry puts its client on the list, with the contacts it was given', async () => {
  const s = store();
  await enquiryService.createEnquiry({
    name: 'Shree Fabricators',
    segment: 'HVAC',
    siteType: 'Factory',
    phone: '9820099887',
    contacts: [{ name: 'Mr Joshi', designation: 'Owner', phone: '9820099887' }],
  }, auth({ role: 'sales' }), s);

  const list = await service.listClients(auth(), {}, s);
  assert.deepEqual(list.map((c) => c.companyName), ['Shree Fabricators']);
  assert.equal(list[0].phone, '9820099887');
  assert.equal(list[0].contacts[0].designation, 'Owner');
  assert.equal(list[0].source, 'enquiry');
});

test('a new quotation puts its customer on the list, GST and all', async () => {
  const s = store();
  await quotationService.createQuotation('co1', {
    division: 'Solar', customerName: 'Rooftop Industries', customerPhone: '9820012345',
    customerGst: '27BBBBB2222B1Z8', customerAddress: 'Hadapsar, Pune',
    equipmentItems: [], accessoriesItems: [],
  }, 'u1', s);

  const list = await service.listClients(auth(), {}, s);
  assert.deepEqual(list.map((c) => c.companyName), ['Rooftop Industries']);
  assert.equal(list[0].gst, '27BBBBB2222B1Z8');
  assert.equal(list[0].source, 'quotation');
});

test('a client already on the list is not duplicated, and details typed elsewhere do not overwrite theirs', async () => {
  const s = store();
  const kept = await service.createClient({
    companyName: 'Shree Fabricators', gst: '27CCCCC3333C1Z7', phone: '9000000000',
  }, auth(), s);

  await enquiryService.createEnquiry({
    name: 'shree   FABRICATORS', // same firm, typed differently
    segment: 'HVAC', siteType: 'Factory', phone: '9999999999',
  }, auth({ role: 'sales' }), s);

  const list = await service.listClients(auth(), {}, s);
  assert.equal(list.length, 1, 'no second copy of the same firm');
  assert.equal(list[0].id, kept.id);
  assert.equal(list[0].gst, '27CCCCC3333C1Z7', 'the GST somebody maintained stands');
  assert.equal(list[0].phone, '9000000000', 'and so does their number');
});

test('a failure to record the client never fails the enquiry that met them', async () => {
  const s = store();
  s.clientRepo.create = async () => { throw new Error('database on fire'); };
  const enquiry = await enquiryService.createEnquiry(
    { name: 'Shree Fabricators', segment: 'HVAC', siteType: 'Factory' },
    auth({ role: 'sales' }),
    s
  );
  assert.ok(enquiry.id, 'the lead is saved regardless');
});

/* ---------------- the AMC clients we already have ---------------- */

test('the AMC / PM clients come in, with their contacts, and running it again adds nothing', async () => {
  const s = store({
    contracts: [
      { id: 'c1', companyId: 'co1', customer: 'Gastro Hub', phone: '9422011111', site: 'Pimple Saudagar', contacts: [{ name: 'Mr Rao', designation: 'Owner', phone: '9422011111' }] },
      { id: 'c2', companyId: 'co1', customer: 'Moto Central', phone: '9422022222', site: 'Navapeth', contacts: [] },
      { id: 'c3', companyId: 'co1', customer: 'Gastro Hub', phone: '9422011111', site: 'Second site', contacts: [] },
      { id: 'c4', companyId: 'co2', customer: 'Another Company', phone: '9422033333', site: 'Elsewhere', contacts: [] },
    ],
  });

  const first = await service.importFromContracts(auth(), s);
  assert.equal(first.added, 2, 'two distinct clients from three of our contracts');
  const list = await service.listClients(auth(), {}, s);
  assert.deepEqual(list.map((c) => c.companyName).sort(), ['Gastro Hub', 'Moto Central']);
  assert.equal(list.find((c) => c.companyName === 'Gastro Hub').contacts[0].name, 'Mr Rao');
  assert.equal(list.find((c) => c.companyName === 'Gastro Hub').address, 'Pimple Saudagar');
  assert.ok(list.every((c) => c.source === 'amc'));

  const again = await service.importFromContracts(auth(), s);
  assert.equal(again.added, 0);
  assert.equal((await service.listClients(auth(), {}, s)).length, 2, 'still two');
});

test('the import leaves a client somebody already maintained exactly as it is', async () => {
  const s = store({
    contracts: [{ id: 'c1', companyId: 'co1', customer: 'Gastro Hub', phone: '9422011111', site: 'Pimple Saudagar', contacts: [] }],
  });
  const mine = await service.createClient({ companyName: 'Gastro Hub', gst: '27DDDDD4444D1Z6' }, auth(), s);
  const r = await service.importFromContracts(auth(), s);
  assert.equal(r.added, 0);
  assert.equal(r.alreadyKnown, 1);
  const list = await service.listClients(auth(), {}, s);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, mine.id);
  assert.equal(list[0].gst, '27DDDDD4444D1Z6');
});

/* ============ Everything we hold on one client (owner request, 17 Nov 2026) ============
   "each client should hold all their data — all service call, all project,
   all quotation", extended to AMC contracts, sales orders and payments.
   None of those records stores a client id, so the history is MATCHED on
   the customer name or the last ten digits of a phone number. */

const CLIENT = {
  id: 'cl1', companyId: 'co1', companyName: 'Intervalve Poonawalla', clientName: 'Mr Shah',
  normalizedName: 'intervalve poonawalla', phone: '98200-11223', gst: '27AAAAA0000A1Z5',
  contacts: [{ name: 'Mrs Rao', designation: 'Purchase', phone: '+91 90000 55555' }],
};

function historyStore(extra = {}) {
  return store({
    clients: [{ ...CLIENT }],
    companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
    ...extra,
  });
}

test('a client gathers the records that carry their name, whatever the spacing or case', async () => {
  const s = historyStore({
    serviceCalls: [
      { id: 'svc1', companyId: 'co1', complaintNumber: 1, customer: 'intervalve   POONAWALLA', status: 'Registered', registeredDate: new Date(), checklist: [], photos: [] },
      { id: 'svc2', companyId: 'co1', complaintNumber: 2, customer: 'Somebody Else', status: 'Registered', registeredDate: new Date(), checklist: [], photos: [] },
    ],
    projects: [
      { id: 'p1', companyId: 'co1', salesOrderId: 'so1', division: 'HVAC', name: 'KP87 AHU', customer: 'Intervalve Poonawalla', stage: 'Planning', status: 'Ongoing', startDate: new Date(), checklist: [], executionUpdates: [], deliveryChallans: [], revision: 0 },
    ],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  assert.deepEqual(out.serviceCalls.map((r) => r.complaintNumber), [1]);
  assert.deepEqual(out.projects.map((r) => r.name), ['KP87 AHU']);
  assert.equal(out.client.companyName, 'Intervalve Poonawalla');
});

test('a record typed under a different name is still found by the phone number', async () => {
  const s = historyStore({
    serviceCalls: [{
      id: 'svc1', companyId: 'co1', complaintNumber: 9, customer: 'Intervalv Poona', // misspelt
      phone: '+91 98200 11223', status: 'Registered', registeredDate: new Date(), checklist: [], photos: [],
    }],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  assert.equal(out.serviceCalls.length, 1);
  assert.equal(out.serviceCalls[0].matchedOn, 'phone');
});

test('one of the client’s contact people is enough to claim a record', async () => {
  const s = historyStore({
    serviceCalls: [{
      id: 'svc1', companyId: 'co1', complaintNumber: 4, customer: 'Mrs Rao',
      status: 'Registered', registeredDate: new Date(), checklist: [], photos: [],
    }],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  assert.equal(out.serviceCalls.length, 1);
  assert.equal(out.serviceCalls[0].matchedOn, 'name');
});

test('a stored clientId wins over any guess, and is reported as such', async () => {
  const s = historyStore({
    quotations: [
      { id: 'q1', companyId: 'co1', quotationNumber: 'QTN-0001', clientId: 'cl1', customerName: 'Renamed Since', status: 'Sent', division: 'HVAC', grandTotal: 1000 },
      { id: 'q2', companyId: 'co1', quotationNumber: 'QTN-0002', customerName: 'Intervalve Poonawalla', status: 'Sent', division: 'HVAC', grandTotal: 2000 },
    ],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  const byNumber = Object.fromEntries(out.quotations.map((r) => [r.quotationNumber, r]));
  assert.equal(byNumber['QTN-0001'].matchedOn, 'client', 'the stored link, even though the name changed');
  assert.equal(byNumber['QTN-0002'].matchedOn, 'name');
});

test('a short or junk phone number never matches', async () => {
  const s = historyStore({
    serviceCalls: [{
      id: 'svc1', companyId: 'co1', complaintNumber: 1, customer: 'Nobody We Know', phone: '1223',
      status: 'Registered', registeredDate: new Date(), checklist: [], photos: [],
    }],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  assert.equal(out.serviceCalls.length, 0);
});

test('all six sections come back, empty where there is nothing', async () => {
  const out = await service.getClientRecords('cl1', auth(), historyStore());
  for (const k of ['serviceCalls', 'projects', 'quotations', 'contracts', 'salesOrders', 'payments']) {
    assert.ok(Array.isArray(out[k]), `${k} should be a list for an admin`);
    assert.equal(out[k].length, 0);
  }
});

test('a section the viewer may not see is null, not an empty list', async () => {
  const s = historyStore({
    serviceCalls: [{ id: 'svc1', companyId: 'co1', complaintNumber: 1, customer: 'Intervalve Poonawalla', status: 'Registered', registeredDate: new Date(), checklist: [], photos: [] }],
  });
  // Sales cannot open the Service register, and never could.
  const out = await service.getClientRecords('cl1', auth({ role: 'sales' }), s);
  assert.equal(out.serviceCalls, null, 'not theirs to see — not merely empty');
  assert.ok(Array.isArray(out.quotations), 'but quotations are');
});

test('this page is no way around the rules: finance sees no service calls here either', async () => {
  const s = historyStore({
    serviceCalls: [{ id: 'svc1', companyId: 'co1', complaintNumber: 1, customer: 'Intervalve Poonawalla', status: 'Registered', registeredDate: new Date(), checklist: [], photos: [] }],
  });
  const out = await service.getClientRecords('cl1', auth({ role: 'finance' }), s);
  assert.equal(out.serviceCalls, null);
});

test('another company cannot open a client, or their history, by id', async () => {
  const s = historyStore();
  await assert.rejects(
    () => service.getClientRecords('cl1', auth({ companyId: 'co2' }), s),
    (err) => err.status === 404
  );
});

test('an engineer is refused the client directory altogether', async () => {
  await assert.rejects(
    () => service.getClientRecords('cl1', auth({ role: 'engineer' }), historyStore()),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('the rows carry what the page shows and nothing more', async () => {
  const s = historyStore({
    quotations: [{
      id: 'q1', companyId: 'co1', quotationNumber: 'QTN-0001', customerName: 'Intervalve Poonawalla',
      status: 'Sent', division: 'HVAC', grandTotal: 500000,
      equipmentItems: [{ description: 'secret costing', supplyRate: 1 }],
      customerGst: '27AAAAA0000A1Z5',
    }],
  });
  const out = await service.getClientRecords('cl1', auth(), s);
  assert.deepEqual(Object.keys(out.quotations[0]).sort(),
    ['date', 'division', 'grandTotal', 'id', 'matchedOn', 'quotationNumber', 'status']);
  assert.ok(!JSON.stringify(out.quotations).includes('secret costing'));
});

/*
 * Owner report (21 Nov 2026): "the client name was Aba walekar and I
 * changed its name to Kavyam Restaurant and it saved as a new record."
 * What had happened is that an AMC record typed under the owner's own name
 * put a SECOND client on the list beside the restaurant already there on
 * the same phone number, so the directory held the customer twice.
 */
test('a record under a different spelling of the name joins the client we already have on that number', async () => {
  const store = createEnquiryFakeStore({
    clients: [{
      id: 'c1', companyId: 'co1', companyName: 'Kavyam Restaurant', clientName: 'Abba walhekar',
      normalizedName: 'kavyam restaurant', phone: '9881738484', formerNames: [], formerPhones: [], active: true,
    }],
  });
  const auth = { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin' };

  // The AMC record was registered under the owner's name, not the firm's.
  const remembered = await service.rememberClient(
    { companyName: 'Aba walekar', phone: '98817 38484', address: 'Rajyog Restaurant' },
    auth,
    store
  );
  assert.equal(String(remembered.id), 'c1', 'the number says it is the same customer');
  assert.equal(store.state.clients.length, 1, 'no second record for the same people');

  // A different customer, with a number of their own, still joins the list.
  const other = await service.rememberClient({ companyName: 'Sai Residency', phone: '9000000001' }, auth, store);
  assert.notEqual(String(other.id), 'c1');
  assert.equal(store.state.clients.length, 2);

  // Somebody with no number at all is not merged into the first client
  // that happens to have none either.
  await service.rememberClient({ companyName: 'Walk-in enquiry' }, auth, store);
  assert.equal(store.state.clients.length, 3);
});

/*
 * Owner request (23 Nov 2026), pointing at the AMC record's own list:
 * "put this option in Client" — and his correction of my wording: "Nana
 * Peth is Address not Site, it is a place in Pune."
 */
test('a client can list its other addresses, and an edit that leaves them out keeps them', async () => {
  const store = createEnquiryFakeStore({ companies: [{ id: 'co1', name: 'Co' }] });
  const auth = { userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin' };

  const made = await service.createClient(
    {
      companyName: 'Kapil Agencies Moto Central',
      clientName: 'Rohit Gupta',
      phone: '9960026900',
      otherAddresses: [
        { address: 'Baner', label: 'Head office' },
        { address: 'Nana Peth' },
        { address: '  ' },
        { address: 'baner' },
      ],
    },
    auth,
    store
  );
  assert.deepEqual(made.otherAddresses.map((x) => x.address), ['Baner', 'Nana Peth'],
    'a blank row is dropped and the same place is kept once');
  assert.equal(made.otherAddresses[0].label, 'Head office');

  // Correcting something else leaves the list alone.
  const edited = await service.updateClient(made.id, { phone: '9960026901' }, auth, store);
  assert.deepEqual(edited.otherAddresses.map((x) => x.address), ['Baner', 'Nana Peth']);

  // Sending the list replaces it.
  const replaced = await service.updateClient(
    made.id, { otherAddresses: [{ address: 'Nana Peth' }, { address: 'Hadapsar' }] }, auth, store
  );
  assert.deepEqual(replaced.otherAddresses.map((x) => x.address), ['Nana Peth', 'Hadapsar']);
});
