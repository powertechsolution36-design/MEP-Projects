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
