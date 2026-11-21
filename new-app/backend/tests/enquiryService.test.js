'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/enquiryService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function makeDeps(seed) {
  const store = createEnquiryFakeStore(seed);
  return { store, deps: store };
}

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'sales', ...overrides };
}

test('createEnquiry — sales and admin can create; another role cannot (server-side, not just UI)', async () => {
  const { deps } = makeDeps();

  const enquiry = await service.createEnquiry(
    { name: 'Sneh Resort AC', segment: 'HVAC', phone: '9000000000', estimatedValue: 200000 },
    auth({ role: 'sales' }),
    deps
  );
  assert.equal(enquiry.name, 'Sneh Resort AC');
  assert.equal(enquiry.status, 'Open');
  assert.deepEqual(enquiry.followUpLog, []);
  assert.ok(enquiry.lastReviewDate);

  // Owner decision (29 Oct 2026): admin may raise an Enquiry too.
  const byAdmin = await service.createEnquiry(
    { name: 'Admin raised', segment: 'HVAC' },
    auth({ role: 'admin' }),
    deps
  );
  assert.equal(byAdmin.name, 'Admin raised');
  assert.equal(byAdmin.status, 'Open');

  // The gate is still a gate: a role outside it is refused.
  await assert.rejects(
    () => service.createEnquiry({ name: 'X', segment: 'HVAC' }, auth({ role: 'finance' }), deps),
    (err) => err.code === 'FORBIDDEN' && err.status === 403
  );
});

test('createEnquiry — tenant isolation: companyId always comes from the session, never the body', async () => {
  const { deps } = makeDeps();
  const enquiry = await service.createEnquiry(
    { name: 'X', segment: 'HVAC', companyId: 'someone-elses-company' },
    auth({ companyId: 'co1' }),
    deps
  );
  assert.equal(enquiry.companyId, 'co1');
});

test('createEnquiry — field validation: name and segment required, segment must be valid', async () => {
  const { deps } = makeDeps();
  await assert.rejects(() => service.createEnquiry({ segment: 'HVAC' }, auth(), deps), /Project name is required/);
  await assert.rejects(() => service.createEnquiry({ name: 'X' }, auth(), deps), /Segment is required/);
  await assert.rejects(
    () => service.createEnquiry({ name: 'X', segment: 'NotReal' }, auth(), deps),
    /Segment must be one of/
  );
});

test('editEnquiry — direct edits preserve PWA behavior: no history record, no followUpLog entry (#17 HOLD FOR #3)', async () => {
  const { deps, store } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'Old Name', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });

  const updated = await service.editEnquiry('enq1', { name: 'New Name', remark: 'edited' }, auth(), deps);
  assert.equal(updated.name, 'New Name');
  assert.equal(updated.remark, 'edited');
  assert.deepEqual(updated.followUpLog, []); // still empty — no history entry created
  assert.equal(store.state.enquiries.length, 1); // no shadow/history collection created
});

test('editEnquiry — tenant isolation: cannot edit another company\'s Enquiry', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'other-co', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  await assert.rejects(() => service.editEnquiry('enq1', { name: 'Y' }, auth({ companyId: 'co1' }), deps), /not found/i);
});

test('addFollowUp — preserves exact PWA followUpLog text and date/actionDone/nextAction fields', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });

  const updated = await service.addFollowUp(
    'enq1',
    { actionDone: 'Quotation sent', nextActionDescription: 'Call back', nextActionDate: new Date('2026-10-01') },
    auth(),
    deps
  );
  assert.equal(updated.lastActionDone, 'Quotation sent');
  assert.equal(updated.nextActionDescription, 'Call back');
  assert.equal(updated.followUpLog.length, 1);
  assert.equal(updated.followUpLog[0].text, 'Quotation sent | Next: Call back');

  const updated2 = await service.addFollowUp('enq1', { actionDone: 'Called again' }, auth(), deps);
  assert.equal(updated2.followUpLog[1].text, 'Called again'); // no " | Next:" suffix when nextAction omitted
});

test('addFollowUp — actionDone is required (PWA fact)', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  await assert.rejects(() => service.addFollowUp('enq1', {}, auth(), deps), /Action done is required/);
});

