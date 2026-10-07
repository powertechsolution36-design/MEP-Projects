'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/projectService');
const { createEnquiryFakeStore } = require('./enquiryFakes');

// Minimal CSV-row splitter that respects double-quoted fields (a field like
// the Engineers column's `", "`-joined names legitimately contains a comma
// and gets quoted by `csvEscape`) — naive `line.split(',')` would misparse it.
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function auth(overrides) {
  return { userId: 'u1', companyId: 'co1', role: 'hvac_pm', name: 'Priya PM', ...overrides };
}

function baseProject(overrides) {
  return {
    id: 'proj1',
    companyId: 'co1',
    salesOrderId: 'so1',
    division: 'HVAC',
    name: 'Tower Chiller Plant',
    siteType: '',
    capacity: '',
    customer: 'Ravi',
    stage: 'Planning',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-01'),
    assignedEngineerIds: [],
    vendor: '',
    status: 'Ongoing',
    checklistTemplateName: 'Standard HVAC',
    checklist: [],
    executionUpdates: [],
    deliveryChallans: [],
    timelineSet: false,
    lastDelayNotifiedDate: null,
    ...overrides,
  };
}

function baseSalesOrder(overrides) {
  return {
    id: 'so1', companyId: 'co1', orderNumber: 1, division: 'HVAC', projectName: 'Tower Chiller Plant',
    contacts: [{ name: 'Ravi', phone: '900' }], paymentMilestones: [{ description: 'Advance', amount: 100000, received: false }],
    ...overrides,
  };
}

function chk(overrides) {
  return {
    text: 'Site survey', signResponsibility: 'ENGINEER', done: false, completedDate: null, pmSigned: false,
    remark: '', photos: [], targetDate: null, approval: null, ...overrides,
  };
}

/* ================= creation / scope ================= */

test('projectService exposes no standalone create — Project creation only happens via the SalesOrder cascade', () => {
  assert.equal(service.createProject, undefined);
});

/* ================= view / list / search ================= */

test('getProject — no division restriction on detail view (PWA FACT, preserved per explicit instruction): any same-company role can view', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ division: 'Solar' })] });
  const project = await service.getProject('proj1', auth({ role: 'engineer' }), store);
  assert.equal(project.id, 'proj1');
  await assert.rejects(() => service.getProject('proj1', auth({ companyId: 'co2' }), store), (err) => err.code === 'NOT_FOUND');
});

test('listProjects — PM roles scoped to their own division; other roles see all divisions; search matches engineer name substring', async () => {
  const store = createEnquiryFakeStore({
    projects: [
      baseProject({ id: 'p1', division: 'HVAC', name: 'Alpha' }),
      baseProject({ id: 'p2', division: 'Solar', name: 'Beta', assignedEngineerIds: ['eng1'] }),
    ],
    users: [{ id: 'eng1', companyId: 'co1', name: 'Kiran Engineer', role: 'engineer' }],
    salesOrders: [baseSalesOrder()],
  });
  const hvacPm = await service.listProjects(auth({ role: 'hvac_pm' }), {}, store);
  assert.deepEqual(hvacPm.map((p) => p.id), ['p1']);

  const admin = await service.listProjects(auth({ role: 'admin' }), {}, store);
  assert.equal(admin.length, 2);
  assert.deepEqual(admin.map((p) => p.id), ['p2', 'p1']); // newest-first (reversed insertion order)

  const bySearch = await service.listProjects(auth({ role: 'admin' }), { filters: { q: 'kiran' } }, store);
  assert.deepEqual(bySearch.map((p) => p.id), ['p2']);
});

/* ================= stage / status / completion ================= */

test('setStage — MEP structurally cannot reach status=Completed via the literal stage-string check', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ division: 'MEP', stage: 'Concept' })] });
  const updated = await service.setStage('proj1', { stage: 'Delivered' }, auth({ role: 'mep_pm' }), store);
  assert.equal(updated.stage, 'Delivered');
  assert.equal(updated.status, 'Ongoing'); // never becomes Completed — MEP has no "Completed" stage value at all
});

