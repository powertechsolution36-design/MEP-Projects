'use strict';

/**
 * DEFECT, reported 18 Nov 2026: "the 13 checklists are not showing ... the
 * 13 checklists should be shown default for any project afterwards they can
 * edit."
 *
 * A project takes its checklist when the sales order creates it, through
 * the chain: the division's default template → any template for the
 * division → the thirteen standard points → nothing.
 *
 * A template with NO points in it — one started on the Checklist Template
 * screen and left empty — is still a template, so it won that chain and the
 * project was created with an empty checklist. Nothing showed on the
 * project, the client's progress had nothing to show either, and the
 * project could never complete itself, since completion is every point
 * being done.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const cascade = require('../src/services/salesOrderCascade');
const { LEGACY_CHECKLIST_FALLBACK } = require('../src/models/shared/legacyChecklists');

/** A repo answering with whatever template this test wants. */
const deps = (template) => ({ checklistTemplateRepo: { findDefaultForDivision: async () => template } });

test('the standard points are thirteen for HVAC and for Solar', () => {
  assert.equal(LEGACY_CHECKLIST_FALLBACK.HVAC.length, 13);
  assert.equal(LEGACY_CHECKLIST_FALLBACK.Solar.length, 13);
});

test('a project with no template at all gets the thirteen', async () => {
  const { checklist } = await cascade.resolveChecklist('co1', 'HVAC', deps(null));
  assert.equal(checklist.length, 13);
  assert.equal(checklist[0].text, LEGACY_CHECKLIST_FALLBACK.HVAC[0].text);
  assert.equal(checklist[0].done, false, 'and nothing is ticked for them');
});

test('an EMPTY template no longer wins over the thirteen — the defect', async () => {
  const empty = { id: 't1', name: 'Started and left empty', division: 'HVAC', items: [] };
  const { checklist, checklistTemplateName } = await cascade.resolveChecklist('co1', 'HVAC', deps(empty));
  assert.equal(checklist.length, 13, 'a template with no points is no checklist');
  assert.equal(checklistTemplateName, '', 'and it does not lend the project its name either');
});

test('a template with no items array at all is passed over too', async () => {
  const broken = { id: 't1', name: 'No items key', division: 'HVAC' };
  const { checklist } = await cascade.resolveChecklist('co1', 'HVAC', deps(broken));
  assert.equal(checklist.length, 13);
});

test('a real template still wins, which is the point of having one', async () => {
  const real = {
    id: 't1', name: 'Site template', division: 'HVAC',
    items: [
      { text: 'Scaffolding up', signResponsibility: 'PM' },
      { text: 'Client sign-off', signResponsibility: 'CLIENT' },
    ],
  };
  const { checklist, checklistTemplateName } = await cascade.resolveChecklist('co1', 'HVAC', deps(real));
  assert.equal(checklist.length, 2);
  assert.equal(checklistTemplateName, 'Site template');
  assert.equal(checklist[1].signResponsibility, 'CLIENT');
});

test('MEP keeps its own eighteen, not HVAC’s thirteen', async () => {
  const { checklist } = await cascade.resolveChecklist('co1', 'MEP', deps({ items: [] }));
  assert.equal(checklist.length, LEGACY_CHECKLIST_FALLBACK.MEP.length);
});

test('every point arrives fresh — nothing done, signed, dated or approved', async () => {
  const { checklist } = await cascade.resolveChecklist('co1', 'HVAC', deps(null));
  for (const point of checklist) {
    assert.equal(point.done, false);
    assert.equal(point.pmSigned, false);
    assert.equal(point.completedDate, null);
    assert.equal(point.approval, null);
    assert.equal(point.targetDate, null);
    assert.deepEqual(point.photos, []);
    assert.ok(point.text, 'and every point says something');
  }
});