test('markLost — reason is optional; reason+remark combine with " — "; log text matches PWA exactly', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });

  const lostNoReason = await service.markLost('enq1', {}, auth(), deps);
  assert.equal(lostNoReason.status, 'Lost');
  assert.equal(lostNoReason.lostReason, '');
  assert.ok(lostNoReason.lostDate);
  assert.equal(lostNoReason.followUpLog[0].text, 'Marked lost');

  const { deps: deps2 } = makeDeps({
    enquiries: [{ id: 'enq2', companyId: 'co1', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  const lostWithReason = await service.markLost('enq2', { reason: 'Price too high', remark: 'client said so' }, auth(), deps2);
  assert.equal(lostWithReason.lostReason, 'Price too high — client said so');
  assert.equal(lostWithReason.followUpLog[0].text, 'Marked lost — Price too high — client said so');
});

test('reopenEnquiry — #18=A locked: status becomes Open, log appended, lostReason/lostDate NOT cleared', async () => {
  const { deps } = makeDeps({
    enquiries: [
      {
        id: 'enq1',
        companyId: 'co1',
        name: 'X',
        segment: 'HVAC',
        status: 'Lost',
        lostReason: 'Price too high',
        lostDate: new Date('2026-01-01'),
        followUpLog: [{ date: new Date('2026-01-01'), text: 'Marked lost — Price too high' }],
      },
    ],
  });

  const reopened = await service.reopenEnquiry('enq1', auth(), deps);
  assert.equal(reopened.status, 'Open');
  assert.equal(reopened.lostReason, 'Price too high'); // NOT cleared — locked decision #18=A
  assert.ok(reopened.lostDate); // NOT cleared
  assert.equal(reopened.followUpLog.length, 2);
  assert.equal(reopened.followUpLog[1].text, 'Enquiry reopened');
});

test('reopenEnquiry — rejects reopening an Enquiry that is not Lost', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'X', segment: 'HVAC', status: 'Open', followUpLog: [] }],
  });
  await assert.rejects(() => service.reopenEnquiry('enq1', auth(), deps), /Only a Lost Enquiry can be reopened/);
});

test('listEnquiries — excludes Lost by default; includeLost scopes to Lost only; filters match PWA applyEnqFilt', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e1', companyId: 'co1', name: 'Alpha', segment: 'HVAC', siteType: 'Residential', rating: 5, estimatedValue: 100000, status: 'Open', followUpLog: [] },
      { id: 'e2', companyId: 'co1', name: 'Beta', segment: 'Solar', siteType: 'Commercial', rating: 3, estimatedValue: 500000, status: 'Open', followUpLog: [] },
      { id: 'e3', companyId: 'co1', name: 'Gamma', segment: 'HVAC', siteType: 'Residential', rating: 2, estimatedValue: 50000, status: 'Lost', followUpLog: [] },
      { id: 'e4', companyId: 'other-co', name: 'ShouldNotAppear', segment: 'HVAC', status: 'Open', followUpLog: [] },
    ],
  });

  const active = await service.listEnquiries(auth(), {}, deps);
  assert.equal(active.length, 2);
  assert.ok(!active.some((e) => e.status === 'Lost'));
  assert.ok(!active.some((e) => e.companyId === 'other-co'));

  const lost = await service.listEnquiries(auth(), { includeLost: true }, deps);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].id, 'e3');

  const filteredBySegment = await service.listEnquiries(auth(), { filters: { segment: 'Solar' } }, deps);
  assert.equal(filteredBySegment.length, 1);
  assert.equal(filteredBySegment[0].id, 'e2');

  const filteredByValue = await service.listEnquiries(auth(), { filters: { valueMin: 200000 } }, deps);
  assert.equal(filteredByValue.length, 1);
  assert.equal(filteredByValue[0].id, 'e2');

  const filteredByQuery = await service.listEnquiries(auth(), { filters: { q: 'alpha' } }, deps);
  assert.equal(filteredByQuery.length, 1);
  assert.equal(filteredByQuery[0].id, 'e1');
});

