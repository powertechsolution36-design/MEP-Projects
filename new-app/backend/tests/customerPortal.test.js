'use strict';

/**
 * Customer portal (owner decision, 27 Oct 2026).
 *
 * The portal gives the company's own AMC / Warranty clients a login. Most of
 * what matters here is what a client must NOT be able to do, so that is what
 * most of these tests are about:
 *   · a registration cannot choose its own company or contract;
 *   · a client sees only their own contract's calls, whatever id they ask for;
 *   · a client's token is refused by staff endpoints, and a staff token by
 *     the portal;
 *   · an attachment is authorized on its own, not by knowing its id;
 *   · an image is judged by its bytes, not by what it claims to be.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { normalizePhone, resetRateLimits } = require('../src/services/portalAuthService');
const { sniffImageType } = require('../src/services/portalService');

const PW = 'pw-123456';
const CUSTOMER_PW = 'client-password-1';

/** A real 1x1 PNG, so the byte sniffing is exercised for what it is. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const pngDataUri = `data:image/png;base64,${PNG_1PX.toString('base64')}`;

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
    { id: 'uEng', companyId: 'coA', username: 'eng', name: 'Vinod Engineer', role: 'engineer', passwordHash: pw, active: true },
    { id: 'uSales', companyId: 'coA', username: 'sales', name: 'Sales', role: 'sales', passwordHash: pw, active: true },
    { id: 'uMgrB', companyId: 'coB', username: 'mgrb', name: 'Beta Mgr', role: 'service_mgr', passwordHash: pw, active: true }
  );

  // Two clients of company A, and one of company B.
  state.contracts.push(
    { id: 'ctrA1', companyId: 'coA', customer: 'Intervalve Poonawalla', phone: '9422011111', site: 'KP87 plant', capacity: '40 TR', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 150000, scheduledVisits: [] },
    { id: 'ctrA2', companyId: 'coA', customer: 'Moto Central', phone: '9422022222', site: 'Navapeth', capacity: '20 HP', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 53400, scheduledVisits: [] },
    { id: 'ctrB1', companyId: 'coB', customer: 'Beta Client', phone: '9433033333', site: 'Beta site', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 10000, scheduledVisits: [] }
  );

  const app = createDevApp(deps, { authTokenSecret: 'portal-test-secret', authTokenExpiry: '1h', port: 0 });
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
    return { status: res.status, json, headers: res.headers };
  };
  const staffToken = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: PW } })).json.token;

  /** Register, approve, and sign in — the whole path a real client walks. */
  async function activeClient({ phone = '9422011111', name = 'Mr Poonawalla', contractId } = {}) {
    await call('POST', '/api/portal/auth/register', { body: { name, phone, password: CUSTOMER_PW } });
    const mgr = await staffToken('mgr');
    const list = await call('GET', '/api/customer-accounts', { token: mgr });
    const acct = list.json.accounts.find((a) => a.phone === normalizePhone(phone));
    await call('POST', `/api/customer-accounts/${acct.id}/approve`, { token: mgr, body: contractId ? { contractId } : {} });
    const login = await call('POST', '/api/portal/auth/login', { body: { phone, password: CUSTOMER_PW } });
    return { accountId: acct.id, token: login.json.token, login };
  }

  return { deps, state, base, server, call, staffToken, activeClient };
}

/* ---------------- registration ---------------- */

test('portal: a registration is matched by phone, lands Pending, and cannot choose its company', async () => {
  const h = await harness();
  try {
    const res = await h.call('POST', '/api/portal/auth/register', {
      // The registrant tries to name a company and a contract. Both ignored.
      body: { name: 'Mr Poonawalla', phone: '9422011111', password: CUSTOMER_PW, companyId: 'coB', contractId: 'ctrB1', status: 'Active' },
    });
    assert.equal(res.status, 202);
    assert.equal(res.json.registered, true);

    const acct = h.state.customerAccounts[0];
    assert.equal(acct.status, 'Pending', 'a registration is never active on arrival');
    assert.equal(String(acct.companyId), 'coA', 'the company comes from the matched contract, not the request');
    assert.equal(String(acct.contractId), 'ctrA1');
    assert.equal(acct.matchResult, 'matched');
    assert.ok(!('password' in acct), 'the plain password is never stored');
    assert.ok(acct.passwordHash && acct.passwordHash !== CUSTOMER_PW);
  } finally { h.server.close(); }
});

