'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/checklistTemplateService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { STANDARD_ITEMS_BY_DIVISION, seedStandardChecklistTemplates } = require('../src/seeds/checklistTemplateSeed');

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'hvac_pm', name: 'Priya PM', ...overrides };
}

function tpl(overrides) {
  return {
    id: 'tpl1',
    companyId: 'co1',
    division: 'HVAC',
    name: 'Standard HVAC Checklist',
    items: [{ text: 'Point A', signResponsibility: 'ENGINEER' }],
    isDefault: true,
    createdByUserId: 'u1',
    createdDate: new Date('2026-01-01'),
    ...overrides,
  };
}

/* ================= role gate (canEditChecklistLibrary) ================= */

test('canEditChecklistLibrary — PWA QUIRK preserved: admin OR any division-PM role (not division-matched) may edit; other roles may not', () => {
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'admin' })), true);
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'hvac_pm' })), true);
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'solar_pm' })), true); // solar_pm editing HVAC-division template — allowed, quirk
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'mep_pm' })), true);
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'sales' })), false);
  assert.equal(service.canEditChecklistLibrary(auth({ role: 'engineer' })), false);
});

/* ================= listing / viewing ================= */

test('listTemplates — a division PM only ever sees their own division; admin/other roles see all divisions', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [
      tpl({ id: 't1', division: 'HVAC' }),
      tpl({ id: 't2', division: 'Solar', name: 'Standard Solar Checklist' }),
    ],
  });
  const hvacPm = await service.listTemplates(auth({ role: 'hvac_pm' }), {}, store);
  assert.deepEqual(hvacPm.map((t) => t.id), ['t1']);

  const admin = await service.listTemplates(auth({ role: 'admin' }), {}, store);
  assert.equal(admin.length, 2);

  const sales = await service.listTemplates(auth({ role: 'sales' }), {}, store);
  assert.equal(sales.length, 2); // PWA QUIRK: myDiv() is null for non-PM roles -> unfiltered

  const filtered = await service.listTemplates(auth({ role: 'admin' }), { division: 'Solar' }, store);
  assert.deepEqual(filtered.map((t) => t.id), ['t2']);
});

test('getTemplate — detail view has no extra role restriction, same convention as Project.getProject; tenant-isolated', async () => {
  const store = createEnquiryFakeStore({ checklistTemplates: [tpl()] });
  const found = await service.getTemplate('tpl1', auth({ role: 'engineer' }), store);
  assert.equal(found.id, 'tpl1');
  await assert.rejects(() => service.getTemplate('tpl1', auth({ companyId: 'co2' }), store), (err) => err.code === 'NOT_FOUND');
});

/* ================= create ================= */

