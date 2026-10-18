'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/dailyTaskService');

function setup() {
  const users = [
    { id: 'admin1', name: 'Company Admin', role: 'admin', companyId: 'co1', active: true },
    { id: 'mgr1', name: 'Service Manager', role: 'service_mgr', companyId: 'co1', active: true },
    { id: 'eng1', name: 'Engineer One', role: 'engineer', companyId: 'co1', active: true },
    { id: 'eng2', name: 'Engineer Two', role: 'service_eng', companyId: 'co1', active: true },
    { id: 'other', name: 'Other Tenant', role: 'engineer', companyId: 'co2', active: true },
    { id: 'inactive', name: 'Inactive Engineer', role: 'engineer', companyId: 'co1', active: false },
  ];
  const tasks = [];
  const notifications = [];
  let nextId = 0;
  const deps = {
    userRepo: { findById: async (id) => users.find((user) => user.id === id) || null },
    userWriteRepo: { listByCompany: async (companyId) => users.filter((user) => user.companyId === companyId) },
    dailyTaskRepo: {
      async create(data) {
        const task = { ...data, id: `task${++nextId}` };
        tasks.push(task);
        return task;
      },
      async findById(companyId, id) {
        return tasks.find((task) => task.companyId === companyId && task.id === id) || null;
      },
      async listByCompany(companyId, filters) {
        return tasks.filter((task) => task.companyId === companyId
          && (!filters.assigneeUserId || task.assigneeUserId === filters.assigneeUserId)
          && (!filters.taskDate || task.taskDate.getTime() === filters.taskDate.getTime()));
      },
      async transition(companyId, id, expectedStatus, patch) {
        const task = tasks.find((item) => item.companyId === companyId && item.id === id && item.status === expectedStatus);
        if (!task) return null;
        Object.assign(task, patch);
        return task;
      },
    },
    notificationRepo: { create: async (entry) => { notifications.push(entry); return entry; } },
  };
  return { deps, tasks, notifications };
}

test('company admin and service manager can assign dated tasks to company engineers', async () => {
  const { deps } = setup();
  const task = await service.createDailyTask(
    { title: 'Inspect unit', description: 'Check filter', taskDate: '2026-10-20', assigneeUserId: 'eng1' },
    { userId: 'admin1', companyId: 'co1', role: 'admin' },
    deps
  );
  assert.equal(task.status, 'Assigned');
  assert.equal(task.assignedByName, 'Company Admin');
  assert.equal(task.assigneeRole, 'engineer');
  assert.equal(task.taskDate.toISOString(), '2026-10-20T00:00:00.000Z');
});

test('task assignment rejects non-managers, other-company users, inactive users, and invalid dates', async () => {
  const { deps } = setup();
  await assert.rejects(
    service.createDailyTask({ title: 'Inspect', assigneeUserId: 'eng1' }, { userId: 'eng1', companyId: 'co1', role: 'engineer' }, deps),
    { code: 'FORBIDDEN' }
  );
  for (const assigneeUserId of ['other', 'inactive']) {
    await assert.rejects(
      service.createDailyTask({ title: 'Inspect', assigneeUserId }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps),
      { code: 'VALIDATION_ERROR' }
    );
  }
  await assert.rejects(
    service.createDailyTask({ title: 'Inspect', assigneeUserId: 'eng1', taskDate: 'yesterday' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps),
    { code: 'VALIDATION_ERROR' }
  );
});

test('engineers see only their tasks for the selected work date', async () => {
  const { deps } = setup();
  await service.createDailyTask({ title: 'Today', taskDate: '2026-10-20', assigneeUserId: 'eng1' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  await service.createDailyTask({ title: 'Other engineer', taskDate: '2026-10-20', assigneeUserId: 'eng2' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  await service.createDailyTask({ title: 'Another date', taskDate: '2026-10-21', assigneeUserId: 'eng1' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  const result = await service.listDailyTasks({ userId: 'eng1', companyId: 'co1', role: 'engineer' }, { date: '2026-10-20' }, deps);
  assert.deepEqual(result.map((task) => task.title), ['Today']);
});

test('assigned engineer submits completion and notifies service managers for review', async () => {
  const { deps, notifications } = setup();
  const task = await service.createDailyTask({ title: 'Inspect', taskDate: '2026-10-20', assigneeUserId: 'eng1' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  const updated = await service.submitDailyTask(task.id, { userId: 'eng1', companyId: 'co1', role: 'engineer' }, deps);
  assert.equal(updated.status, 'AwaitingReview');
  assert.ok(updated.submittedAt instanceof Date);
  assert.deepEqual(notifications[0].targetRoles, ['service_mgr']);
  assert.match(notifications[0].text, /submitted "Inspect" for completion review/);
});

test('only the assigned engineer can submit a task for review', async () => {
  const { deps } = setup();
  const task = await service.createDailyTask({ title: 'Inspect', assigneeUserId: 'eng1' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  await assert.rejects(
    service.submitDailyTask(task.id, { userId: 'eng2', companyId: 'co1', role: 'service_eng' }, deps),
    { code: 'FORBIDDEN' }
  );
});

test('only a service manager can approve a submitted completion and it is recorded', async () => {
  const { deps } = setup();
  const task = await service.createDailyTask({ title: 'Inspect', assigneeUserId: 'eng1' }, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps);
  await service.submitDailyTask(task.id, { userId: 'eng1', companyId: 'co1', role: 'engineer' }, deps);
  await assert.rejects(
    service.approveDailyTask(task.id, { userId: 'admin1', companyId: 'co1', role: 'admin' }, deps),
    { code: 'FORBIDDEN' }
  );
  const approved = await service.approveDailyTask(task.id, { userId: 'mgr1', companyId: 'co1', role: 'service_mgr' }, deps);
  assert.equal(approved.status, 'Approved');
  assert.equal(approved.approvedByUserId, 'mgr1');
  assert.equal(approved.approvedByName, 'Service Manager');
  assert.ok(approved.approvedAt instanceof Date);
});
