'use strict';

/**
 * Owner request (18 Nov 2026): "in sales order first milestone is same for
 * every Sales Order that is Advance Payment 100% the rest will be chosen
 * from the 13 checklist and on which checklists the each remaining payment
 * will be taken it should be as a dropdown option in sales order."
 *
 * The advance is taken against the order itself. Every milestone after it
 * names the point of work that earns it, and when the order creates the
 * project that choice becomes the project's own link — so the money asks
 * for itself the moment that point is ticked and signed off.
 *
 * The LIVE link stays where linking put it on 16 Nov: on the point
 * (`releasesMilestoneIndex`), which carries it when points move. What the
 * milestone holds is what the ORDER agreed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const cascade = require('../src/services/salesOrderCascade');
const salesOrderService = require('../src/services/salesOrderService');
const projectService = require('../src/services/projectService');
const checklistTemplateService = require('../src/services/checklistTemplateService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { LEGACY_CHECKLIST_FALLBACK } = require('../src/models/shared/legacyChecklists');

const auth = (o = {}) => ({ userId: 'u1', companyId: 'co1', role: 'sales', name: 'Sales', ...o });
const store = (seed = {}) => createEnquiryFakeStore({
  companies: [{ id: 'co1', name: 'MEP Powertech', divisions: ['HVAC', 'Solar', 'MEP'] }],
  ...seed,
});

const points = (n) => Array.from({ length: n }, (_, i) => ({
  text: `Point ${i + 1}`, signResponsibility: 'ENGINEER', releasesMilestoneIndex: null,
}));

/* ------------------------------------------------------------------ *
 * Reading the choice
 * ------------------------------------------------------------------ */

test('a point is only a point when it is a whole number at or above zero', () => {
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: 0 }), 0, 'point 0 is a real point');
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: '4' }), 4, 'a form sends strings');
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: '' }), null, '"not chosen" is not point 0');
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: null }), null);
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: undefined }), null);
  assert.equal(cascade.pointIndexOf({}), null);
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: -1 }), null);
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: 2.5 }), null);
  assert.equal(cascade.pointIndexOf({ checklistPointIndex: 'third' }), null);
});

/* ------------------------------------------------------------------ *
 * Writing it onto the project's points
 * ------------------------------------------------------------------ */

test('each milestone links to the point it names', () => {
  const linked = cascade.applyMilestoneLinks(points(13), [
    { description: 'Advance Payment 100%', amount: 1 },
    { description: 'On piping', amount: 1, checklistPointIndex: 4 },
    { description: 'On handover', amount: 1, checklistPointIndex: 12 },
  ]);
  assert.equal(linked[4].releasesMilestoneIndex, 1);
  assert.equal(linked[12].releasesMilestoneIndex, 2);
  assert.equal(linked.filter((c) => c.releasesMilestoneIndex !== null).length, 2);
  assert.equal(linked[0].releasesMilestoneIndex, null, 'the advance links to nothing');
});

test('one point releases at most one milestone', () => {
  const linked = cascade.applyMilestoneLinks(points(13), [
    { description: 'Advance', amount: 1 },
    { description: 'Second', amount: 1, checklistPointIndex: 4 },
    { description: 'Third', amount: 1, checklistPointIndex: 4 },
  ]);
  assert.equal(linked[4].releasesMilestoneIndex, 1, 'the first one named it');
  assert.equal(linked.filter((c) => c.releasesMilestoneIndex !== null).length, 1);
});

test('a point that does not exist is skipped, not guessed at', () => {
  const linked = cascade.applyMilestoneLinks(points(10), [
    { description: 'Advance', amount: 1 },
    { description: 'Beyond the end', amount: 1, checklistPointIndex: 12 },
  ]);
  assert.equal(linked.filter((c) => c.releasesMilestoneIndex !== null).length, 0);
  assert.equal(linked.length, 10, 'and no point is invented to hold it');
});

test('linking leaves everything else on a point alone', () => {
  const rows = points(3);
  rows[1] = { ...rows[1], done: true, remark: 'did it', photos: ['a'], targetDate: 'd', approval: { by: 'x' } };
  const linked = cascade.applyMilestoneLinks(rows, [
    { description: 'Advance', amount: 1 },
    { description: 'Second', amount: 1, checklistPointIndex: 1 },
  ]);
  assert.equal(linked[1].releasesMilestoneIndex, 1);
  assert.equal(linked[1].done, true);
  assert.equal(linked[1].remark, 'did it');
  assert.deepEqual(linked[1].photos, ['a']);
  assert.deepEqual(linked[1].approval, { by: 'x' });
});