test('getFollowUpsDueToday — Open enquiries with nextActionDate <= today only', async () => {
  const yesterday = new Date(Date.now() - 86400000);
  const tomorrow = new Date(Date.now() + 86400000);
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e1', companyId: 'co1', name: 'Due', segment: 'HVAC', status: 'Open', nextActionDate: yesterday, followUpLog: [] },
      { id: 'e2', companyId: 'co1', name: 'NotYet', segment: 'HVAC', status: 'Open', nextActionDate: tomorrow, followUpLog: [] },
      { id: 'e3', companyId: 'co1', name: 'NoDate', segment: 'HVAC', status: 'Open', followUpLog: [] },
      { id: 'e4', companyId: 'co1', name: 'WonWithDueDate', segment: 'HVAC', status: 'Won', nextActionDate: yesterday, followUpLog: [] },
    ],
  });
  const due = await service.getFollowUpsDueToday(auth(), deps);
  assert.equal(due.length, 1);
  assert.equal(due[0].id, 'e1');
});

test('getSegmentSummary — groups by segment and status across the company only', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e1', companyId: 'co1', name: 'A', segment: 'HVAC', estimatedValue: 100, status: 'Open', followUpLog: [] },
      { id: 'e2', companyId: 'co1', name: 'B', segment: 'HVAC', estimatedValue: 200, status: 'Won', followUpLog: [] },
      { id: 'e3', companyId: 'co1', name: 'C', segment: 'Solar', estimatedValue: 300, status: 'Lost', followUpLog: [] },
    ],
  });
  const summary = await service.getSegmentSummary(auth(), deps);
  assert.equal(summary.byStatus.Open, 1);
  assert.equal(summary.byStatus.Won, 1);
  assert.equal(summary.byStatus.Lost, 1);
  const hvac = summary.bySegment.find((s) => s.segment === 'HVAC');
  assert.equal(hvac.count, 2);
  assert.equal(hvac.totalValue, 300);
});

test('exportEnquiriesCsv — exact PWA column order and a TOTAL row', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e1', companyId: 'co1', name: 'Alpha', siteType: 'Residential', capacity: '2TR', phone: '9000000000', referenceSource: 'Referral', segment: 'HVAC', rating: 5, lastActionDone: 'Sent quote', nextActionDescription: 'Follow up', remark: 'ok', estimatedValue: 100000, status: 'Open', followUpLog: [] },
    ],
  });
  const csv = await service.exportEnquiriesCsv(auth(), {}, deps);
  const lines = csv.split('\n');
  assert.equal(
    lines[0],
    'Sr,Project/Address,Site Type,Capacity,Customer Phone,Reference,Segment,Review Date,Rating,Action Done,Next Action Date,Next Action,Remark,Project Value,Status'
  );
  assert.match(lines[1], /Alpha/);
  assert.match(lines[2], /TOTAL,100000/);
});

/* ---- Contacts at the site (owner request, 5 Nov 2026) -----------------
   An enquiry carries more than one person: a name, a designation and a
   number each. The record's single `phone` is still the main number. */

test('createEnquiry — keeps several contacts, each with a name and designation', async () => {
  const { deps } = makeDeps();
  const enquiry = await service.createEnquiry(
    {
      name: 'Sneh Resort AC',
      segment: 'HVAC',
      phone: '9000000000',
      contacts: [
        { name: 'Anil Shah', designation: 'Purchase Manager', phone: '9000000001' },
        { name: 'Vikas Pawar', designation: 'Maintenance', phone: '9000000002' },
        { name: '', designation: '', phone: '' },
      ],
    },
    auth(),
    deps
  );
  assert.equal(enquiry.contacts.length, 2, 'the wholly blank row is dropped, not rejected');
  assert.deepEqual(enquiry.contacts[0], { name: 'Anil Shah', designation: 'Purchase Manager', phone: '9000000001' });
  assert.equal(enquiry.phone, '9000000000', 'the typed main number wins');
});

test('createEnquiry — a blank main number is filled from the first contact who has one', async () => {
  const { deps } = makeDeps();
  const enquiry = await service.createEnquiry(
    {
      name: 'No main number',
      segment: 'HVAC',
      contacts: [{ name: 'Anil Shah', designation: 'Owner', phone: '9000000003' }],
    },
    auth(),
    deps
  );
  assert.equal(enquiry.phone, '9000000003');
});

