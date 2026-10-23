'use strict';

/**
 * Phone push notifications (owner decision 21 Oct 2026). In-memory fakes and
 * a fake Expo endpoint -- nothing is sent anywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const push = require('../src/services/pushService');
const serviceCallService = require('../src/services/serviceCallService');
const { createEnquiryFakeStore } = require('./enquiryFakes');
const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');

const TOK = (n) => `ExponentPushToken[device-${String(n).padStart(4, '0')}abcdef]`;

function store() {
  return createEnquiryFakeStore({
    companies: [{ id: 'co1', name: 'Co One', divisions: ['HVAC'], status: 'Active' }, { id: 'co2', name: 'Co Two', divisions: ['HVAC'], status: 'Active' }],
    users: [
      { id: 'adm', companyId: 'co1', role: 'admin', name: 'Admin' },
      { id: 'mgr', companyId: 'co1', role: 'service_mgr', name: 'Manager' },
      { id: 'eng1', companyId: 'co1', role: 'service_eng', name: 'Israr' },
      { id: 'eng2', companyId: 'co1', role: 'service_eng', name: 'Rahul' },
      { id: 'fin', companyId: 'co1', role: 'finance', name: 'Finance' },
      { id: 'other', companyId: 'co2', role: 'admin', name: 'Other Co Admin' },
    ],
  });
}
const auth = (userId, role, companyId = 'co1') => ({ userId, role, companyId, name: userId });

function fakeExpo(responses = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const batch = JSON.parse(opts.body);
    calls.push({ url, batch });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: batch.map((m) => responses[m.to] || { status: 'ok', id: 'r' }) }),
    };
  };
  return { calls, fetchImpl };
}
const quiet = { warn() {} };

test('registerDevice / unregisterDevice — validates tokens, binds the phone to the logged-in user, moves on re-login', async () => {
  const s = store();
  await assert.rejects(() => push.registerDevice({ token: 'not-a-token' }, auth('eng1', 'service_eng'), s), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => push.registerDevice({ token: TOK(1) }, { userId: 'root', role: 'super', companyId: null }, s), (e) => e.code === 'COMPANY_CONTEXT_REQUIRED');
  await push.registerDevice({ token: TOK(1), platform: 'android' }, auth('eng1', 'service_eng'), s);
  assert.deepEqual(s.state.pushDevices.map((d) => [d.token, d.userId]), [[TOK(1), 'eng1']]);
  // Same phone, another user logs in -> the phone now belongs to them.
  await push.registerDevice({ token: TOK(1) }, auth('eng2', 'service_eng'), s);
  assert.deepEqual(s.state.pushDevices.map((d) => [d.token, d.userId]), [[TOK(1), 'eng2']]);
  // Someone else cannot unregister it; the owner can.
  assert.equal((await push.unregisterDevice({ token: TOK(1) }, auth('eng1', 'service_eng'), s)).removed, false);
  assert.equal((await push.unregisterDevice({ token: TOK(1) }, auth('eng2', 'service_eng'), s)).removed, true);
  assert.equal(s.state.pushDevices.length, 0);
});

test('resolveRecipientIds — roles, named users, "*" without names pushes nobody, never another company', async () => {
  const s = store();
  const n = (targetRoles) => ({ companyId: 'co1', text: 'x', targetRoles });
  assert.deepEqual((await push.resolveRecipientIds(n(['service_mgr', 'admin']), undefined, s)).sort(), ['adm', 'mgr']);
  assert.deepEqual(await push.resolveRecipientIds(n(['*']), undefined, s), []);
  assert.deepEqual(await push.resolveRecipientIds(n(['*']), { userIds: ['eng1'] }, s), ['eng1']);
  assert.deepEqual((await push.resolveRecipientIds(n(['*']), { roles: ['finance', 'admin'] }, s)).sort(), ['adm', 'fin']);
  assert.deepEqual(await push.resolveRecipientIds(n(['*']), { userIds: ['other', 'ghost'] }, s), []);
});

test('deliverNotification — sends to registered phones in batches of 100 and drops phones Expo no longer knows', async () => {
  const s = store();
  await push.registerDevice({ token: TOK(1) }, auth('adm', 'admin'), s);
  await push.registerDevice({ token: TOK(2) }, auth('mgr', 'service_mgr'), s);
  await push.registerDevice({ token: TOK(3) }, auth('eng1', 'service_eng'), s);
  const { calls, fetchImpl } = fakeExpo({ [TOK(2)]: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } });
  const r = await push.deliverNotification({ id: 'n1', companyId: 'co1', text: 'New complaint registered: PSC-3', targetRoles: ['service_mgr', 'admin'] }, { path: '/service-calls/9' }, s, { fetchImpl, logger: quiet });
  assert.deepEqual(r, { sent: 1, removed: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, push.EXPO_PUSH_URL);
  const m = calls[0].batch.find((x) => x.to === TOK(1));
  assert.deepEqual(
    { title: m.title, body: m.body, path: m.data.path, channelId: m.channelId, sound: m.sound, priority: m.priority },
    { title: 'MEP PROJECTS', body: 'New complaint registered: PSC-3', path: '/service-calls/9', channelId: 'default', sound: 'default', priority: 'high' }
  );
  assert.ok(!calls[0].batch.some((x) => x.to === TOK(3)), 'engineer not targeted');
  assert.deepEqual(s.state.pushDevices.map((d) => d.token).sort(), [TOK(1), TOK(3)]);

  // 250 phones -> 3 requests.
  for (let i = 10; i < 260; i += 1) s.state.pushDevices.push({ token: TOK(i), userId: 'fin', companyId: 'co1' });
  const many = fakeExpo();
  const r2 = await push.deliverNotification({ id: 'n2', companyId: 'co1', text: 'pay', targetRoles: ['finance'] }, undefined, s, { fetchImpl: many.fetchImpl, logger: quiet });
  assert.equal(r2.sent, 250);
  assert.deepEqual(many.calls.map((c) => c.batch.length), [100, 100, 50]);
  assert.equal(many.calls[0].batch[0].data.path, '/notifications');
});

test('deliverNotification — an unreachable push service never throws', async () => {
  const s = store();
  await push.registerDevice({ token: TOK(1) }, auth('adm', 'admin'), s);
  const r = await push.deliverNotification({ id: 'n', companyId: 'co1', text: 't', targetRoles: ['admin'] }, undefined, s, {
    fetchImpl: async () => { throw new Error('offline'); }, logger: quiet,
  });
  assert.deepEqual(r, { sent: 0, removed: 0 });
});

test('withPushNotifications — strips `push` before saving, pushes only if the notification still exists', async () => {
  const s = store();
  await push.registerDevice({ token: TOK(1) }, auth('eng1', 'service_eng'), s);
  const { calls, fetchImpl } = fakeExpo();
  const jobs = [];
  const repo = push.withPushNotifications(s.notificationRepo, s, { fetchImpl, logger: quiet, schedule: (fn) => jobs.push(fn) });
  const doc = await repo.create({ companyId: 'co1', text: 'assigned', date: new Date(), targetRoles: ['*'], readByUserIds: [], push: { userIds: ['eng1'], path: '/service-calls/1' } });
  assert.equal('push' in s.state.notifications.find((x) => x.id === doc.id), false);
  await jobs[0]();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].batch[0].to, TOK(1));
  // A rolled-back save (notification gone) does not push.
  const doc2 = await repo.create({ companyId: 'co1', text: 'rolled back', date: new Date(), targetRoles: ['*'], readByUserIds: [], push: { userIds: ['eng1'] } });
  s.state.notifications = s.state.notifications.filter((x) => x.id !== doc2.id);
  await jobs[1]();
  assert.equal(calls.length, 1);
});

test('service call assignment pushes only the assigned engineer, to the call page', async () => {
  const s = store();
  await push.registerDevice({ token: TOK(1) }, auth('eng1', 'service_eng'), s);
  await push.registerDevice({ token: TOK(2) }, auth('eng2', 'service_eng'), s);
  const { calls, fetchImpl } = fakeExpo();
  const jobs = [];
  const deps = { ...s, notificationRepo: push.withPushNotifications(s.notificationRepo, s, { fetchImpl, logger: quiet, schedule: (fn) => jobs.push(fn) }) };
  const { serviceCall } = await serviceCallService.registerComplaint({ customer: 'Priya' }, auth('mgr', 'service_mgr'), deps);
  await serviceCallService.assignEngineer(serviceCall.id, { engineerId: 'eng1' }, auth('mgr', 'service_mgr'), deps);
  for (const j of jobs) await j(); // eslint-disable-line no-await-in-loop
  const toEngineers = calls.flatMap((c) => c.batch).filter((m) => m.to === TOK(1) || m.to === TOK(2));
  assert.equal(toEngineers.length, 1);
  assert.equal(toEngineers[0].to, TOK(1));
  assert.match(toEngineers[0].body, /assigned to Israr/);
  assert.equal(toEngineers[0].data.path, `/service-calls/${serviceCall.id}`);
});

test('HTTP — /api/push-devices needs a login and accepts a valid token', async () => {
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;
  state.companies.push({ id: 'coA', name: 'Alpha', divisions: ['HVAC'], status: 'Active', subscriptionRate: 1, subscriptionCycle: 'Monthly', subscriptionStart: new Date('2026-01-01'), since: new Date('2026-01-01') });
  state.users.push({ id: 'uA', companyId: 'coA', username: 'eng', name: 'Eng', role: 'service_eng', passwordHash: await hashPassword('pw-123456'), active: true });
  const app = createDevApp(deps, { authTokenSecret: 'push-test-secret', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = JSON.stringify({ token: TOK(7), platform: 'android' });
    assert.equal((await fetch(`${base}/api/push-devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
    const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'eng', password: 'pw-123456' }) })).json();
    const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/push-devices`, { method: 'POST', headers: H, body: JSON.stringify({ token: 'bad' }) })).status, 400);
    const ok = await fetch(`${base}/api/push-devices`, { method: 'POST', headers: H, body });
    assert.equal(ok.status, 200);
    assert.deepEqual(state.pushDevices.map((d) => [d.token, d.userId]), [[TOK(7), 'uA']]);
    const del = await fetch(`${base}/api/push-devices`, { method: 'DELETE', headers: H, body: JSON.stringify({ token: TOK(7) }) });
    assert.deepEqual(await del.json(), { removed: true });
  } finally {
    server.close();
  }
});