test('setStage — HVAC/Solar completion gate: blocks on pending returnable material and on incomplete/unapproved checklist, independently overridable, no partial persist', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({
      stage: 'Finishing',
      checklist: [chk({ done: false })],
      deliveryChallans: [{ challanNumber: '1', date: new Date(), materialName: 'Pipe', quantity: 10, unit: 'Mtr', returnable: true, returnedQuantity: 2, recordedByUserId: 'u1', remark: '' }],
    })],
  });

  await assert.rejects(
    () => service.setStage('proj1', { stage: 'Completed' }, auth(), store),
    (err) => err.code === 'PENDING_MATERIAL_CONFIRMATION_REQUIRED'
  );
  let unchanged = await service.getProject('proj1', auth(), store);
  assert.equal(unchanged.stage, 'Finishing');

  await assert.rejects(
    () => service.setStage('proj1', { stage: 'Completed', confirmPendingMaterial: true }, auth(), store),
    (err) => err.code === 'INCOMPLETE_CHECKLIST_CONFIRMATION_REQUIRED'
  );
  unchanged = await service.getProject('proj1', auth(), store);
  assert.equal(unchanged.stage, 'Finishing');

  const completed = await service.setStage(
    'proj1',
    { stage: 'Completed', confirmPendingMaterial: true, confirmIncompleteChecklist: true },
    auth(),
    store
  );
  assert.equal(completed.status, 'Completed');
  assert.ok(completed.endDate);

  const notif = store.state.notifications.find((n) => /Approve commissioning/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles, ['service_mgr']);
  const financeNotif = store.state.notifications.find((n) => n.targetRoles.includes('finance'));
  assert.ok(financeNotif);
  const adminNotif = store.state.notifications.find((n) => n.targetRoles.includes('admin') && /stage:/.test(n.text));
  assert.ok(adminNotif);
});

test('setStage — FIX-3.3-02: a genuine transition to Completed fires all three notifications (finance, admin, service_mgr); a same-value resave of an already-Completed stage fires none', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ stage: 'Finishing', checklist: [], deliveryChallans: [] })],
  });

  const completed = await service.setStage('proj1', { stage: 'Completed' }, auth(), store);
  assert.equal(completed.status, 'Completed');
  assert.equal(store.state.notifications.length, 3, 'genuine Finishing -> Completed transition fires finance + admin + service_mgr');
  assert.ok(store.state.notifications.some((n) => n.targetRoles.includes('finance')));
  assert.ok(store.state.notifications.some((n) => n.targetRoles.includes('admin') && /stage:/.test(n.text)));
  assert.ok(store.state.notifications.some((n) => n.targetRoles.includes('service_mgr')));

  // Resave the SAME stage value ("Completed" -> "Completed"): old===stage,
  // so none of the three notifications should fire again (PWA FACT:
  // savePM groups them all under one `if(old!==p.stage)` guard).
  const resaved = await service.setStage('proj1', { stage: 'Completed' }, auth(), store);
  assert.equal(resaved.status, 'Completed');
  assert.equal(store.state.notifications.length, 3, 'same-value resave of Completed fires zero additional notifications');
});

test('setStage — no completion gate is payment/engineer/timeline related; a project with timelineSet=false and no engineers can still complete (with checklist/material overrides)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ stage: 'Finishing', timelineSet: false, assignedEngineerIds: [] })] });
  const completed = await service.setStage('proj1', { stage: 'Completed' }, auth(), store);
  assert.equal(completed.status, 'Completed');
});

test('setStage — un-completing: moving stage away from Completed silently reverts status to Ongoing, no confirm/notification of its own', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ stage: 'Completed', status: 'Completed' })] });
  const reverted = await service.setStage('proj1', { stage: 'Finishing' }, auth(), store);
  assert.equal(reverted.status, 'Ongoing');
});

test('setStage — once In Service, stage changes freely with zero effect on status (desync quirk preserved)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ stage: 'Completed', status: 'In Service' })] });
  const updated = await service.setStage('proj1', { stage: 'Planning' }, auth(), store);
  assert.equal(updated.stage, 'Planning');
  assert.equal(updated.status, 'In Service');
});