test('portal: an unmatched number still registers, with no company, and stays Pending', async () => {
  const h = await harness();
  try {
    const res = await h.call('POST', '/api/portal/auth/register', {
      body: { name: 'Stranger', phone: '9999000011', password: CUSTOMER_PW, site: 'Somewhere' },
    });
    assert.equal(res.status, 202);
    const acct = h.state.customerAccounts[0];
    assert.equal(acct.companyId, null, 'nothing is guessed when the number matches no client');
    assert.equal(acct.contractId, null);
    assert.equal(acct.matchResult, 'no-match');
    assert.equal(acct.claimedSite, 'Somewhere', 'what they claimed is kept for staff to read');
  } finally { h.server.close(); }
});

test('portal: the reply never reveals whether a number belongs to a client', async () => {
  const h = await harness();
  try {
    const known = await h.call('POST', '/api/portal/auth/register', { body: { name: 'Known Client', phone: '9422011111', password: CUSTOMER_PW } });
    const unknown = await h.call('POST', '/api/portal/auth/register', { body: { name: 'Nobody At All', phone: '9999000022', password: CUSTOMER_PW } });
    const repeat = await h.call('POST', '/api/portal/auth/register', { body: { name: 'Known Again', phone: '9422011111', password: CUSTOMER_PW } });
    assert.deepEqual(known.json, unknown.json);
    assert.deepEqual(known.json, repeat.json, 'an already-registered number answers the same way too');
    assert.equal(h.state.customerAccounts.filter((a) => a.phone === '919422011111').length, 1, 'and no second account appears');
  } finally { h.server.close(); }
});

test('portal: registration validates its inputs', async () => {
  const h = await harness();
  try {
    const bad = async (body) => (await h.call('POST', '/api/portal/auth/register', { body })).status;
    assert.equal(await bad({ name: 'Valid Name', phone: '9422011111', password: 'short' }), 400);
    assert.equal(await bad({ name: '', phone: '9422011111', password: CUSTOMER_PW }), 400);
    assert.equal(await bad({ name: 'Valid Name', phone: '123', password: CUSTOMER_PW }), 400);
    assert.equal(await bad({ name: 'Valid Name', phone: '9422011111', password: CUSTOMER_PW, email: 'not-an-email' }), 400);
    assert.equal(h.state.customerAccounts.length, 0);
  } finally { h.server.close(); }
});

test('portal: registration is rate limited', async () => {
  const h = await harness();
  try {
    let last = 0;
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = (await h.call('POST', '/api/portal/auth/register', { body: { name: `N${i}`, phone: `90000000${i}1`, password: CUSTOMER_PW } })).status;
    }
    assert.equal(last, 429, 'the form stops answering after a burst from one address');
  } finally { h.server.close(); }
});

/* ---------------- approval ---------------- */

test('portal: a Pending account cannot sign in until staff approve it', async () => {
  const h = await harness();
  try {
    await h.call('POST', '/api/portal/auth/register', { body: { name: 'Mr P', phone: '9422011111', password: CUSTOMER_PW } });
    const before = await h.call('POST', '/api/portal/auth/login', { body: { phone: '9422011111', password: CUSTOMER_PW } });
    assert.equal(before.status, 403);
    assert.equal(before.json.error, 'Your account is waiting to be activated by our team.');

    const mgr = await h.staffToken('mgr');
    const list = await h.call('GET', '/api/customer-accounts', { token: mgr });
    assert.equal(list.json.accounts.length, 1);
    assert.equal(list.json.accounts[0].contract.customer, 'Intervalve Poonawalla', 'staff see which client it matched');
    assert.ok(!('passwordHash' in list.json.accounts[0]), 'a password hash never leaves the server');

    const approved = await h.call('POST', `/api/customer-accounts/${list.json.accounts[0].id}/approve`, { token: mgr, body: {} });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.account.status, 'Active');

    const after = await h.call('POST', '/api/portal/auth/login', { body: { phone: '9422011111', password: CUSTOMER_PW } });
    assert.equal(after.status, 200);
    assert.ok(after.json.token);
  } finally { h.server.close(); }
});