test('createEnquiry — a contact with a number but no name is refused', async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => service.createEnquiry(
      { name: 'Nameless', segment: 'HVAC', contacts: [{ name: '', designation: 'Purchase', phone: '9000000004' }] },
      auth(),
      deps
    ),
    /Every contact needs a name/
  );
});

test('editEnquiry — contacts can be changed, and leaving them out leaves them alone', async () => {
  const { deps } = makeDeps();
  const enquiry = await service.createEnquiry(
    { name: 'Edit me', segment: 'HVAC', phone: '9000000005', contacts: [{ name: 'Anil Shah', designation: 'Owner', phone: '9000000006' }] },
    auth(),
    deps
  );

  const untouched = await service.editEnquiry(enquiry.id, { capacity: '5 TR' }, auth(), deps);
  assert.equal(untouched.contacts.length, 1);

  const changed = await service.editEnquiry(
    enquiry.id,
    { contacts: [{ name: 'Anil Shah', designation: 'Owner', phone: '9000000006' }, { name: 'Sneha D', designation: 'Accounts', phone: '9000000007' }] },
    auth(),
    deps
  );
  assert.equal(changed.contacts.length, 2);
  assert.equal(changed.contacts[1].designation, 'Accounts');

  const cleared = await service.editEnquiry(enquiry.id, { contacts: [] }, auth(), deps);
  assert.deepEqual(cleared.contacts, []);
});

test('listEnquiries — a lead is found by the name of whoever we deal with there', async () => {
  const { deps } = makeDeps();
  await service.createEnquiry(
    { name: 'Findable site', segment: 'HVAC', contacts: [{ name: 'Rupesh Jadhav', designation: 'Purchase', phone: '9000000008' }] },
    auth(),
    deps
  );
  const found = await service.listEnquiries(auth(), { filters: { q: 'rupesh' } }, deps);
  assert.equal(found.length, 1);
  const none = await service.listEnquiries(auth(), { filters: { q: 'nobody-by-that-name' } }, deps);
  assert.equal(none.length, 0);
});

test('deleteEnquiry — admin only, and refused once the lead became a sales order', async () => {
  const store = createEnquiryFakeStore({
    enquiries: [{ id: 'enq1', companyId: 'co1', name: 'Nashik Textiles', status: 'Open', followUpLog: [] }],
    salesOrders: [],
  });
  const auth = (o) => ({ userId: 'u1', companyId: 'co1', role: 'admin', name: 'Admin', ...o });

  for (const role of ['sales', 'finance', 'hvac_pm', 'engineer']) {
    await assert.rejects(
      () => service.deleteEnquiry('enq1', auth({ role }), store),
      (err) => err.code === 'FORBIDDEN' && err.status === 403,
      `${role} must not delete an enquiry`
    );
  }

  // Converted: the order carries the work, so the lead under it stays.
  store.state.salesOrders.push({ id: 'so1', companyId: 'co1', orderNumber: 1001, enquiryId: 'enq1' });
  await assert.rejects(
    () => service.deleteEnquiry('enq1', auth(), store),
    (err) => err.code === 'VALIDATION_ERROR' && /SO-1001/.test(err.message)
  );

  store.state.salesOrders.length = 0;
  const result = await service.deleteEnquiry('enq1', auth(), store);
  assert.equal(result.deletedEnquiryId, 'enq1');
  assert.equal(store.state.enquiries.length, 0);
});