test('setStage — role enforcement: only the matching-division PM or admin may edit stage', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  await assert.rejects(() => service.setStage('proj1', { stage: 'Piping' }, auth({ role: 'solar_pm' }), store), (err) => err.code === 'FORBIDDEN');
  const ok = await service.setStage('proj1', { stage: 'Piping' }, auth({ role: 'admin' }), store);
  assert.equal(ok.stage, 'Piping');
});

test('setStage — invalid stage for the project division is rejected (division-aware validity)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ division: 'HVAC' })] });
  await assert.rejects(() => service.setStage('proj1', { stage: 'Delivered' }, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
});

/* ================= engineer assignment ================= */

test('assignEngineers — company-wide candidate pool (not division-filtered), full replace, notifies "*" only for newly added', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ assignedEngineerIds: ['eng1'] })],
    users: [
      { id: 'eng1', companyId: 'co1', name: 'Kiran', role: 'engineer' },
      { id: 'eng2', companyId: 'co1', name: 'Solar Pinto', role: 'solar_pm' },
    ],
  });
  const updated = await service.assignEngineers('proj1', ['eng2'], auth(), store);
  assert.deepEqual(updated.assignedEngineerIds, ['eng2']);
  const notif = store.state.notifications.find((n) => /assigned to project/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles, ['*']);
  assert.match(notif.text, /Solar Pinto/);
});

test('assignEngineers — rejects a candidate outside the allowed role set or a different company', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject()],
    users: [{ id: 'sales1', companyId: 'co1', name: 'Sales Guy', role: 'sales' }],
  });
  await assert.rejects(() => service.assignEngineers('proj1', ['sales1'], auth(), store), (err) => err.code === 'VALIDATION_ERROR');
});

/* ================= timeline ================= */

test('saveTimeline — zero dates blocks entirely; partial dates need confirmPartialDates; sets timelineSet permanently and recomputes endDate; fires first-time-only notification', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ checklist: [chk({ text: 'A' }), chk({ text: 'B' })], timelineSet: false })],
  });
  await assert.rejects(
    () => service.saveTimeline('proj1', { targetDates: [null, null] }, auth(), store),
    (err) => err.code === 'VALIDATION_ERROR'
  );

  await assert.rejects(
    () => service.saveTimeline('proj1', { targetDates: [new Date('2026-03-01'), null] }, auth(), store),
    (err) => err.code === 'PARTIAL_DATES_CONFIRMATION_REQUIRED'
  );

  const saved = await service.saveTimeline(
    'proj1',
    { targetDates: [new Date('2026-03-01'), null], confirmPartialDates: true },
    auth(),
    store
  );
  assert.equal(saved.timelineSet, true);
  assert.equal(new Date(saved.endDate).getTime(), new Date('2026-03-01').getTime());
  const notif = store.state.notifications.find((n) => /Timeline set for/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles.sort(), ['admin', 'hvac_pm', 'sales'].sort());

  await service.saveTimeline('proj1', { targetDates: [new Date('2026-04-01'), new Date('2026-04-02')] }, auth(), store);
  const notifCount = store.state.notifications.filter((n) => /Timeline set for/.test(n.text)).length;
  assert.equal(notifCount, 1);
});

test('editChecklistItemDate — single-point edit recomputes endDate, PM-only', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ checklist: [chk({ targetDate: new Date('2026-01-01') })], timelineSet: true })],
  });
  const updated = await service.editChecklistItemDate('proj1', 0, new Date('2026-05-01'), auth(), store);
  assert.equal(new Date(updated.endDate).getTime(), new Date('2026-05-01').getTime());
});

/* ================= checklist execution ================= */