test('an order with no links leaves every point unlinked', () => {
  const linked = cascade.applyMilestoneLinks(points(13), [{ description: 'Advance', amount: 1 }]);
  assert.ok(linked.every((c) => c.releasesMilestoneIndex === null));
});

/* ------------------------------------------------------------------ *
 * End to end, through the order
 * ------------------------------------------------------------------ */

test('raising an order links the project it creates', async () => {
  const s = store();
  const so = await salesOrderService.createSalesOrder({
    division: 'HVAC', projectName: 'Linked site', startDate: '2026-11-18', endDate: '2027-02-01',
    paymentMilestones: [
      { description: 'Advance Payment 100%', amount: 100000 },
      { description: 'On piping', amount: 100000, checklistPointIndex: 4 },
      { description: 'On handover', amount: 100000, checklistPointIndex: 12 },
    ],
  }, auth(), s);

  assert.equal(so.salesOrder.paymentMilestones[0].checklistPointIndex, null, 'the advance is on the order');
  assert.equal(so.salesOrder.paymentMilestones[1].checklistPointIndex, 4);

  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'Linked site');
  assert.equal(project.checklist.length, LEGACY_CHECKLIST_FALLBACK.HVAC.length);
  assert.equal(project.checklist[4].releasesMilestoneIndex, 1);
  assert.equal(project.checklist[12].releasesMilestoneIndex, 2);
});

test('editing the order re-links the project', async () => {
  const s = store();
  const made = await salesOrderService.createSalesOrder({
    division: 'HVAC', projectName: 'Relink site', startDate: '2026-11-18',
    paymentMilestones: [
      { description: 'Advance Payment 100%', amount: 100000 },
      { description: 'On piping', amount: 100000, checklistPointIndex: 4 },
    ],
  }, auth(), s);

  await salesOrderService.editSalesOrder(made.salesOrder.id, {
    paymentMilestones: [
      { description: 'Advance Payment 100%', amount: 100000 },
      { description: 'Moved to commissioning', amount: 100000, checklistPointIndex: 10 },
    ],
  }, auth({ role: 'admin' }), s);

  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'Relink site');
  assert.equal(project.checklist[4].releasesMilestoneIndex, null, 'the old point lets go');
  assert.equal(project.checklist[10].releasesMilestoneIndex, 1, 'the new one takes it');
});

test('clearing the choice clears the link', async () => {
  const s = store();
  const made = await salesOrderService.createSalesOrder({
    division: 'HVAC', projectName: 'Unlink site', startDate: '2026-11-18',
    paymentMilestones: [
      { description: 'Advance', amount: 1 },
      { description: 'On piping', amount: 1, checklistPointIndex: 4 },
    ],
  }, auth(), s);
  await salesOrderService.editSalesOrder(made.salesOrder.id, {
    paymentMilestones: [
      { description: 'Advance', amount: 1 },
      { description: 'On piping', amount: 1, checklistPointIndex: '' },
    ],
  }, auth({ role: 'admin' }), s);
  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'Unlink site');
  assert.ok(project.checklist.every((c) => c.releasesMilestoneIndex === null));
});

test('an order raised the old way, with no choice at all, still works', async () => {
  const s = store();
  const made = await salesOrderService.createSalesOrder({
    division: 'Solar', projectName: 'Plain site', startDate: '2026-11-18',
    paymentMilestones: [{ description: 'Advance', amount: 1 }, { description: 'Balance', amount: 1 }],
  }, auth(), s);
  assert.equal(made.salesOrder.paymentMilestones[1].checklistPointIndex, null);
  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'Plain site');
  assert.ok(project.checklist.every((c) => c.releasesMilestoneIndex === null));
});

/* ------------------------------------------------------------------ *
 * What the form is offered
 * ------------------------------------------------------------------ */