test('portal: only admin and service_mgr may review accounts, and never another company’s', async () => {
  const h = await harness();
  try {
    await h.call('POST', '/api/portal/auth/register', { body: { name: 'Mr P', phone: '9422011111', password: CUSTOMER_PW } });
    const acctId = h.state.customerAccounts[0].id;

    const sales = await h.staffToken('sales');
    assert.equal((await h.call('GET', '/api/customer-accounts', { token: sales })).status, 403);
    assert.equal((await h.call('POST', `/api/customer-accounts/${acctId}/approve`, { token: sales, body: {} })).status, 403);

    // Company B's manager cannot see or touch company A's registration.
    const mgrB = await h.staffToken('mgrb');
    assert.deepEqual((await h.call('GET', '/api/customer-accounts', { token: mgrB })).json.accounts, []);
    assert.equal((await h.call('POST', `/api/customer-accounts/${acctId}/approve`, { token: mgrB, body: {} })).status, 404);
  } finally { h.server.close(); }
});

test('portal: approval cannot bind an account to another company’s client', async () => {
  const h = await harness();
  try {
    await h.call('POST', '/api/portal/auth/register', { body: { name: 'Mr P', phone: '9422011111', password: CUSTOMER_PW } });
    const acctId = h.state.customerAccounts[0].id;
    const mgr = await h.staffToken('mgr');
    const res = await h.call('POST', `/api/customer-accounts/${acctId}/approve`, { token: mgr, body: { contractId: 'ctrB1' } });
    assert.equal(res.status, 404, 'a contract of another tenant is simply not found');
    assert.equal(h.state.customerAccounts[0].status, 'Pending');
  } finally { h.server.close(); }
});

test('portal: disabling an account ends the sessions it already holds', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    assert.equal((await h.call('GET', '/api/portal/me', { token: client.token })).status, 200);

    const mgr = await h.staffToken('mgr');
    const res = await h.call('POST', `/api/customer-accounts/${client.accountId}/status`, { token: mgr, body: { status: 'Disabled', note: 'left' } });
    assert.equal(res.status, 200);
    assert.equal((await h.call('GET', '/api/portal/me', { token: client.token })).status, 401, 'the token stops working at once');
  } finally { h.server.close(); }
});

/* ---------------- isolation ---------------- */

test('portal: a client token is refused by every staff endpoint', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    for (const path of ['/api/service-calls', '/api/contracts', '/api/quotations', '/api/users', '/api/customer-accounts', '/api/auth/me']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await h.call('GET', path, { token: client.token });
      assert.equal(res.status, 401, `${path} must refuse a customer token`);
    }
  } finally { h.server.close(); }
});

test('portal: a staff token is refused by every portal endpoint', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    for (const path of ['/api/portal/me', '/api/portal/complaints']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await h.call('GET', path, { token: mgr })).status, 401, `${path} must refuse a staff token`);
    }
  } finally { h.server.close(); }
});

test('portal: a client sees only their own contract’s complaints, whatever id they ask for', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    // One complaint for each of company A's two clients.
    const mine = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Mine to see' } });
    const theirs = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA2', complaintDescription: 'Not mine to see' } });
    const mineId = mine.json.serviceCall.id;
    const theirsId = theirs.json.serviceCall.id;

    const client = await h.activeClient(); // bound to ctrA1
    const list = await h.call('GET', '/api/portal/complaints', { token: client.token });
    assert.equal(list.json.complaints.length, 1);
    assert.equal(String(list.json.complaints[0].id), String(mineId));

    assert.equal((await h.call('GET', `/api/portal/complaints/${mineId}`, { token: client.token })).status, 200);
    const other = await h.call('GET', `/api/portal/complaints/${theirsId}`, { token: client.token });
    assert.equal(other.status, 404, 'another client of the same company is still not theirs');
    assert.equal(other.json.error, 'Complaint not found.', 'and the answer gives nothing away');
  } finally { h.server.close(); }
});