test('setChecklistItemDone — requires timelineReady to tick; untick clears approval+pmSigned; delay/all-done notifications', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({
      checklist: [chk({ targetDate: new Date('2020-01-01') })],
      timelineSet: false,
      assignedEngineerIds: ['u1'],
    })],
  });
  await assert.rejects(
    () => service.setChecklistItemDone('proj1', 0, true, auth({ role: 'engineer', userId: 'u1' }), store),
    (err) => err.code === 'TIMELINE_NOT_READY'
  );

  await store.projectRepo.update('co1', 'proj1', { timelineSet: true });
  const ticked = await service.setChecklistItemDone('proj1', 0, true, auth({ role: 'engineer', userId: 'u1' }), store);
  assert.equal(ticked.checklist[0].done, true);
  const delayNotif = store.state.notifications.find((n) => /Delayed completion/.test(n.text));
  assert.ok(delayNotif);
  const allDoneNotif = store.state.notifications.find((n) => /All checklist points completed/.test(n.text));
  assert.ok(allDoneNotif);
  assert.deepEqual(allDoneNotif.targetRoles.sort(), ['admin', 'hvac_pm', 'service_mgr'].sort());

  await service.approveChecklistItem('proj1', 0, {}, auth({ role: 'engineer' }), store);
  await service.counterSignChecklistItem('proj1', 0, auth(), store);
  const unticked = await service.setChecklistItemDone('proj1', 0, false, auth({ role: 'engineer', userId: 'u1' }), store);
  assert.equal(unticked.checklist[0].done, false);
  assert.equal(unticked.checklist[0].approval, null);
  assert.equal(unticked.checklist[0].pmSigned, false);
});

test('setChecklistItemDone — forbidden for a role that is neither PM nor an assigned engineer', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk()], timelineSet: true, assignedEngineerIds: ['eng1'] })] });
  await assert.rejects(
    () => service.setChecklistItemDone('proj1', 0, true, auth({ role: 'engineer', userId: 'someone-else' }), store),
    (err) => err.code === 'FORBIDDEN'
  );
});

test('approveChecklistItem — CLIENT approval captures free-text approverName + signature distinct from enteredByUserId; overwrite-only', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ checklist: [chk({ done: true, signResponsibility: 'CLIENT' })] })],
  });
  const approved = await service.approveChecklistItem(
    'proj1', 0, { approverName: 'Mr. Sharma (Client)', signatureImage: 'data:image/png;base64,AAA' },
    auth({ role: 'engineer', userId: 'u9', name: 'Kiran Staff' }), store
  );
  assert.equal(approved.checklist[0].approval.approverName, 'Mr. Sharma (Client)');
  assert.equal(approved.checklist[0].approval.enteredByUserId, 'u9');
  assert.equal(approved.checklist[0].approval.signatureImage, 'data:image/png;base64,AAA');
  assert.equal(approved.checklist[0].approval.approvedByRole, 'CLIENT');

  const reapproved = await service.approveChecklistItem('proj1', 0, { approverName: 'Different Person' }, auth({ role: 'engineer', userId: 'u9' }), store);
  assert.equal(reapproved.checklist[0].approval.approverName, 'Different Person');
  assert.equal(reapproved.checklist[0].approval.signatureImage, '');

  const notif = store.state.notifications.find((n) => /Checklist point approved/.test(n.text));
  assert.ok(notif);
  assert.deepEqual(notif.targetRoles, ['hvac_pm', 'admin']);
});

test('approveChecklistItem — non-CLIENT sign type stamps the actor display name for approverName (same person as enteredByUserId)', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk({ done: true, signResponsibility: 'SALES' })] })] });
  const approved = await service.approveChecklistItem('proj1', 0, {}, auth({ role: 'sales', userId: 'u5', name: 'Sonal Sales' }), store);
  assert.equal(approved.checklist[0].approval.approverName, 'Sonal Sales');
  assert.equal(approved.checklist[0].approval.enteredByUserId, 'u5');
});

test('approveChecklistItem — enforces the sign-responsibility role gate; rejects approving an un-done point', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk({ done: true, signResponsibility: 'SALES' })] })] });
  await assert.rejects(() => service.approveChecklistItem('proj1', 0, {}, auth({ role: 'engineer' }), store), (err) => err.code === 'FORBIDDEN');

  const store2 = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk({ done: false, signResponsibility: 'SALES' })] })] });
  await assert.rejects(() => service.approveChecklistItem('proj1', 0, {}, auth({ role: 'sales' }), store2), (err) => err.code === 'VALIDATION_ERROR');
});

test('counterSignChecklistItem (pmSign) — one-way, no un-sign function exists', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk({ done: true })] })] });
  const signed = await service.counterSignChecklistItem('proj1', 0, auth(), store);
  assert.equal(signed.checklist[0].pmSigned, true);
  assert.equal(typeof service.uncounterSignChecklistItem, 'undefined');
});

