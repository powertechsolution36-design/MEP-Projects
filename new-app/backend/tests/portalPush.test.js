'use strict';

/**
 * Notifications to the customer app (owner decision, 31 Oct 2026).
 *
 * The questions worth asking of a notification feature are mostly about what
 * it must NOT do, so that is most of what is here:
 *   · it is off, and behaves well, until somebody configures a key pair;
 *   · a client subscribes themselves and nobody else, to their own contract;
 *   · knowing another client's endpoint does not let you switch theirs off;
 *   · a client is only ever told about their own complaint;
 *   · a push service having a bad day never fails the engineer's work.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { normalizePhone, resetRateLimits } = require('../src/services/portalAuthService');
const portalPush = require('../src/services/portalPushService');

const PW = 'pw-123456';
const CUSTOMER_PW = 'client-password-1';
const KEYS = webpush.generateVAPIDKeys();

/** A subscription shaped exactly as a browser mints one. */
const subscriptionFor = (name) => ({
  endpoint: `https://push.example.com/send/${name}`,
  keys: { p256dh: 'BG9Zc5p8x1eF4oT0cQmQ0GQ0tO0nHq3QJ0oVY4Yr1eE=', auth: 'k9Zc5p8x1eF4oT0cQmQ0Gg==' },
});

function withKeys(fn) {
  return async (...args) => {
    const before = { pub: process.env.WEB_PUSH_PUBLIC_KEY, priv: process.env.WEB_PUSH_PRIVATE_KEY };
    process.env.WEB_PUSH_PUBLIC_KEY = KEYS.publicKey;
    process.env.WEB_PUSH_PRIVATE_KEY = KEYS.privateKey;
    portalPush.resetConfigCache();
    try {
      return await fn(...args);
    } finally {
      if (before.pub === undefined) delete process.env.WEB_PUSH_PUBLIC_KEY; else process.env.WEB_PUSH_PUBLIC_KEY = before.pub;
      if (before.priv === undefined) delete process.env.WEB_PUSH_PRIVATE_KEY; else process.env.WEB_PUSH_PRIVATE_KEY = before.priv;
      portalPush.resetConfigCache();
    }
  };
}

async function harness() {
  resetRateLimits();
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;

  const mk = (id, name) => ({
    id, name, divisions: ['HVAC'], status: 'Active',
    subscriptionRate: 1, subscriptionCycle: 'Monthly',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  });
  state.companies.push(mk('coA', 'Alpha'), mk('coB', 'Beta'));

  const pw = await hashPassword(PW);
  state.users.push(
    { id: 'uMgr', companyId: 'coA', username: 'mgr', name: 'Rahul Manager', role: 'service_mgr', passwordHash: pw, active: true },
    { id: 'uEng', companyId: 'coA', username: 'eng', name: 'Vinod Engineer', role: 'engineer', passwordHash: pw, active: true }
  );
  state.contracts.push(
    { id: 'ctrA1', companyId: 'coA', customer: 'Intervalve Poonawalla', phone: '9422011111', site: 'KP87 plant', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 150000, scheduledVisits: [] },
    { id: 'ctrA2', companyId: 'coA', customer: 'Moto Central', phone: '9422022222', site: 'Navapeth', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 53400, scheduledVisits: [] }
  );

  // Everything that would otherwise be a network call to a push service.
  // Indirect on purpose: createDevApp copies deps, so a test that wants the
  // push service to misbehave has to change the behaviour, not the function.
  const outbox = [];
  let behaviour = async (device, payload) => { outbox.push({ endpoint: device.endpoint, payload: JSON.parse(payload) }); };
  const setSender = (fn) => { behaviour = fn; };
  deps.webPushSender = (device, payload) => behaviour(device, payload);

  const app = createDevApp(deps, { authTokenSecret: 'portal-push-secret', authTokenExpiry: '1h', port: 0 });
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    const text = await res.text();
    if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
    return { status: res.status, json };
  };
  const staffToken = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).json.token;

  async function activeClient({ phone = '9422011111', name = 'Mr Poonawalla', contractId } = {}) {
    await call('POST', '/api/portal/auth/register', { body: { name, phone, password: CUSTOMER_PW } });
    const mgr = await staffToken('mgr');
    const list = await call('GET', '/api/customer-accounts', { token: mgr });
    const acct = list.json.accounts.find((a) => a.phone === normalizePhone(phone));
    await call('POST', `/api/customer-accounts/${acct.id}/approve`, { token: mgr, body: contractId ? { contractId } : {} });
    const login = await call('POST', '/api/portal/auth/login', { body: { phone, password: CUSTOMER_PW } });
    return { accountId: acct.id, token: login.json.token };
  }

  return { deps, state, server, call, staffToken, activeClient, outbox, setSender };
}