test('portal: staff-only detail never reaches the client view', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const created = await h.call('POST', '/api/service-calls/complaints', { token: mgr, body: { contractId: 'ctrA1', complaintDescription: 'Noisy unit' } });
    const id = created.json.serviceCall.id;
    await h.call('PUT', `/api/service-calls/${id}/assign`, { token: mgr, body: { engineerId: 'uEng', appointmentDate: '2026-11-02', appointmentTime: '10:00' } });
    await h.call('POST', `/api/service-calls/${id}/complete`, {
      token: mgr,
      body: {
        signature: 'data:image/png;base64,iVBORw0KGgo=',
        report: {
          serviceDescription: 'Cleaned and tested', engineerRemark: 'INTERNAL ONLY — customer is difficult',
          amount: 2500, serviceType: 'Chargeable',
          checklistResults: Object.fromEntries(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'].map((k) => [k, 'Done'])),
        },
      },
    });

    const client = await h.activeClient();
    const view = (await h.call('GET', `/api/portal/complaints/${id}`, { token: client.token })).json.complaint;
    const text = JSON.stringify(view);

    assert.equal(view.engineerName, 'Vinod Engineer', 'the engineer’s display name is shown');
    assert.equal(view.serviceDescription, 'Cleaned and tested');
    assert.ok(!text.includes('INTERNAL ONLY'), 'the engineer’s own remark is not for the client');
    assert.ok(!text.includes('2500'), 'what was charged is not shown');
    assert.ok(!text.includes('checklistResults'), 'the checklist is staff material');
    assert.ok(!text.includes('clientSignatureImage'), 'the signature image is not echoed back');
    assert.ok(!text.includes('engineerId'), 'nor the engineer’s identifier');
    assert.ok(!text.includes('uEng'));
  } finally { h.server.close(); }
});

/* ---------------- raising a complaint ---------------- */

test('portal: a client raises a complaint on their own contract, numbered and timed by the server', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const res = await h.call('POST', '/api/portal/complaints', {
      token: client.token,
      // The client tries to choose someone else's contract, a status and a
      // customer name. None of it is read.
      body: { complaintDescription: 'AC not cooling since Monday', contractId: 'ctrA2', companyId: 'coB', status: 'Completed', customer: 'Someone Else', complaintNumber: 999 },
    });
    assert.equal(res.status, 201);
    const c = res.json.complaint;
    assert.equal(c.status, 'Registered');
    assert.notEqual(c.complaintNumber, 999);
    assert.ok(c.complaintNumber >= 1);
    assert.equal(c.site, 'KP87 plant', 'the site comes from their own contract');
    assert.equal(c.coverage, 'AMC');

    const stored = h.state.serviceCalls.find((s) => String(s.id) === String(c.id));
    assert.equal(String(stored.contractId), 'ctrA1', 'their own contract, not the one they asked for');
    assert.equal(String(stored.companyId), 'coA');
    assert.equal(stored.customer, 'Intervalve Poonawalla');
    assert.equal(stored.source, 'Customer', 'and it is recorded as raised by the client');
    assert.ok(stored.registeredDate, 'the server sets the date');
  } finally { h.server.close(); }
});

test('portal: raising a complaint notifies the managers through the existing notification', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    await h.call('POST', '/api/portal/complaints', { token: client.token, body: { complaintDescription: 'Water leaking from indoor unit' } });
    const note = h.state.notifications.at(-1);
    assert.ok(note, 'the existing notification is used, not a second system');
    assert.deepEqual(note.targetRoles, ['service_mgr', 'admin']);
    assert.match(note.text, /New complaint registered/);
  } finally { h.server.close(); }
});

test('portal: a complaint needs a description, and creates nothing else', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    assert.equal((await h.call('POST', '/api/portal/complaints', { token: client.token, body: { complaintDescription: '' } })).status, 400);
    assert.equal((await h.call('POST', '/api/portal/complaints', { token: client.token, body: {} })).status, 400);
    assert.equal(h.state.serviceCalls.length, 0);
    // No payment, project or inventory movement follows a complaint.
    assert.equal(h.state.payments.length, 0);
    assert.equal(h.state.projects.length, 0);
    assert.equal(h.state.inventoryTransactions.length, 0);
  } finally { h.server.close(); }
});

/* ---------------- photographs ---------------- */

test('portal: photographs are stored, listed and served back to their owner', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const res = await h.call('POST', '/api/portal/complaints', {
      token: client.token,
      body: { complaintDescription: 'Rust on the outdoor unit', images: [pngDataUri, pngDataUri] },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.complaint.attachments.length, 2);

    const att = res.json.complaint.attachments[0];
    assert.equal(att.contentType, 'image/png');
    assert.match(att.filename, /^complaint-\d+-\d\.png$/, 'the server names the file');

    const file = await fetch(`${h.base}/api/portal/attachments/${att.id}`, { headers: { authorization: `Bearer ${client.token}` } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(file.headers.get('cache-control'), 'private, no-store');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await file.arrayBuffer()).length, PNG_1PX.length);
  } finally { h.server.close(); }
});