test('createTemplate — name required, division required, optional "start from" copies items by value, optional isDefault unsets siblings first', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [tpl({ id: 'src', division: 'HVAC', items: [{ text: 'A', signResponsibility: 'ENGINEER' }], isDefault: true })],
  });
  await assert.rejects(
    () => service.createTemplate({ division: 'HVAC', name: '' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    () => service.createTemplate({ division: 'NotReal', name: 'X' }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );

  const created = await service.createTemplate(
    { division: 'HVAC', name: 'VRF Large Project Checklist', sourceTemplateId: 'src', isDefault: true },
    auth(),
    store
  );
  assert.equal(created.name, 'VRF Large Project Checklist');
  assert.deepEqual(created.items, [{ text: 'A', signResponsibility: 'ENGINEER' }]);
  assert.equal(created.isDefault, true);

  const src = await service.getTemplate('src', auth(), store);
  assert.equal(src.isDefault, false, 'creating a new default unsets the sibling default in the same division');
});

test('createTemplate — role gate enforced; tenant scoped from session only', async () => {
  const store = createEnquiryFakeStore({});
  await assert.rejects(
    () => service.createTemplate({ division: 'HVAC', name: 'X' }, auth({ role: 'sales' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
  const created = await service.createTemplate({ division: 'HVAC', name: 'X' }, auth({ role: 'admin' }), store);
  assert.equal(created.companyId, 'co1');
});

/* ================= duplicate ================= */

test('duplicateTemplate — PWA FACT: name+" (copy)", items copied by value, never marked default, no notification', async () => {
  const store = createEnquiryFakeStore({ checklistTemplates: [tpl({ isDefault: true })] });
  const dup = await service.duplicateTemplate('tpl1', auth(), store);
  assert.equal(dup.name, 'Standard HVAC Checklist (copy)');
  assert.deepEqual(dup.items, [{ text: 'Point A', signResponsibility: 'ENGINEER' }]);
  assert.equal(dup.isDefault, false);
  assert.equal(store.state.notifications.length, 0, 'Checklist Library has zero notify() call sites — preserved');

  const original = await service.getTemplate('tpl1', auth(), store);
  assert.equal(original.isDefault, true, 'duplicating never touches the source template');
});

/* ================= rename ================= */

test('renameTemplate — name required', async () => {
  const store = createEnquiryFakeStore({ checklistTemplates: [tpl()] });
  await assert.rejects(() => service.renameTemplate('tpl1', '', auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  const renamed = await service.renameTemplate('tpl1', 'New Name', auth(), store);
  assert.equal(renamed.name, 'New Name');
});

/* ================= set default ================= */

test('setDefaultTemplate — one-default-per-division: unsets every sibling in the SAME division, sets this one, other divisions unaffected', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [
      tpl({ id: 't1', division: 'HVAC', isDefault: true }),
      tpl({ id: 't2', division: 'HVAC', isDefault: false }),
      tpl({ id: 't3', division: 'Solar', isDefault: true }),
    ],
  });
  await service.setDefaultTemplate('t2', auth(), store);
  const t1 = await service.getTemplate('t1', auth(), store);
  const t2 = await service.getTemplate('t2', auth(), store);
  const t3 = await service.getTemplate('t3', auth(), store);
  assert.equal(t1.isDefault, false);
  assert.equal(t2.isDefault, true);
  assert.equal(t3.isDefault, true, 'a different division default is untouched');
});

/* ================= delete ================= */

test('deleteTemplate — PWA FACT: minimum 1 template per division enforced; no reassignment of default on delete; deleting the last non-default template succeeds', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [
      tpl({ id: 't1', division: 'HVAC', isDefault: true }),
      tpl({ id: 't2', division: 'HVAC', isDefault: false }),
    ],
  });
  // Only 1 left after this delete — should succeed (still >=1 remains: this delete brings count from 2 to 1, guard blocks only when it WOULD go to 0).
  const first = await service.deleteTemplate('t2', auth(), store);
  assert.equal(first.deleted, true);

  // Now only t1 remains — deleting it must be refused (min 1 per division).
  await assert.rejects(() => service.deleteTemplate('t1', auth(), store), (err) => err.code === 'MIN_ONE_PER_DIVISION');
  const stillThere = await service.getTemplate('t1', auth(), store);
  assert.ok(stillThere);
});

test('deleteTemplate — deleting the division default does not auto-promote another template to default (PWA FACT, no auto-reassignment)', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [
      tpl({ id: 't1', division: 'HVAC', isDefault: true }),
      tpl({ id: 't2', division: 'HVAC', isDefault: false, name: 'Second' }),
    ],
  });
  await service.deleteTemplate('t1', auth(), store);
  const remaining = await service.getTemplate('t2', auth(), store);
  assert.equal(remaining.isDefault, false, 'no other template is auto-promoted to default');
});

/* ================= items: add / edit / remove / move ================= */