test('listEnquiries — a Won lead leaves the list and has its own scope (owner request, 20 Nov 2026)', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e_open', companyId: 'co1', name: 'Still chasing', status: 'Open', segment: 'HVAC', followUpLog: [] },
      { id: 'e_lost', companyId: 'co1', name: 'Gone elsewhere', status: 'Lost', segment: 'HVAC', followUpLog: [] },
      { id: 'e_won', companyId: 'co1', name: 'Sangeeta Bungalow', status: 'Won', segment: 'HVAC', followUpLog: [] },
    ],
  });

  const list = await service.listEnquiries(auth(), {}, deps);
  assert.deepEqual(list.map((e) => e.id), ['e_open'], 'the list holds the leads still in play');

  const won = await service.listEnquiries(auth(), { scope: 'won' }, deps);
  assert.deepEqual(won.map((e) => e.id), ['e_won']);

  const lost = await service.listEnquiries(auth(), { scope: 'lost' }, deps);
  assert.deepEqual(lost.map((e) => e.id), ['e_lost']);

  // The old spelling still means the Lost screen, not the whole list.
  const legacy = await service.listEnquiries(auth(), { includeLost: true }, deps);
  assert.deepEqual(legacy.map((e) => e.id), ['e_lost']);
});

/* ===== allocating a lead to a sales person (owner request, 20 Nov 2026) ===== */

test('a sales login sees its own leads and the unallocated ones; admin sees all, with the name', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'mine', companyId: 'co1', name: 'Mine', status: 'Open', segment: 'HVAC', assignedSalesUserId: 'u_sales', followUpLog: [] },
      { id: 'theirs', companyId: 'co1', name: 'Theirs', status: 'Open', segment: 'HVAC', assignedSalesUserId: 'u_other', followUpLog: [] },
      { id: 'nobody', companyId: 'co1', name: 'Nobody', status: 'Open', segment: 'HVAC', assignedSalesUserId: null, followUpLog: [] },
    ],
    users: [
      { id: 'u_sales', companyId: 'co1', name: 'Priya Sales', role: 'sales' },
      { id: 'u_other', companyId: 'co1', name: 'Amol Sales', role: 'sales' },
    ],
  });
  const sales = { userId: 'u_sales', companyId: 'co1', role: 'sales', name: 'Priya Sales' };
  const admin = { userId: 'u_admin', companyId: 'co1', role: 'admin', name: 'Admin' };

  const theirs = await service.listEnquiries(sales, {}, deps);
  assert.deepEqual(theirs.map((e) => e.id).sort(), ['mine', 'nobody'], 'own leads and the unallocated ones');

  const all = await service.listEnquiries(admin, {}, deps);
  assert.equal(all.length, 3);
  assert.equal(all.find((e) => e.id === 'theirs').assignedSalesName, 'Amol Sales');
  assert.equal(all.find((e) => e.id === 'nobody').assignedSalesName, '');

  // Opening somebody else's lead answers not found, as the list implies.
  await assert.rejects(() => service.getEnquiry('theirs', sales, deps), (err) => err.code === 'NOT_FOUND');
  assert.equal((await service.getEnquiry('mine', sales, deps)).assignedSalesName, 'Priya Sales');
});

test('allocating a lead — admin only, to a sales person or an admin, and it can be taken back', async () => {
  const { deps } = makeDeps({
    enquiries: [{ id: 'e1', companyId: 'co1', name: 'Sunny', status: 'Open', segment: 'Solar', followUpLog: [] }],
    users: [
      { id: 'u_sales', companyId: 'co1', name: 'Priya Sales', role: 'sales' },
      { id: 'u_eng', companyId: 'co1', name: 'Kiran Engineer', role: 'engineer' },
    ],
  });
  const admin = { userId: 'u_admin', companyId: 'co1', role: 'admin', name: 'Admin' };

  await assert.rejects(
    () => service.assignEnquirySales('e1', { assignedSalesUserId: 'u_sales' }, { userId: 'u_sales', companyId: 'co1', role: 'sales' }, deps),
    (err) => err.code === 'FORBIDDEN'
  );

  const allocated = await service.assignEnquirySales('e1', { assignedSalesUserId: 'u_sales' }, admin, deps);
  assert.equal(String(allocated.assignedSalesUserId), 'u_sales');

  // An engineer is not somebody a lead is given to.
  await assert.rejects(
    () => service.assignEnquirySales('e1', { assignedSalesUserId: 'u_eng' }, admin, deps),
    (err) => err.code === 'VALIDATION_ERROR'
  );

  const cleared = await service.assignEnquirySales('e1', { assignedSalesUserId: null }, admin, deps);
  assert.equal(cleared.assignedSalesUserId, null);
});

