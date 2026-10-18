'use strict';

const { ServiceError } = require('../errors');

const ASSIGNER_ROLES = ['admin', 'service_mgr'];
const ASSIGNEE_ROLES = ['engineer', 'service_eng'];

function assertCompany(auth) {
  if (!auth?.companyId) throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
}

function assertAssigner(auth) {
  if (!ASSIGNER_ROLES.includes(auth.role)) {
    throw new ServiceError('Only a company admin or service manager can assign tasks.', 'FORBIDDEN', 403);
  }
}

function dateFromDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ServiceError('Choose a valid task date.', 'VALIDATION_ERROR', 400);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new ServiceError('Choose a valid task date.', 'VALIDATION_ERROR', 400);
  }
  return date;
}

async function listDailyTasks(auth, { date } = {}, deps) {
  assertCompany(auth);
  const query = {};
  if (date) query.taskDate = dateFromDay(date);
  if (['engineer', 'service_eng'].includes(auth.role)) {
    query.assigneeUserId = auth.userId;
    query.taskDate = dateFromDay(date || new Date().toISOString().slice(0, 10));
  } else if (!ASSIGNER_ROLES.includes(auth.role)) {
    throw new ServiceError('This account cannot view daily tasks.', 'FORBIDDEN', 403);
  }
  return deps.dailyTaskRepo.listByCompany(auth.companyId, query);
}

async function listAssignees(auth, deps) {
  assertCompany(auth);
  assertAssigner(auth);
  const users = await deps.userWriteRepo.listByCompany(auth.companyId);
  return users
    .filter((user) => user.active !== false && ASSIGNEE_ROLES.includes(user.role))
    .map(({ id, name, role }) => ({ id, name, role }));
}

async function createDailyTask(input, auth, deps) {
  assertCompany(auth);
  assertAssigner(auth);
  const title = String(input?.title || '').trim();
  const description = String(input?.description || '').trim();
  if (!title || title.length > 160) {
    throw new ServiceError('Task title is required and must be 160 characters or fewer.', 'VALIDATION_ERROR', 400);
  }
  if (description.length > 4000) {
    throw new ServiceError('Task description must be 4,000 characters or fewer.', 'VALIDATION_ERROR', 400);
  }
  const assignee = await deps.userRepo.findById(input?.assigneeUserId);
  if (!assignee || assignee.active === false || String(assignee.companyId) !== String(auth.companyId) || !ASSIGNEE_ROLES.includes(assignee.role)) {
    throw new ServiceError('Select an active engineer or service engineer in your company.', 'VALIDATION_ERROR', 400);
  }
  const assigner = await deps.userRepo.findById(auth.userId);
  return deps.dailyTaskRepo.create({
    companyId: auth.companyId,
    title,
    description,
    taskDate: dateFromDay(input?.taskDate || new Date().toISOString().slice(0, 10)),
    assignedByUserId: auth.userId,
    assignedByName: assigner?.name || 'Company admin',
    assigneeUserId: assignee.id,
    assigneeName: assignee.name,
    assigneeRole: assignee.role,
    status: 'Assigned',
    submittedAt: null,
    approvedAt: null,
    approvedByUserId: null,
    approvedByName: null,
  });
}

async function submitDailyTask(taskId, auth, deps) {
  assertCompany(auth);
  if (!ASSIGNEE_ROLES.includes(auth.role)) {
    throw new ServiceError('Only the assigned engineer can submit a task for review.', 'FORBIDDEN', 403);
  }
  const task = await deps.dailyTaskRepo.findById(auth.companyId, taskId);
  if (!task) throw new ServiceError('Task not found.', 'NOT_FOUND', 404);
  if (String(task.assigneeUserId) !== String(auth.userId)) {
    throw new ServiceError('You can submit only tasks assigned to you.', 'FORBIDDEN', 403);
  }
  if (task.status !== 'Assigned') {
    throw new ServiceError('This task has already been submitted or approved.', 'INVALID_STATE', 409);
  }
  const updated = await deps.dailyTaskRepo.transition(auth.companyId, taskId, 'Assigned', {
    status: 'AwaitingReview',
    submittedAt: new Date(),
  });
  if (!updated) throw new ServiceError('This task changed. Refresh and try again.', 'INVALID_STATE', 409);
  await deps.notificationRepo.create({
    companyId: auth.companyId,
    text: `${task.assigneeName} submitted "${task.title}" for completion review.`,
    date: new Date(),
    targetRoles: ['service_mgr'],
    readByUserIds: [],
  });
  return updated;
}

async function approveDailyTask(taskId, auth, deps) {
  assertCompany(auth);
  if (auth.role !== 'service_mgr') {
    throw new ServiceError('Only a service manager can approve completed tasks.', 'FORBIDDEN', 403);
  }
  const task = await deps.dailyTaskRepo.findById(auth.companyId, taskId);
  if (!task) throw new ServiceError('Task not found.', 'NOT_FOUND', 404);
  if (task.status !== 'AwaitingReview') {
    throw new ServiceError('Only tasks awaiting review can be approved.', 'INVALID_STATE', 409);
  }
  const manager = await deps.userRepo.findById(auth.userId);
  const updated = await deps.dailyTaskRepo.transition(auth.companyId, taskId, 'AwaitingReview', {
    status: 'Approved',
    approvedAt: new Date(),
    approvedByUserId: auth.userId,
    approvedByName: manager?.name || 'Service manager',
  });
  if (!updated) throw new ServiceError('This task changed. Refresh and try again.', 'INVALID_STATE', 409);
  return updated;
}

module.exports = { listDailyTasks, listAssignees, createDailyTask, submitDailyTask, approveDailyTask };