test('portal: a file is judged by its bytes, not by what it claims to be', async () => {
  assert.equal(sniffImageType(PNG_1PX), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<?php system($_GET[0]); ?>')), null);
  assert.equal(sniffImageType(Buffer.from('GIF89a')), null, 'even a real image type we do not accept');
});

test('portal: a script dressed as an image is refused, and leaves no complaint behind', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const evil = `data:image/png;base64,${Buffer.from('<?php system($_GET[0]); ?>').toString('base64')}`;
    const res = await h.call('POST', '/api/portal/complaints', { token: client.token, body: { complaintDescription: 'Looks broken', images: [evil] } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /not a JPEG, PNG or WebP/);
    assert.equal(h.state.serviceCalls.length, 0, 'the complaint is not created when an attachment is bad');
    assert.equal(h.state.attachments.length, 0);
  } finally { h.server.close(); }
});

test('portal: oversized and over-many attachments are refused', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const tooMany = Array.from({ length: 6 }, () => pngDataUri);
    const many = await h.call('POST', '/api/portal/complaints', { token: client.token, body: { complaintDescription: 'Several photographs attached', images: tooMany } });
    assert.equal(many.status, 400);
    assert.match(many.json.error, /at most 5/);

    // A real PNG header followed by 4 MB of padding: the right type, too big.
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(4 * 1024 * 1024, 0)]);
    const res = await h.call('POST', '/api/portal/complaints', {
      token: client.token,
      body: { complaintDescription: 'One very large photograph', images: [`data:image/png;base64,${big.toString('base64')}`] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /under 3 MB/);
    assert.equal(h.state.serviceCalls.length, 0);
  } finally { h.server.close(); }
});

test('portal: one client cannot fetch another client’s photograph by its id', async () => {
  const h = await harness();
  try {
    const first = await h.activeClient(); // ctrA1
    const created = await h.call('POST', '/api/portal/complaints', { token: first.token, body: { complaintDescription: 'Outdoor unit is rusting', images: [pngDataUri] } });
    const attId = created.json.complaint.attachments[0].id;

    // A second client of the SAME company.
    const second = await h.activeClient({ phone: '9422022222', name: 'Moto Central' });
    const res = await fetch(`${h.base}/api/portal/attachments/${attId}`, { headers: { authorization: `Bearer ${second.token}` } });
    assert.equal(res.status, 404, 'knowing the id is worth nothing');

    const anon = await fetch(`${h.base}/api/portal/attachments/${attId}`);
    assert.equal(anon.status, 401, 'and it is not public either');
  } finally { h.server.close(); }
});

test('portal: staff of the company can see the photographs; another company cannot', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const created = await h.call('POST', '/api/portal/complaints', { token: client.token, body: { complaintDescription: 'Outdoor unit is rusting', images: [pngDataUri] } });
    const callId = created.json.complaint.id;
    const attId = created.json.complaint.attachments[0].id;

    const mgr = await h.staffToken('mgr');
    const list = await h.call('GET', `/api/service-calls/${callId}/attachments`, { token: mgr });
    assert.equal(list.status, 200);
    assert.equal(list.json.attachments.length, 1);

    const file = await fetch(`${h.base}/api/service-calls/attachments/${attId}`, { headers: { authorization: `Bearer ${mgr}` } });
    assert.equal(file.status, 200);

    const mgrB = await h.staffToken('mgrb');
    const denied = await fetch(`${h.base}/api/service-calls/attachments/${attId}`, { headers: { authorization: `Bearer ${mgrB}` } });
    assert.equal(denied.status, 404, 'another tenant cannot read it');
  } finally { h.server.close(); }
});

/* ---------------- sessions ---------------- */

test('portal: logging out ends the session; a wrong password is refused and rate limited', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    assert.equal((await h.call('POST', '/api/portal/auth/logout', { token: client.token })).status, 200);
    assert.equal((await h.call('GET', '/api/portal/me', { token: client.token })).status, 401);

    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = (await h.call('POST', '/api/portal/auth/login', { body: { phone: '9422011111', password: 'wrong-password' } })).status;
    }
    assert.equal(last, 429, 'guessing is stopped');
  } finally { h.server.close(); }
});

