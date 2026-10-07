'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDelayCheckScheduler } = require('../src/jobs/delayCheckScheduler');
const { createEnquiryFakeStore } = require('./enquiryFakes');

function project(overrides) {
  return {
    id: 'proj1', companyId: 'co1', salesOrderId: null, division: 'HVAC', name: 'Tower Chiller Plant',
    siteType: '', capacity: '', customer: 'Ravi', stage: 'Piping',
    startDate: new Date('2026-01-01'), endDate: new Date('2026-01-01'),
    assignedEngineerIds: [], vendor: '', status: 'Ongoing', checklistTemplateName: 'Standard HVAC',
    checklist: [], executionUpdates: [], deliveryChallans: [], timelineSet: true, lastDelayNotifiedDate: null,
    ...overrides,
  };
}

function overdueChk(overrides) {
  return {
    text: 'Overdue point', signResponsibility: 'ENGINEER', done: false, completedDate: null, pmSigned: false,
    remark: '', photos: [], targetDate: new Date('2020-01-01'), approval: null, ...overrides,
  };
}

test('scheduler tick — reaches every eligible (Ongoing + timelineReady) project across companies and creates the delay notification', async () => {
  const store = createEnquiryFakeStore({
    projects: [
      project({ id: 'p1', companyId: 'co1', checklist: [overdueChk()] }),
      project({ id: 'p2', companyId: 'co2', division: 'Solar', name: 'Solar Rooftop Array', checklist: [overdueChk()] }),
      project({ id: 'p3', companyId: 'co1', status: 'Completed', checklist: [overdueChk()] }), // ineligible: not Ongoing
      project({ id: 'p4', companyId: 'co1', timelineSet: false, checklist: [overdueChk()] }), // ineligible: timeline not ready
      project({ id: 'p5', companyId: 'co1', checklist: [] }), // eligible but no overdue points -> no notification
    ],
  });
  const scheduler = createDelayCheckScheduler(store);
  const summary = await scheduler.tick();

  assert.equal(summary.checked, 3, 'only Ongoing+timelineSet projects are candidates (p1, p2, p5 — p3, p4 excluded)');
  assert.equal(summary.notified, 2, 'p1 and p2 have an overdue point; p5 has none');
  assert.equal(summary.errors, 0);

  const p1 = await store.projectRepo.findById('co1', 'p1');
  assert.ok(p1.lastDelayNotifiedDate, 'throttle field set after a successful notify');
  const p1Notifs = store.state.notifications.filter((n) => /Tower Chiller Plant/.test(n.text));
  assert.equal(p1Notifs.length, 1);
});

test('scheduler tick — once-per-day throttle holds even under a SIMULATED overlapping run (two ticks fired back-to-back without awaiting the first)', async () => {
  const store = createEnquiryFakeStore({
    projects: [project({ id: 'p1', companyId: 'co1', checklist: [overdueChk()] })],
  });
  const scheduler = createDelayCheckScheduler(store);

  // Fire two ticks without awaiting the first (simulated overlap) — the
  // in-process `running` guard makes the second call a same-run no-op that
  // returns the in-flight/last summary rather than re-processing.
  const [a, b] = await Promise.all([scheduler.tick(), scheduler.tick()]);
  const notifsAfterOverlap = store.state.notifications.filter((n) => /Tower Chiller Plant/.test(n.text));
  assert.equal(notifsAfterOverlap.length, 1, 'no duplicate same-day notification from the overlapping call');

  // A third, later (non-overlapping) tick the SAME day must also be a no-op
  // because runDelayCheckForProject's own throttle re-checks lastDelayNotifiedDate===today.
  const summary2 = await scheduler.tick();
  assert.equal(summary2.notified, 0, 'same-day re-tick notifies nobody again — per-project throttle holds');
  const notifsAfterThirdTick = store.state.notifications.filter((n) => /Tower Chiller Plant/.test(n.text));
  assert.equal(notifsAfterThirdTick.length, 1);
});

test('scheduler tick — overdue detection and notification content match runDelayCheckForProject (worst delay, named first-late point)', async () => {
  const store = createEnquiryFakeStore({
    projects: [
      project({
        id: 'p1',
        checklist: [
          overdueChk({ text: 'Point A', targetDate: new Date('2026-01-01') }),
          overdueChk({ text: 'Point B (worse)', targetDate: new Date('2020-01-01') }),
        ],
      }),
    ],
  });
  const scheduler = createDelayCheckScheduler(store);
  await scheduler.tick();
  const n = store.state.notifications.find((x) => /PROJECT DELAYED/.test(x.text));
  assert.ok(n);
  assert.match(n.text, /2 checklist point\(s\)/);
  assert.match(n.text, /Latest pending: Point A/, 'named point is the FIRST late item in array order, not necessarily the worst (PWA quirk, preserved)');
});

test('scheduler start/stop — wires a periodic interval without keeping the process alive (unref) and can be stopped', () => {
  const store = createEnquiryFakeStore({});
  const scheduler = createDelayCheckScheduler(store, { intervalMs: 3600000 });
  scheduler.start();
  scheduler.stop();
  // no assertion beyond "does not throw" — this is a smoke test for the
  // start/stop wiring used by src/app.js / src/server.js at bootstrap.
  assert.equal(typeof scheduler.tick, 'function');
});