test('checklist item add/edit/remove — PM only', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [] })] });
  await service.addChecklistItem('proj1', { text: 'New point', signResponsibility: 'ENGINEER' }, auth(), store);
  let project = await service.getProject('proj1', auth(), store);
  assert.equal(project.checklist.length, 1);

  await service.editChecklistItem('proj1', 0, { text: 'Renamed point', signResponsibility: 'SALES' }, auth(), store);
  project = await service.getProject('proj1', auth(), store);
  assert.equal(project.checklist[0].text, 'Renamed point');
  assert.equal(project.checklist[0].signResponsibility, 'SALES');

  await assert.rejects(() => service.addChecklistItem('proj1', { text: 'X', signResponsibility: 'ENGINEER' }, auth({ role: 'solar_pm' }), store), (err) => err.code === 'FORBIDDEN');

  await service.removeChecklistItem('proj1', 0, auth(), store);
  project = await service.getProject('proj1', auth(), store);
  assert.equal(project.checklist.length, 0);
});

test('editChecklistItem — allowed even after approval exists, with no consequence to the existing approval record', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ checklist: [chk({ done: true, signResponsibility: 'SALES', approval: { approverName: 'Sonal', approvedByRole: 'SALES', approvedDate: new Date(), enteredByUserId: 'u5' } })] })] });
  const updated = await service.editChecklistItem('proj1', 0, { signResponsibility: 'SERVICE' }, auth(), store);
  assert.equal(updated.checklist[0].signResponsibility, 'SERVICE');
  assert.ok(updated.checklist[0].approval); // untouched, still SALES-based approval despite new sign responsibility
  assert.equal(updated.checklist[0].approval.approvedByRole, 'SALES');
});

test('applyChecklistTemplate — replace discards prior state (no confirm gate) and updates checklistTemplateName; append preserves existing points and does not rename', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ checklist: [chk({ text: 'Old point', done: true })], checklistTemplateName: 'Old Template' })],
    checklistTemplates: [{ id: 'tpl1', companyId: 'co1', division: 'HVAC', name: 'New Template', isDefault: false, items: [{ text: 'New point', signResponsibility: 'ENGINEER' }] }],
  });
  const appended = await service.applyChecklistTemplate('proj1', { templateId: 'tpl1', mode: 'append' }, auth(), store);
  assert.equal(appended.checklist.length, 2);
  assert.equal(appended.checklistTemplateName, 'Old Template');

  const replaced = await service.applyChecklistTemplate('proj1', { templateId: 'tpl1', mode: 'replace' }, auth(), store);
  assert.equal(replaced.checklist.length, 1);
  assert.equal(replaced.checklist[0].done, false);
  assert.equal(replaced.checklistTemplateName, 'New Template');
});

/* ================= execution updates ================= */

test('addExecutionUpdate — append-only, actionDone required, no notification', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ assignedEngineerIds: ['u1'] })] });
  await assert.rejects(() => service.addExecutionUpdate('proj1', {}, auth(), store), (err) => err.code === 'VALIDATION_ERROR');
  const updated = await service.addExecutionUpdate('proj1', { actionDone: 'Site visited', nextAction: 'Order pipes' }, auth({ role: 'engineer', userId: 'u1' }), store);
  assert.equal(updated.executionUpdates.length, 1);
  assert.equal(updated.executionUpdates[0].actionDone, 'Site visited');
  assert.equal(store.state.notifications.length, 0);
});

/* ================= delivery challans ================= */