test('addTemplateItem/editTemplateItem — text required, sign must be one of the 4 fixed values', async () => {
  const store = createEnquiryFakeStore({ checklistTemplates: [tpl({ items: [] })] });
  await assert.rejects(() => service.addTemplateItem('tpl1', { text: '', signResponsibility: 'ENGINEER' }, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  await assert.rejects(() => service.addTemplateItem('tpl1', { text: 'X', signResponsibility: 'PM' }, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  const added = await service.addTemplateItem('tpl1', { text: 'New point', signResponsibility: 'CLIENT' }, auth(), store);
  assert.deepEqual(added.items, [{ text: 'New point', signResponsibility: 'CLIENT' }]);

  const edited = await service.editTemplateItem('tpl1', 0, { text: 'Edited point', signResponsibility: 'SALES' }, auth(), store);
  assert.deepEqual(edited.items, [{ text: 'Edited point', signResponsibility: 'SALES' }]);
});

test('removeTemplateItem — splices the item out', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [tpl({ items: [{ text: 'A', signResponsibility: 'ENGINEER' }, { text: 'B', signResponsibility: 'CLIENT' }] })],
  });
  const after = await service.removeTemplateItem('tpl1', 0, auth(), store);
  assert.deepEqual(after.items, [{ text: 'B', signResponsibility: 'CLIENT' }]);
});

test('moveTemplateItem — PWA FACT (moveChkPoint): plain adjacent swap, not alphabetical; out-of-range move is a silent no-op', async () => {
  const store = createEnquiryFakeStore({
    checklistTemplates: [
      tpl({
        items: [
          { text: 'First', signResponsibility: 'ENGINEER' },
          { text: 'Second', signResponsibility: 'CLIENT' },
          { text: 'Third', signResponsibility: 'SALES' },
        ],
      }),
    ],
  });
  // middle reorder: move index 1 down (swap with index 2)
  let after = await service.moveTemplateItem('tpl1', 1, 1, auth(), store);
  assert.deepEqual(after.items.map((i) => i.text), ['First', 'Third', 'Second']);

  // move first -> up (out of range, no-op)
  after = await service.moveTemplateItem('tpl1', 0, -1, auth(), store);
  assert.deepEqual(after.items.map((i) => i.text), ['First', 'Third', 'Second']);

  // move last -> down (out of range, no-op)
  after = await service.moveTemplateItem('tpl1', 2, 1, auth(), store);
  assert.deepEqual(after.items.map((i) => i.text), ['First', 'Third', 'Second']);

  // last -> first via repeated swaps
  after = await service.moveTemplateItem('tpl1', 2, -1, auth(), store);
  after = await service.moveTemplateItem('tpl1', 1, -1, auth(), store);
  assert.deepEqual(after.items.map((i) => i.text), ['Second', 'First', 'Third']);
});

/* ================= compatibility: SalesOrder default selection / Project copy-by-value ================= */

test('compatibility — SO/Project resolveChecklist (findDefaultForDivision) picks up a template created through this service, and editing a template later does NOT retroactively alter an already-copied project checklist', async () => {
  const salesOrderCascade = require('../src/services/salesOrderCascade');
  const store = createEnquiryFakeStore({});
  const created = await service.createTemplate(
    { division: 'HVAC', name: 'Custom Default', isDefault: true },
    auth({ role: 'admin' }),
    store
  );
  await service.addTemplateItem(created.id, { text: 'Point 1', signResponsibility: 'ENGINEER' }, auth({ role: 'admin' }), store);

  const resolved = await salesOrderCascade.resolveChecklist('co1', 'HVAC', store);
  assert.equal(resolved.checklistTemplateName, 'Custom Default');
  assert.equal(resolved.checklist.length, 1);
  assert.equal(resolved.checklist[0].text, 'Point 1');

  // Now edit the template after the "copy" was taken — the resolved copy must be unaffected (it's a plain object, not a live reference).
  await service.editTemplateItem(created.id, 0, { text: 'Changed later', signResponsibility: 'CLIENT' }, auth({ role: 'admin' }), store);
  assert.equal(resolved.checklist[0].text, 'Point 1', 'the earlier copy-by-value is untouched by a later template edit');

  const templateNow = await service.getTemplate(created.id, auth({ role: 'admin' }), store);
  assert.equal(templateNow.items[0].text, 'Changed later');
});

/* ================= seeded templates ================= */

test('seedStandardChecklistTemplates — creates exactly 3 templates (HVAC/Solar/MEP), each default, with the PWA-verbatim item text/sign traced from HVAC_CHK/SOLAR_CHK/MEP_CHK', async () => {
  const store = createEnquiryFakeStore({});
  const created = await seedStandardChecklistTemplates('co1', 'u1', store);
  assert.equal(created.length, 3);
  assert.deepEqual(created.map((t) => t.division).sort(), ['HVAC', 'MEP', 'Solar']);
  created.forEach((t) => assert.equal(t.isDefault, true));

  const hvac = created.find((t) => t.division === 'HVAC');
  assert.equal(hvac.items.length, STANDARD_ITEMS_BY_DIVISION.HVAC.length);
  assert.equal(hvac.items[0].text, 'Site takeover with all details and requirements from Sales Team');
  assert.equal(hvac.items[0].signResponsibility, 'SALES');

  const solar = created.find((t) => t.division === 'Solar');
  assert.equal(solar.items.length, STANDARD_ITEMS_BY_DIVISION.Solar.length);

  const mep = created.find((t) => t.division === 'MEP');
  assert.equal(mep.items.length, STANDARD_ITEMS_BY_DIVISION.MEP.length);
  assert.equal(mep.items[0].text.startsWith('Mechanical: Load calculations verified'), true);
});
