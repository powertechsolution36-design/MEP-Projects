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

test('createEnquiry — sales can create; admin cannot (server-side, not just UI)', async () => {
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

  await assert.rejects(
    () => service.createEnquiry({ name: 'X', segment: 'HVAC' }, auth({ role: 'admin' }), deps),
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