/* ---------------- unconfigured ---------------- */

test('push: with no keys configured the app is told plainly, and nothing is stored', async () => {
  const before = process.env.WEB_PUSH_PUBLIC_KEY;
  delete process.env.WEB_PUSH_PUBLIC_KEY;
  portalPush.resetConfigCache();
  const h = await harness();
  try {
    const client = await h.activeClient();
    const key = await h.call('GET', '/api/portal/push/key', { token: client.token });
    assert.equal(key.status, 200);
    assert.equal(key.json.enabled, false);
    assert.equal(key.json.publicKey, '');

    const sub = await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('a') });
    assert.equal(sub.json.subscribed, false);
    assert.equal(sub.json.reason, 'NOT_CONFIGURED');
    assert.equal(h.state.portalPushSubscriptions.length, 0, 'nothing is kept that could never be sent to');
  } finally {
    h.server.close();
    if (before === undefined) delete process.env.WEB_PUSH_PUBLIC_KEY; else process.env.WEB_PUSH_PUBLIC_KEY = before;
    portalPush.resetConfigCache();
  }
});

test('push: half a key pair is not half a feature', () => {
  portalPush.resetConfigCache();
  assert.equal(portalPush.isConfigured({ WEB_PUSH_PUBLIC_KEY: KEYS.publicKey }), false);
  portalPush.resetConfigCache();
  assert.equal(portalPush.isConfigured({ WEB_PUSH_PRIVATE_KEY: KEYS.privateKey }), false);
  portalPush.resetConfigCache();
  assert.equal(portalPush.isConfigured({ WEB_PUSH_PUBLIC_KEY: KEYS.publicKey, WEB_PUSH_PRIVATE_KEY: KEYS.privateKey }), true);
  portalPush.resetConfigCache();
});

/* ---------------- subscribing ---------------- */

test('push: a client subscribes their own device, to their own contract', withKeys(async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const key = await h.call('GET', '/api/portal/push/key', { token: client.token });
    assert.equal(key.json.enabled, true);
    assert.equal(key.json.publicKey, KEYS.publicKey);

    const res = await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('phone') });
    assert.equal(res.json.subscribed, true);

    assert.equal(h.state.portalPushSubscriptions.length, 1);
    const row = h.state.portalPushSubscriptions[0];
    assert.equal(String(row.companyId), 'coA', 'the company comes from the session');
    assert.equal(String(row.contractId), 'ctrA1', 'and so does the contract');
    assert.equal(String(row.customerAccountId), String(client.accountId));

    // The same browser subscribing again is the same device, not a second one.
    await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('phone') });
    assert.equal(h.state.portalPushSubscriptions.length, 1);
  } finally { h.server.close(); }
}));

test('push: a subscription that is not one is refused', withKeys(async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const bad = [
      {},
      { endpoint: 'http://push.example.com/send/x', keys: { p256dh: 'a', auth: 'b' } }, // not https
      { endpoint: 'https://push.example.com/send/x' }, // no keys
      { endpoint: 'not a url', keys: { p256dh: 'a', auth: 'b' } },
    ];
    for (const body of bad) {
      // eslint-disable-next-line no-await-in-loop
      const res = await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(h.state.portalPushSubscriptions.length, 0);
  } finally { h.server.close(); }
}));

test('push: knowing another client’s endpoint does not switch their notifications off', withKeys(async () => {
  const h = await harness();
  try {
    const one = await h.activeClient({ phone: '9422011111', name: 'Mr Poonawalla' });
    await h.call('POST', '/api/portal/push/subscribe', { token: one.token, body: subscriptionFor('victim') });

    const two = await h.activeClient({ phone: '9422022222', name: 'Moto Central' });
    const attempt = await h.call('POST', '/api/portal/push/unsubscribe', {
      token: two.token, body: { endpoint: subscriptionFor('victim').endpoint },
    });
    assert.equal(attempt.json.removed, false);
    assert.equal(h.state.portalPushSubscriptions.length, 1, 'the other client’s device is untouched');

    const own = await h.call('POST', '/api/portal/push/unsubscribe', {
      token: one.token, body: { endpoint: subscriptionFor('victim').endpoint },
    });
    assert.equal(own.json.removed, true);
    assert.equal(h.state.portalPushSubscriptions.length, 0);
  } finally { h.server.close(); }
}));