test('delivery challans — numbering with gaps not reused, blank-item rows silently skipped, edit/delete single item, return increments clamped and appends to remark with no notification', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject()] });
  const withDc1 = await service.addDeliveryChallan(
    'proj1',
    { items: [{ materialName: 'Copper Pipe', quantity: 10, unit: 'Mtr', returnable: true }, { materialName: '' }] },
    auth(),
    store
  );
  assert.equal(withDc1.deliveryChallans.length, 1);
  assert.equal(withDc1.deliveryChallans[0].challanNumber, '1');

  const withDc2 = await service.addDeliveryChallan('proj1', { items: [{ materialName: 'Cable', quantity: 5, unit: 'Mtr', returnable: false }] }, auth(), store);
  assert.equal(withDc2.deliveryChallans[1].challanNumber, '2');

  const afterDelete = await service.removeDeliveryChallanItem('proj1', 0, auth(), store);
  assert.equal(afterDelete.deliveryChallans.length, 1);
  const withDc3 = await service.addDeliveryChallan('proj1', { items: [{ materialName: 'Duct', quantity: 3, unit: 'Nos', returnable: true }] }, auth(), store);
  assert.equal(withDc3.deliveryChallans[1].challanNumber, '3');

  const edited = await service.editDeliveryChallanItem('proj1', 1, { quantity: 4 }, auth(), store);
  assert.equal(edited.deliveryChallans[1].quantity, 4);

  await assert.rejects(() => service.recordDeliveryChallanReturn('proj1', 0, 1, auth(), store), (err) => err.code === 'VALIDATION_ERROR');

  const returned = await service.recordDeliveryChallanReturn('proj1', 1, 10, auth(), store);
  assert.equal(returned.deliveryChallans[1].returnedQuantity, 4);
  assert.match(returned.deliveryChallans[1].remark, /Returned 10 on/);
  assert.equal(store.state.notifications.length, 0);
});

/* ================= reports ================= */

test('exportDeliveryChallanCsv and exportProjectReportCsv — exact PWA DC columns; report includes checklist/updates/material/payment sections', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({ deliveryChallans: [{ challanNumber: '1', date: new Date('2026-01-05'), materialName: 'Pipe', quantity: 10, unit: 'Mtr', returnable: true, returnedQuantity: 2, recordedByUserId: 'u1', receivedByName: 'Site Guard', remark: '' }] })],
    salesOrders: [baseSalesOrder()],
  });
  const dcCsv = await service.exportDeliveryChallanCsv('proj1', auth(), store);
  assert.match(dcCsv, /DC No,Date,Material,Qty,Unit,Type,Returned Qty,Balance on Site,Received By,Remark/);
  assert.match(dcCsv, /Site Guard/);

  const reportCsv = await service.exportProjectReportCsv('proj1', auth(), store);
  assert.match(reportCsv, /PROJECT REPORT/);
  assert.match(reportCsv, /MATERIAL TALLY/);
  assert.match(reportCsv, /PAYMENT MILESTONES/);
});

/* ================= service conversion (deferred stub) ================= */

test('prepareServiceConversion — eligibility mirrors the PWA banner condition (Completed and not MEP); does not create a Contract or change status', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ status: 'Ongoing' })] });
  await assert.rejects(() => service.prepareServiceConversion('proj1', auth({ role: 'service_mgr' }), store), (err) => err.code === 'NOT_ELIGIBLE');

  await store.projectRepo.update('co1', 'proj1', { status: 'Completed' });
  const result = await service.prepareServiceConversion('proj1', auth({ role: 'service_mgr' }), store);
  assert.equal(result.eligible, true);
  assert.equal(result.deferred, true);
  const stillOngoing = await service.getProject('proj1', auth(), store);
  assert.equal(stillOngoing.status, 'Completed');

  const storeMep = createEnquiryFakeStore({ projects: [baseProject({ division: 'MEP', status: 'Completed' })] });
  await assert.rejects(() => service.prepareServiceConversion('proj1', auth({ role: 'service_mgr' }), storeMep), (err) => err.code === 'NOT_ELIGIBLE');
});

/* ================= delay check ================= */

test('runDelayCheckForProject — only while Ongoing and timelineReady, throttled once per day, worst delay vs first-late-item distinction preserved', async () => {
  const store = createEnquiryFakeStore({
    projects: [baseProject({
      status: 'Ongoing', timelineSet: true,
      checklist: [chk({ text: 'Late by a lot', targetDate: new Date('2020-01-01') }), chk({ text: 'Late by a little', targetDate: new Date('2026-01-15') })],
    })],
    salesOrders: [baseSalesOrder()],
  });
  const notif = await service.runDelayCheckForProject('proj1', auth(), store);
  assert.ok(notif);
  assert.match(notif.text, /PROJECT DELAYED/);
  assert.match(notif.text, /Latest pending: Late by a lot/); // first-by-array-order, not necessarily worst

  const secondRun = await service.runDelayCheckForProject('proj1', auth(), store);
  assert.equal(secondRun, null); // throttled, same day
});