test('the form is offered the points the project will actually get', async () => {
  const s = store();
  const got = await checklistTemplateService.standardPointsForDivision(auth(), 'HVAC', s);
  assert.equal(got.division, 'HVAC');
  assert.equal(got.items.length, 13);
  assert.equal(got.items[0].index, 0);
  assert.equal(got.items[0].text, LEGACY_CHECKLIST_FALLBACK.HVAC[0].text);
  assert.ok(got.items.every((i) => i.signResponsibility), 'each says who signs it');
  assert.ok(!('done' in got.items[0]), 'doing a point belongs to a project');
  assert.ok(!('targetDate' in got.items[0]));
});

test('a company template wins there too, so the form matches the project', async () => {
  const s = store({
    checklistTemplates: [{
      id: 'tpl1', companyId: 'co1', division: 'Solar', name: 'Our solar list', isDefault: true,
      items: [{ text: 'Panels up', signResponsibility: 'ENGINEER' }, { text: 'Meter', signResponsibility: 'CLIENT' }],
    }],
  });
  const got = await checklistTemplateService.standardPointsForDivision(auth(), 'Solar', s);
  assert.equal(got.items.length, 2);
  assert.equal(got.templateName, 'Our solar list');
});

test('a division nobody asked for is refused', async () => {
  const s = store();
  await assert.rejects(
    () => checklistTemplateService.standardPointsForDivision(auth(), 'Nope', s),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});

test('a Manager is offered their own division’s and no other', async () => {
  const s = store();
  const mine = await checklistTemplateService.standardPointsForDivision(auth({ role: 'hvac_pm' }), 'HVAC', s);
  assert.equal(mine.items.length, 13);
  await assert.rejects(
    () => checklistTemplateService.standardPointsForDivision(auth({ role: 'hvac_pm' }), 'Solar', s),
    (err) => err.status === 403
  );
});

/* ------------------------------------------------------------------ *
 * A defect this work uncovered
 * ------------------------------------------------------------------ */

test('the FIRST milestone can be linked to a point by hand — Number(null) is 0', async () => {
  /*
   * DEFECT, found 18 Nov 2026 while building the dropdown. The "one
   * milestone, one point" guard compared Number(c.releasesMilestoneIndex),
   * and Number(null) is 0. A point that releases nothing is stored as null
   * — the schema's own default — so every unlinked point read as "releases
   * milestone 0", and linking the advance to any point was refused with
   * "already released by checklist point 1".
   *
   * It only ever hit milestone 0, and only against real storage: the
   * in-memory store left the field absent, and Number(undefined) is NaN,
   * which is why no test saw it. This one builds the points the way the
   * database does.
   */
  const s = store();
  await salesOrderService.createSalesOrder({
    division: 'HVAC', projectName: 'Link the advance', startDate: '2026-11-18',
    paymentMilestones: [{ description: 'Advance Payment 100%', amount: 100000 }],
  }, auth(), s);

  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'Link the advance');
  // Exactly how Mongoose stores an unlinked point.
  await s.projectRepo.update('co1', project.id, {
    checklist: project.checklist.map((c) => ({ ...c, releasesMilestoneIndex: null })),
  });

  const after = await projectService.setChecklistMilestoneLink(
    project.id, 2, { milestoneIndex: 0, collectWithinDays: 7 }, auth({ role: 'admin' }), s
  );
  assert.equal(after.checklist[2].releasesMilestoneIndex, 0);
  assert.equal(after.checklist[2].releaseCollectWithinDays, 7);
  assert.equal(after.checklist[0].releasesMilestoneIndex, null, 'and nothing else was linked');
});

test('a milestone really taken by another point is still refused', async () => {
  const s = store();
  await salesOrderService.createSalesOrder({
    division: 'HVAC', projectName: 'One point one milestone', startDate: '2026-11-18',
    paymentMilestones: [
      { description: 'Advance', amount: 1 },
      { description: 'On piping', amount: 1, checklistPointIndex: 4 },
    ],
  }, auth(), s);
  const project = (await s.projectRepo.listByCompany('co1')).find((p) => p.name === 'One point one milestone');
  await assert.rejects(
    () => projectService.setChecklistMilestoneLink(
      project.id, 7, { milestoneIndex: 1 }, auth({ role: 'admin' }), s
    ),
    (err) => err.code === 'MILESTONE_ALREADY_LINKED' && /point 5/.test(err.message)
  );
});