test('portal: the profile shows the client their own contract and the company to call', async () => {
  const h = await harness();
  try {
    const client = await h.activeClient();
    const me = (await h.call('GET', '/api/portal/me', { token: client.token })).json;
    assert.equal(me.client.customer, 'Intervalve Poonawalla');
    assert.equal(me.client.site, 'KP87 plant');
    assert.equal(me.account.phone, '919422011111');
    assert.ok(!JSON.stringify(me).includes('passwordHash'));
  } finally { h.server.close(); }
});

test('portal: phone numbers are normalised the same way everywhere', () => {
  assert.equal(normalizePhone('9422011111'), '919422011111');
  assert.equal(normalizePhone('09422011111'), '919422011111');
  assert.equal(normalizePhone('+91 94220 11111'), '919422011111');
  assert.equal(normalizePhone('919422011111'), '919422011111');
  assert.equal(normalizePhone('123'), '');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
});

/* ---------------- the WhatsApp boundary ---------------- */

test('notifier: with no provider configured nothing is sent, and it says so', async () => {
  const { EVENTS, notifyCustomer } = require('../src/services/customerNotifier');
  const res = await notifyCustomer(EVENTS.COMPLAINT_REGISTERED, { customer: 'Intervalve', phone: '919422011111', complaintNumber: 7 }, {});
  assert.equal(res.delivered, false);
  assert.equal(res.reason, 'NO_PROVIDER_CONFIGURED');
});

test('notifier: a configured provider is handed the message and the recipient', async () => {
  const { EVENTS, notifyCustomer } = require('../src/services/customerNotifier');
  const sent = [];
  const whatsappProvider = { name: 'mock', configured: true, async send(m) { sent.push(m); return { delivered: true }; } };
  const res = await notifyCustomer(
    EVENTS.ENGINEER_ASSIGNED,
    { customer: 'Intervalve', phone: '+91 94220 11111', complaintNumber: 7, engineerName: 'Vinod' },
    { whatsappProvider }
  );
  assert.equal(res.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '919422011111', 'digits only');
  assert.match(sent[0].text, /Vinod/);
  assert.match(sent[0].text, /PSC-7/);
  assert.equal(sent[0].templateName, EVENTS.ENGINEER_ASSIGNED, 'each event names the template it needs');
});

test('notifier: a provider that throws never breaks the caller, and never logs the message', async () => {
  const { EVENTS, notifyCustomer } = require('../src/services/customerNotifier');
  const warned = [];
  const whatsappProvider = {
    name: 'broken', configured: true,
    async send() { const e = new Error('token sk-live-SECRET-VALUE rejected'); e.code = 'EAUTH'; throw e; },
  };
  const res = await notifyCustomer(
    EVENTS.COMPLAINT_COMPLETED, { customer: 'Intervalve', phone: '919422011111', complaintNumber: 9 },
    { whatsappProvider }, { logger: { warn: (m) => warned.push(m) } }
  );
  assert.equal(res.delivered, false);
  assert.equal(res.reason, 'PROVIDER_ERROR');
  const log = warned.join(' ');
  assert.ok(!log.includes('sk-live-SECRET-VALUE'), 'a provider secret must never reach the log');
  assert.ok(!log.includes('Intervalve'), 'nor the message body');
});

test('notifier: a client with no number on file is never messaged', async () => {
  const { EVENTS, notifyCustomer } = require('../src/services/customerNotifier');
  const whatsappProvider = { name: 'mock', configured: true, async send() { throw new Error('must not be called'); } };
  const res = await notifyCustomer(EVENTS.COMPLAINT_REGISTERED, { customer: 'No Phone', phone: '' }, { whatsappProvider });
  assert.equal(res.delivered, false);
  assert.equal(res.reason, 'NO_RECIPIENT');
});

test('notifier: every event has wording, and none of it is a placeholder', () => {
  const { EVENTS, buildMessage } = require('../src/services/customerNotifier');
  for (const event of Object.values(EVENTS)) {
    const text = buildMessage(event, { customer: 'Intervalve', complaintNumber: 3, engineerName: 'Vinod', appointmentText: '2 November, 10:00' });
    assert.ok(text.length > 20, `${event} needs wording`);
    assert.ok(!text.includes('{{'), `${event} must not ship a placeholder`);
    assert.ok(!text.includes('undefined'), `${event} must not read "undefined"`);
  }
});