/* ================= tenant isolation ================= */

test('tenant isolation: a project cannot be read or mutated across companies', async () => {
  const store = createEnquiryFakeStore({ projects: [baseProject({ companyId: 'co1' })] });
  await assert.rejects(() => service.getProject('proj1', auth({ companyId: 'co2' }), store), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(() => service.setStage('proj1', { stage: 'Piping' }, auth({ companyId: 'co2', role: 'admin' }), store), (err) => err.code === 'NOT_FOUND');
});

/* ================= FIX-6-07: exportProjectsCsv — full 26-column reconstruction + role gate ================= */

function richProjectFixtureStore() {
  return createEnquiryFakeStore({
    users: [
      { id: 'eng1', companyId: 'co1', name: 'Deepak Engineer' },
      { id: 'eng2', companyId: 'co1', name: 'Santosh Engineer' },
    ],
    salesOrders: [
      baseSalesOrder({
        id: 'so1', orderNumber: 36002,
        paymentMilestones: [
          { description: 'Advance', amount: 100000, received: true },
          { description: 'Balance', amount: 200000, received: false },
        ],
      }),
    ],
    payments: [
      // Milestone 1 unreceived-by-flag but partially paid via the ledger — proves the
      // export uses the RECONCILED paySum (matching PWA `projPayInfo`/`paySum`), not the raw flags.
      { id: 'pay1', companyId: 'co1', projectOrReference: 'Tower Chiller Plant', personName: 'Ravi', amount: 200000, status: 'Pending', salesOrderId: 'so1', milestoneIndex: 1, partPayments: [{ id: 'pp1', amount: 50000, date: new Date('2026-07-01'), mode: 'Cash', recordedByUserId: 'eng1' }] },
    ],
    projects: [
      baseProject({
        id: 'proj1', division: 'HVAC', salesOrderId: 'so1', assignedEngineerIds: ['eng1', 'eng2'],
        stage: 'Piping', status: 'Ongoing', vendor: 'Rajiudeen', checklistTemplateName: 'Standard HVAC Checklist',
        timelineSet: true,
        checklist: [
          chk({ text: 'Site survey', done: true, targetDate: new Date('2026-01-05'), approval: { approverName: 'Ravi', approvedByRole: 'CLIENT', approvedDate: new Date('2026-01-06') } }),
          chk({ text: 'Ducting', done: true, targetDate: new Date('2026-02-10') }), // done but NOT approved
          chk({ text: 'Piping', done: false, targetDate: new Date('2020-03-01') }), // overdue, way in the past
        ],
        executionUpdates: [
          { date: new Date('2026-06-01'), actionDone: 'Ducting completed', nextAction: 'Start piping', nextActionDate: new Date('2026-06-15'), enteredByUserId: 'eng1' },
          { date: new Date('2026-08-01'), actionDone: 'Piping in progress', nextAction: 'Complete piping', nextActionDate: new Date('2026-09-01'), enteredByUserId: 'eng1' },
        ],
        deliveryChallans: [
          { challanNumber: 'DC-1', date: new Date('2026-05-01'), materialName: 'Copper pipe', quantity: 100, unit: 'm', returnable: true, returnedQuantity: 30, recordedByUserId: 'eng1' },
          { challanNumber: 'DC-2', date: new Date('2026-05-02'), materialName: 'Refrigerant', quantity: 20, unit: 'kg', returnable: false, returnedQuantity: 0, recordedByUserId: 'eng1' },
        ],
      }),
    ],
  });
}

test('FIX-6-07 — exportProjectsCsv reproduces all 26 dlProjects() columns in exact order, with correct derived values', async () => {
  const store = richProjectFixtureStore();
  const csv = await service.exportProjectsCsv(auth({ role: 'admin' }), {}, store);
  const [, , header, row] = csv.split('\n');
  assert.deepEqual(
    parseCsvLine(header),
    [
      'SO No', 'Project', 'Division', 'Site Type', 'Capacity', 'Customer', 'Stage', 'Status', 'Start', 'Target End',
      'Engineers', 'Vendor', 'Checklist', 'Points Done', 'Total Points', 'Approved Points', 'Timeline Set',
      'Overdue Points', 'Max Delay (days)', 'Last Action', 'Last Action Date', 'Next Action', 'Next Action Date',
      'Material Pending Return', 'Payment Received', 'Payment Pending',
    ]
  );
  assert.equal(parseCsvLine(header).length, 26);
  const cells = parseCsvLine(row);
  assert.equal(cells[0], '36002'); // SO No
  assert.equal(cells[1], 'Tower Chiller Plant'); // Project
  assert.equal(cells[2], 'HVAC'); // Division
  assert.equal(cells[6], 'Piping'); // Stage
  assert.equal(cells[7], 'Ongoing'); // Status
  assert.equal(cells[9], '2026-02-10'); // Target End: latest checklist targetDate across ALL points (max date, not max-by-array-order)
  assert.equal(cells[10], 'Deepak Engineer, Santosh Engineer'); // Engineers
  assert.equal(cells[11], 'Rajiudeen'); // Vendor
  assert.equal(cells[12], 'Standard HVAC Checklist'); // Checklist
  assert.equal(cells[13], '2'); // Points Done (2 of 3 done)
  assert.equal(cells[14], '3'); // Total Points
  assert.equal(cells[15], '1'); // Approved Points (only the client-approved one)
  assert.equal(cells[16], 'Yes'); // Timeline Set
  assert.equal(cells[17], '1'); // Overdue Points (only "Piping", targetDate 2020, not done)
  assert.ok(Number(cells[18]) > 1000); // Max Delay (days) — large, since target date is in 2020
  assert.equal(cells[19], 'Piping in progress'); // Last Action (from the LAST executionUpdates entry)
  assert.equal(cells[20], '2026-08-01'); // Last Action Date
  assert.equal(cells[21], 'Complete piping'); // Next Action
  assert.equal(cells[22], '2026-09-01'); // Next Action Date
  assert.equal(cells[23], '70'); // Material Pending Return: 100-30 returnable, 20kg non-returnable excluded
  assert.equal(cells[24], '150000'); // Payment Received: 100000 (flagged) + 50000 (ledger) reconciled
  assert.equal(cells[25], '150000'); // Payment Pending: 300000 total - 150000 received
});

test('FIX-6-07 — role gate: admin/hvac_pm/solar_pm/mep_pm may export; every other role is rejected server-side (not just hidden by the frontend menu)', async () => {
  const store = richProjectFixtureStore();
  for (const role of ['admin', 'hvac_pm', 'solar_pm', 'mep_pm']) {
    const csv = await service.exportProjectsCsv(auth({ role }), {}, store);
    assert.match(csv, /PROJECT LIST/);
  }
  for (const role of ['sales', 'finance', 'engineer', 'service_mgr', 'service_eng', 'inventory', 'super']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      () => service.exportProjectsCsv(auth({ role }), {}, store),
      (err) => err.code === 'FORBIDDEN',
      `role "${role}" must be rejected server-side`
    );
  }
});

test('FIX-6-07 — division scoping preserved: a PM role only sees their own division\'s rows in the export (myDiv/hasDiv, unchanged)', async () => {
  const store = richProjectFixtureStore(); // proj1 is HVAC
  const csvSolar = await service.exportProjectsCsv(auth({ role: 'solar_pm' }), {}, store);
  const bodyLinesSolar = csvSolar.split('\n').slice(3).filter(Boolean);
  assert.equal(bodyLinesSolar.length, 0, 'a solar_pm must not see the HVAC project row');

  const csvHvac = await service.exportProjectsCsv(auth({ role: 'hvac_pm' }), {}, store);
  const bodyLinesHvac = csvHvac.split('\n').slice(3).filter(Boolean);
  assert.equal(bodyLinesHvac.length, 1);
});

test('FIX-6-07 — tenant isolation: a company\'s export never includes another company\'s projects', async () => {
  const store = richProjectFixtureStore();
  store.state.projects.push({ ...store.state.projects[0], id: 'proj2', companyId: 'co2', name: 'Other Co Project' });
  const csv = await service.exportProjectsCsv(auth({ role: 'admin' }), {}, store);
  assert.ok(!csv.includes('Other Co Project'));
});