test('won leads carry the quotation and the sales order they turned into (owner request, 21 Nov 2026)', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e_both', companyId: 'co1', name: 'Sayli Khandekar', status: 'Won', segment: 'HVAC', followUpLog: [] },
      { id: 'e_direct', companyId: 'co1', name: 'Walk-in win', status: 'Won', segment: 'HVAC', followUpLog: [] },
      { id: 'e_bare', companyId: 'co1', name: 'Won long ago', status: 'Won', segment: 'HVAC', followUpLog: [] },
    ],
    quotations: [
      { id: 'q_old', companyId: 'co1', quotationNumber: 4, status: 'Rejected', enquiryId: 'e_both', grandTotal: 390000 },
      { id: 'q_new', companyId: 'co1', quotationNumber: 9, status: 'Accepted', enquiryId: 'e_both', grandTotal: 403398 },
    ],
    salesOrders: [
      // Linked through the quotation, the usual route.
      { id: 'so_q', companyId: 'co1', orderNumber: 21, projectName: 'Sangeeta Bungalow', quotationId: 'q_new' },
      // Raised straight from the lead (20 Nov 2026 route).
      { id: 'so_e', companyId: 'co1', orderNumber: 22, projectName: 'Walk-in win', enquiryId: 'e_direct' },
    ],
  });
  const admin = { userId: 'u_admin', companyId: 'co1', role: 'admin', name: 'Admin' };

  const won = await service.listEnquiries(admin, { scope: 'won' }, deps);
  const byId = Object.fromEntries(won.map((e) => [e.id, e]));

  // The newest quotation is the one shown — the accepted one.
  assert.equal(byId.e_both.quotation.quotationNumber, 9);
  assert.equal(byId.e_both.salesOrder.orderNumber, 21, 'found through its quotation');

  assert.equal(byId.e_direct.quotation, null);
  assert.equal(byId.e_direct.salesOrder.orderNumber, 22, 'found through the lead itself');

  assert.equal(byId.e_bare.quotation, null);
  assert.equal(byId.e_bare.salesOrder, null);

  // The Enquiry List pays for none of this.
  const open = await service.listEnquiries(admin, {}, deps);
  assert.ok(open.every((e) => e.quotation === undefined));
});

/*
 * Owner report (21 Nov 2026): "Quotation already created but here not
 * showing that quote", and the decision behind it — "All quotation need to
 * belong to enquiries only". The lead itself now carries them.
 */
test('an enquiry carries the quotations raised from it, newest number first', async () => {
  const { deps } = makeDeps({
    enquiries: [
      { id: 'e1', companyId: 'co1', name: 'Shikrapur Hospital', status: 'Open', segment: 'HVAC', followUpLog: [] },
      { id: 'e2', companyId: 'co1', name: 'Other site', status: 'Open', segment: 'HVAC', followUpLog: [] },
    ],
    quotations: [
      { id: 'q1', companyId: 'co1', enquiryId: 'e1', quotationNumber: 'QTN-0010', division: 'HVAC', status: 'Draft', grandTotal: 1000 },
      { id: 'q2', companyId: 'co1', enquiryId: 'e1', quotationNumber: 'QTN-0012', division: 'HVAC', status: 'Sent', grandTotal: 2000 },
      { id: 'q3', companyId: 'co1', enquiryId: 'e2', quotationNumber: 'QTN-0011', division: 'HVAC', status: 'Draft', grandTotal: 500 },
      { id: 'q4', companyId: 'co1', enquiryId: null, quotationNumber: 'QTN-0013', division: 'HVAC', status: 'Draft', grandTotal: 700 },
    ],
  });
  const admin = { userId: 'u_admin', companyId: 'co1', role: 'admin', name: 'Admin' };

  const e1 = await service.getEnquiry('e1', admin, deps);
  assert.deepEqual(e1.quotations.map((q) => q.quotationNumber), ['QTN-0012', 'QTN-0010']);
  assert.equal(e1.quotations[0].grandTotal, 2000);

  const e2 = await service.getEnquiry('e2', admin, deps);
  assert.deepEqual(e2.quotations.map((q) => q.id), ['q3'], 'another lead’s quotation is not borrowed');
});