test('push: a stranger cannot even ask for the key', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('GET', '/api/portal/push/key')).status, 401);
    assert.equal((await h.call('POST', '/api/portal/push/subscribe', { body: subscriptionFor('x') })).status, 401);
  } finally { h.server.close(); }
});

/* ---------------- sending ---------------- */

test('push: assigning an engineer reaches that client, and only that client', withKeys(async () => {
  const h = await harness();
  try {
    const mine = await h.activeClient({ phone: '9422011111', name: 'Mr Poonawalla' });
    await h.call('POST', '/api/portal/push/subscribe', { token: mine.token, body: subscriptionFor('mine') });
    const other = await h.activeClient({ phone: '9422022222', name: 'Moto Central' });
    await h.call('POST', '/api/portal/push/subscribe', { token: other.token, body: subscriptionFor('other') });

    const mgr = await h.staffToken('mgr');
    const created = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Water leak' } });
    const id = created.json.serviceCall.id;

    h.outbox.length = 0;
    await h.call('PUT', `/api/service-calls/${id}/assign`, { token: mgr, body: { engineerId: 'uEng', appointmentDate: '2026-11-04', appointmentTime: '16:55' } });

    assert.equal(h.outbox.length, 1, 'one device, not two');
    assert.equal(h.outbox[0].endpoint, subscriptionFor('mine').endpoint);
    assert.match(h.outbox[0].payload.body, /PSC-/);
    assert.equal(h.outbox[0].payload.url, `/portal/complaints/${id}`);
  } finally { h.server.close(); }
}));

test('push: completing the visit tells the client the report is ready', withKeys(async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('mine') });

    const mgr = await h.staffToken('mgr');
    const created = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Water leak' } });
    const id = created.json.serviceCall.id;
    await h.call('PUT', `/api/service-calls/${id}/assign`, { token: mgr, body: { engineerId: 'uEng', appointmentDate: '2026-11-04' } });

    h.outbox.length = 0;
    const done = await h.call('POST', `/api/service-calls/${id}/complete`, {
      token: mgr,
      body: {
        signature: 'data:image/png;base64,iVBORw0KGgo=',
        report: {
          serviceDescription: 'Drain cleared',
          checklistResults: Object.fromEntries(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'].map((k) => [k, 'Done'])),
        },
      },
    });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(h.outbox.length, 1);
    assert.match(h.outbox[0].payload.title, /report is ready/i);
    assert.equal(h.outbox[0].payload.url, `/portal/complaints/${id}`);
  } finally { h.server.close(); }
}));

test('push: a push service that is down never fails the assignment', withKeys(async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('mine') });
    h.setSender(async () => { throw Object.assign(new Error('service unavailable'), { statusCode: 503 }); });

    const mgr = await h.staffToken('mgr');
    const created = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Water leak' } });
    const assigned = await h.call('PUT', `/api/service-calls/${created.json.serviceCall.id}/assign`, {
      token: mgr, body: { engineerId: 'uEng' },
    });

    assert.equal(assigned.status, 200, 'the engineer is assigned whatever the push service is doing');
    assert.equal(h.state.portalPushSubscriptions.length, 1, 'and a temporary failure does not throw the device away');
  } finally { h.server.close(); }
}));

test('push: a device the push service says is gone is forgotten', withKeys(async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    await h.call('POST', '/api/portal/push/subscribe', { token: client.token, body: subscriptionFor('mine') });
    h.setSender(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });

    const mgr = await h.staffToken('mgr');
    const created = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Water leak' } });
    await h.call('PUT', `/api/service-calls/${created.json.serviceCall.id}/assign`, { token: mgr, body: { engineerId: 'uEng' } });

    assert.equal(h.state.portalPushSubscriptions.length, 0, 'the subscription is deleted, not retried forever');
  } finally { h.server.close(); }
}));

test('push: what a client is told carries no money and no internal note', () => {
  const assigned = portalPush.messageFor('engineer_assigned', { complaintNumber: 11, complaintId: 'abc', engineerName: 'Vinod' });
  assert.match(assigned.body, /Vinod/);
  assert.equal(assigned.url, '/portal/complaints/abc');

  const done = portalPush.messageFor('work_completed', { complaintNumber: 11, complaintId: 'abc' });
  assert.match(done.title, /report is ready/i);

  // A payload is capped and always points inside the portal, whatever it is handed.
  const payload = JSON.parse(portalPush.buildPayload({ title: 'x'.repeat(200), body: 'y'.repeat(400), url: 'https://evil.example.com/' }));
  assert.ok(payload.title.length <= 80);
  assert.ok(payload.body.length <= 160);
  assert.equal(payload.url, '/portal/', 'a url that is not ours is replaced, never followed');
});
