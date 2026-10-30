'use strict';

/**
 * Customer portal — project progress (owner decision, 30 Oct 2026).
 *
 * The client is shown their own HVAC / Solar / MEP work: the stage it has
 * reached, when earlier stages were reached, and what the project manager
 * chose to tell them. Almost everything worth testing here is a negative,
 * because the whole value of the feature depends on them:
 *
 *   · a client sees a project ONLY because staff linked it — never because
 *     a name happened to match, and never by asking for an id;
 *   · a link from another tenant is worth nothing;
 *   · an execution update is internal until somebody shares it, and
 *     un-sharing takes it back;
 *   · the payload is an allowlist — costs, margins, the vendor, engineers,
 *     delivery challans and internal next actions are not in it;
 *   · a staff token cannot read the portal and a client token cannot link.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDevApp, createDevRepositories } = require('../src/devServer');
const { hashPassword } = require('../src/auth/passwordHasher');
const { normalizePhone, resetRateLimits } = require('../src/services/portalAuthService');

const PW = 'pw-123456';
const CUSTOMER_PW = 'client-password-1';

/** Every key the portal is allowed to send about a project. */
const LIST_KEYS = [
  'capacity', 'completedDate', 'division', 'id', 'lastUpdateAt', 'name',
  'progressPercent', 'siteType', 'stage', 'stages', 'startDate', 'status', 'updateCount',
];
const DETAIL_KEYS = [...LIST_KEYS, 'updates'].sort();

async function harness() {
  resetRateLimits();
  const deps = createDevRepositories();
  const { state } = deps.store;
  state.companies.length = 0;
  state.users.length = 0;

  const mk = (id, name) => ({
    id, name, divisions: ['HVAC', 'Solar', 'MEP'], status: 'Active',
    subscriptionRate: 1, subscriptionCycle: 'Monthly',
    subscriptionStart: new Date('2026-01-01'), subscriptionEnd: new Date('2030-01-01'), since: new Date('2026-01-01'),
  });
  state.companies.push(mk('coA', 'Alpha'), mk('coB', 'Beta'));

  const pw = await hashPassword(PW);
  state.users.push(
    { id: 'uMgr', companyId: 'coA', username: 'mgr', name: 'Rahul Manager', role: 'service_mgr', passwordHash: pw, active: true },
    { id: 'uAdmin', companyId: 'coA', username: 'adm', name: 'Alpha Admin', role: 'admin', passwordHash: pw, active: true },
    { id: 'uMgrB', companyId: 'coB', username: 'mgrb', name: 'Beta Mgr', role: 'service_mgr', passwordHash: pw, active: true }
  );

  // Two clients of company A, one of company B.
  state.contracts.push(
    { id: 'ctrA1', companyId: 'coA', customer: 'Gastro Hub', phone: '9422011111', site: 'Pimple Saudagar', capacity: '40 TR', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 150000, scheduledVisits: [] },
    { id: 'ctrA2', companyId: 'coA', customer: 'Moto Central', phone: '9422022222', site: 'Navapeth', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 53400, scheduledVisits: [] },
    { id: 'ctrB1', companyId: 'coB', customer: 'Beta Client', phone: '9433033333', site: 'Beta site', category: 'AMC', amcType: 'Quarterly', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), amount: 10000, scheduledVisits: [] }
  );

  // A project carrying every kind of thing a client must never be shown.
  state.projects.push({
    id: 'prjA1',
    companyId: 'coA',
    salesOrderId: 'soA1',
    division: 'HVAC',
    name: 'Gastro Hub kitchen ventilation',
    siteType: 'Restaurant',
    capacity: '40 TR',
    customer: 'Gastro Hub',
    stage: 'Installation',
    status: 'Ongoing',
    startDate: new Date('2026-05-01'),
    vendor: 'Sharma Fabricators',
    assignedEngineerIds: ['uMgr'],
    checklist: [],
    deliveryChallans: [{
      challanNumber: '1', date: new Date('2026-06-01'), materialName: 'Ducting',
      quantity: 20, unit: 'm', returnable: false,
    }],
    executionUpdates: [
      { date: new Date('2026-05-10'), actionDone: 'Site survey done', nextAction: 'Chase Sharma Fabricators for duct quote', sharedWithCustomer: false, customerNote: '' },
      { date: new Date('2026-06-02'), actionDone: 'Ducting delivered to site', nextAction: 'Start hanging', sharedWithCustomer: false, customerNote: '' },
    ],
    stageHistory: [
      { stage: 'Piping', enteredAt: new Date('2026-05-20'), enteredByUserId: 'uAdmin' },
      { stage: 'Installation', enteredAt: new Date('2026-06-05'), enteredByUserId: 'uAdmin' },
    ],
    timelineSet: false,
    revision: 0,
  });

  // Another client's project in the same company, and one in company B.
  state.projects.push(
    { id: 'prjA2', companyId: 'coA', salesOrderId: 'soA2', division: 'Solar', name: 'Moto Central rooftop solar', customer: 'Moto Central', stage: 'Wiring', status: 'Ongoing', startDate: new Date('2026-03-01'), checklist: [], executionUpdates: [], deliveryChallans: [], stageHistory: [], revision: 0 },
    { id: 'prjB1', companyId: 'coB', salesOrderId: 'soB1', division: 'MEP', name: 'Beta design package', customer: 'Beta Client', stage: 'Client Review', status: 'Ongoing', startDate: new Date('2026-02-01'), checklist: [], executionUpdates: [], deliveryChallans: [], stageHistory: [], revision: 0 }
  );

  const app = createDevApp(deps, { authTokenSecret: 'portal-proj-secret', authTokenExpiry: '1h', port: 0 });
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

  async function activeClient({ phone = '9422011111', name = 'Mr Nemade' } = {}) {
    await call('POST', '/api/portal/auth/register', { body: { name, phone, password: CUSTOMER_PW } });
    const mgr = await staffToken('mgr');
    const list = await call('GET', '/api/customer-accounts', { token: mgr });
    const acct = list.json.accounts.find((a) => a.phone === normalizePhone(phone));
    await call('POST', `/api/customer-accounts/${acct.id}/approve`, { token: mgr, body: {} });
    const login = await call('POST', '/api/portal/auth/login', { body: { phone, password: CUSTOMER_PW } });
    return { accountId: acct.id, token: login.json.token };
  }

  return { deps, state, call, staffToken, activeClient, server };
}

/* ---------------- access is a stored fact ---------------- */

test('portal projects: a client with nothing linked sees no projects, however many exist', async () => {
  const h = await harness();
  try {
    const c = await h.activeClient();
    const res = await h.call('GET', '/api/portal/projects', { token: c.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.projects, [], 'approving a login does not by itself grant a project');

    // And the project whose `customer` text matches their contract exactly
    // is still not reachable by id.
    const one = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(one.status, 404, 'a matching customer name grants nothing');
  } finally { h.server.close(); }
});

test('portal projects: once staff link it, the client sees the stage it has reached and when', async () => {
  const h = await harness();
  try {
    const c = await h.activeClient();
    const mgr = await h.staffToken('mgr');

    const link = await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, {
      token: mgr, body: { projectIds: ['prjA1'] },
    });
    assert.equal(link.status, 200);
    assert.deepEqual(link.json.account.linkedProjectIds, ['prjA1']);

    const res = await h.call('GET', '/api/portal/projects', { token: c.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.projects.length, 1);

    const p = res.json.projects[0];
    assert.equal(p.name, 'Gastro Hub kitchen ventilation');
    assert.equal(p.division, 'HVAC');
    assert.equal(p.stage, 'Installation');
    // HVAC has six stages; standing on the third is half way.
    assert.equal(p.progressPercent, 50);

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.status, 200);
    const stages = detail.json.project.stages;
    assert.deepEqual(stages.map((s) => s.stage), ['Planning', 'Piping', 'Installation', 'Testing', 'Finishing', 'Completed']);
    assert.deepEqual(stages.map((s) => s.reached), [true, true, true, false, false, false]);
    assert.equal(stages.find((s) => s.current).stage, 'Installation');
    // Dates appear only where one was actually recorded.
    assert.equal(stages[0].at, null, 'no date is invented for a stage nobody recorded');
    assert.equal(new Date(stages[1].at).toISOString().slice(0, 10), '2026-05-20');
    assert.equal(new Date(stages[2].at).toISOString().slice(0, 10), '2026-06-05');
  } finally { h.server.close(); }
});

test('portal projects: one client cannot see another client of the same company', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const gastro = await h.activeClient({ phone: '9422011111', name: 'Mr Nemade' });
    const moto = await h.activeClient({ phone: '9422022222', name: 'Moto Owner' });

    await h.call('PUT', `/api/customer-accounts/${gastro.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });
    await h.call('PUT', `/api/customer-accounts/${moto.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA2'] } });

    const asGastro = await h.call('GET', '/api/portal/projects', { token: gastro.token });
    const asMoto = await h.call('GET', '/api/portal/projects', { token: moto.token });
    assert.deepEqual(asGastro.json.projects.map((p) => p.id), ['prjA1']);
    assert.deepEqual(asMoto.json.projects.map((p) => p.id), ['prjA2']);

    // Each knows the other's id. It is worth nothing.
    assert.equal((await h.call('GET', '/api/portal/projects/prjA2', { token: gastro.token })).status, 404);
    assert.equal((await h.call('GET', '/api/portal/projects/prjA1', { token: moto.token })).status, 404);
  } finally { h.server.close(); }
});

test('portal projects: a link to another tenant\'s project is refused when written and ignored if forced', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const c = await h.activeClient();

    // Company A's staff try to link company B's project.
    const res = await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, {
      token: mgr, body: { projectIds: ['prjA1', 'prjB1'] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.account.linkedProjectIds, ['prjA1'], 'the other tenant\'s id is not stored');
    assert.deepEqual(res.json.ignored, ['prjB1'], 'and the reply says so rather than failing silently');

    // Now force it straight into the stored record, as a bad migration or a
    // compromised write might. The company filter on the read still holds.
    const acct = h.state.customerAccounts.find((a) => String(a.id) === String(c.accountId));
    acct.linkedProjectIds = ['prjA1', 'prjB1'];
    const list = await h.call('GET', '/api/portal/projects', { token: c.token });
    assert.deepEqual(list.json.projects.map((p) => p.id), ['prjA1'], 'a link alone is never enough — the tenant is checked too');
    assert.equal((await h.call('GET', '/api/portal/projects/prjB1', { token: c.token })).status, 404);
  } finally { h.server.close(); }
});

/* ---------------- an update is private until shared ---------------- */

test('portal projects: execution updates stay internal until a PM shares one, and un-sharing takes it back', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    let detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates, [], 'two updates exist and neither is shared');
    assert.equal(detail.json.project.updateCount, 0);

    // Share the second one, with wording written for the client.
    const shared = await h.call('PATCH', '/api/projects/prjA1/updates/1/share', {
      token: admin, body: { shared: true, customerNote: 'Ducting has arrived on site.' },
    });
    assert.equal(shared.status, 200);

    detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.json.project.updates.length, 1);
    assert.equal(detail.json.project.updates[0].note, 'Ducting has arrived on site.');
    assert.deepEqual(Object.keys(detail.json.project.updates[0]).sort(), ['date', 'note', 'photos']);

    // The first update — the one naming the vendor — is still not there.
    const asText = JSON.stringify(detail.json);
    assert.ok(!asText.includes('Sharma Fabricators'), 'the vendor named in an unshared update never reaches the client');
    assert.ok(!asText.includes('Start hanging'), 'the internal next action is not sent even for a shared update');

    // Take it back.
    const hidden = await h.call('PATCH', '/api/projects/prjA1/updates/1/share', { token: admin, body: { shared: false } });
    assert.equal(hidden.status, 200);
    detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates, [], 'un-sharing removes it at once');
  } finally { h.server.close(); }
});

test('portal projects: a shared update with no client wording shows what the PM recorded', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    await h.call('PATCH', '/api/projects/prjA1/updates/0/share', { token: admin, body: { shared: true } });
    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.json.project.updates[0].note, 'Site survey done');
  } finally { h.server.close(); }
});

test('portal projects: a new update can be shared as it is written, and is internal by default', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    await h.call('POST', '/api/projects/prjA1/updates', {
      token: admin, body: { actionDone: 'Internal only line', nextAction: 'secret' },
    });
    await h.call('POST', '/api/projects/prjA1/updates', {
      token: admin,
      body: { actionDone: 'Grilles fitted', nextAction: 'Commission', shareWithCustomer: true, customerNote: 'Air grilles are fitted.' },
    });

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates.map((u) => u.note), ['Air grilles are fitted.']);
    assert.ok(!JSON.stringify(detail.json).includes('Internal only line'));
    assert.ok(!JSON.stringify(detail.json).includes('Commission'));
  } finally { h.server.close(); }
});

/* ---------------- the payload is an allowlist ---------------- */

test('portal projects: the payload carries only the allowed fields — no cost, vendor, engineer or challan', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const list = await h.call('GET', '/api/portal/projects', { token: c.token });
    assert.deepEqual(Object.keys(list.json.projects[0]).sort(), [...LIST_KEYS].sort());

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(Object.keys(detail.json.project).sort(), DETAIL_KEYS);

    const bodies = JSON.stringify(list.json) + JSON.stringify(detail.json);
    for (const forbidden of [
      'Sharma Fabricators', 'uMgr', 'soA1', 'Ducting', 'challan', 'vendor',
      'assignedEngineer', 'deliveryChallan', 'nextAction', 'checklist', 'revision',
      'totalCost', 'highSide', 'lowSide', 'salesOrderId',
    ]) {
      assert.ok(!bodies.includes(forbidden), `"${forbidden}" must not appear in a portal project payload`);
    }
  } finally { h.server.close(); }
});

/* ---------------- stage history is written as stages change ---------------- */

test('portal projects: changing the stage records the date the client then sees', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const moved = await h.call('POST', '/api/projects/prjA1/stage', { token: admin, body: { stage: 'Testing' } });
    assert.equal(moved.status, 200);

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    const testing = detail.json.project.stages.find((s) => s.stage === 'Testing');
    assert.equal(testing.reached, true);
    assert.equal(testing.current, true);
    assert.ok(testing.at, 'the stage change recorded its own date');
    assert.equal(detail.json.project.progressPercent, 67);

    // Re-saving the same stage must not add a second entry.
    await h.call('POST', '/api/projects/prjA1/stage', { token: admin, body: { stage: 'Testing' } });
    const proj = h.state.projects.find((p) => p.id === 'prjA1');
    assert.equal(proj.stageHistory.filter((e) => e.stage === 'Testing').length, 1);
  } finally { h.server.close(); }
});

test('portal projects: a completed project reads as finished, at 100 per cent', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const done = await h.call('POST', '/api/projects/prjA1/stage', {
      token: admin, body: { stage: 'Completed', confirmPendingMaterial: true, confirmIncompleteChecklist: true },
    });
    assert.equal(done.status, 200);

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.json.project.status, 'Completed');
    assert.equal(detail.json.project.progressPercent, 100);
    assert.ok(detail.json.project.completedDate, 'the client is told when it finished');
  } finally { h.server.close(); }
});

/* ---------------- the two sides cannot borrow each other's tokens ---------------- */

test('portal projects: a staff token cannot read the portal, and a client token cannot link projects', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const c = await h.activeClient();

    assert.equal((await h.call('GET', '/api/portal/projects', { token: mgr })).status, 401);
    assert.equal((await h.call('GET', '/api/portal/projects/prjA1', { token: mgr })).status, 401);

    const tried = await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, {
      token: c.token, body: { projectIds: ['prjA1'] },
    });
    assert.equal(tried.status, 401, 'a client cannot grant themselves a project');

    assert.equal((await h.call('GET', '/api/portal/projects')).status, 401, 'and no token reads nothing');
  } finally { h.server.close(); }
});

test('portal projects: another company\'s staff cannot link or list for this account', async () => {
  const h = await harness();
  try {
    const mgrB = await h.staffToken('mgrb');
    const c = await h.activeClient();

    assert.equal((await h.call('GET', `/api/customer-accounts/${c.accountId}/project-candidates`, { token: mgrB })).status, 404);
    assert.equal((await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgrB, body: { projectIds: ['prjB1'] } })).status, 404);
  } finally { h.server.close(); }
});

/* ---------------- the staff suggestion list ---------------- */

test('portal projects: candidates are this company\'s only, ranked, and marked with what is already linked', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const c = await h.activeClient();

    const res = await h.call('GET', `/api/customer-accounts/${c.accountId}/project-candidates`, { token: mgr });
    assert.equal(res.status, 200);
    const ids = res.json.projects.map((p) => p.id);
    assert.ok(ids.includes('prjA1') && ids.includes('prjA2'));
    assert.ok(!ids.includes('prjB1'), 'another tenant\'s project is not even offered');

    // The client is Gastro Hub of Pimple Saudagar; their own project should
    // rank above the unrelated one.
    assert.equal(res.json.projects[0].id, 'prjA1');
    assert.ok(res.json.projects[0].score > 0);
    assert.equal(res.json.projects.find((p) => p.id === 'prjA2').score, 0);

    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA2'] } });
    const after = await h.call('GET', `/api/customer-accounts/${c.accountId}/project-candidates`, { token: mgr });
    assert.equal(after.json.projects[0].id, 'prjA2', 'what is in force is shown first so it can be undone');
    assert.equal(after.json.projects[0].linked, true);
  } finally { h.server.close(); }
});

test('portal projects: switching an account off ends its access to the projects too', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });
    assert.equal((await h.call('GET', '/api/portal/projects', { token: c.token })).status, 200);

    await h.call('POST', `/api/customer-accounts/${c.accountId}/status`, { token: mgr, body: { status: 'Disabled' } });
    assert.equal((await h.call('GET', '/api/portal/projects', { token: c.token })).status, 401);
  } finally { h.server.close(); }
});

/* ---------------- photographs of the work ---------------- */

/** A real 1x1 PNG, so the byte sniffing is exercised for what it is. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const pngDataUri = `data:image/png;base64,${PNG_1PX.toString('base64')}`;

test('portal photos: a photograph is visible only while the update it hangs on is shared', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const up = await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'Ducting hung in the main hall' }] },
    });
    assert.equal(up.status, 201);
    const photoId = up.json.photos[0].id;
    assert.equal(up.json.photos[0].caption, 'Ducting hung in the main hall');
    assert.ok(!('data' in up.json.photos[0]), 'the bytes never come back in a listing');

    // The update is still private, so the photograph is too.
    let detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates, []);
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: c.token })).status, 404,
      'knowing the id is worth nothing while the update is unshared');

    await h.call('PATCH', '/api/projects/prjA1/updates/1/share', {
      token: admin, body: { shared: true, customerNote: 'Ducting has arrived and is going up.' },
    });

    detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.json.project.updates.length, 1);
    assert.deepEqual(detail.json.project.updates[0].photos.map((p) => p.caption), ['Ducting hung in the main hall']);
    assert.deepEqual(Object.keys(detail.json.project.updates[0].photos[0]).sort(), ['caption', 'id']);
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: c.token })).status, 200);

    // Un-sharing the words closes the pictures in the same moment.
    await h.call('PATCH', '/api/projects/prjA1/updates/1/share', { token: admin, body: { shared: false } });
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: c.token })).status, 404);
    detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates, []);
  } finally { h.server.close(); }
});

test('portal photos: photographs of an unshared update are never listed beside a shared one', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    // Update 0 stays internal; update 1 is published. Both carry pictures.
    const secret = await h.call('POST', '/api/projects/prjA1/updates/0/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'Vendor quote on the wall' }] },
    });
    await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'Ducting on site' }] },
    });
    await h.call('PATCH', '/api/projects/prjA1/updates/1/share', { token: admin, body: { shared: true } });

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.equal(detail.json.project.updates.length, 1);
    assert.deepEqual(detail.json.project.updates[0].photos.map((p) => p.caption), ['Ducting on site']);
    assert.ok(!JSON.stringify(detail.json).includes('Vendor quote on the wall'),
      'a caption on an unshared update does not leak either');
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${secret.json.photos[0].id}`, { token: c.token })).status, 404);
  } finally { h.server.close(); }
});

test('portal photos: another client cannot read a photograph, whatever the id', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const gastro = await h.activeClient({ phone: '9422011111', name: 'Mr Nemade' });
    const moto = await h.activeClient({ phone: '9422022222', name: 'Moto Owner' });
    await h.call('PUT', `/api/customer-accounts/${gastro.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });
    await h.call('PUT', `/api/customer-accounts/${moto.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA2'] } });

    const up = await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'On site' }] },
    });
    await h.call('PATCH', '/api/projects/prjA1/updates/1/share', { token: admin, body: { shared: true } });
    const photoId = up.json.photos[0].id;

    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: gastro.token })).status, 200);
    // The other client knows the id and their own project id. Neither helps.
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: moto.token })).status, 404);
    assert.equal((await h.call('GET', `/api/portal/projects/prjA2/photos/${photoId}`, { token: moto.token })).status, 404,
      'a photograph cannot be read through a project it does not belong to');
  } finally { h.server.close(); }
});

test('portal photos: what is not an image is refused, whatever it claims to be', async () => {
  const h = await harness();
  try {
    const admin = await h.staffToken('adm');

    const script = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    const bad = await h.call('POST', '/api/projects/prjA1/updates/0/photos', { token: admin, body: { photos: [script] } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /JPEG, PNG or WebP/);

    const empty = await h.call('POST', '/api/projects/prjA1/updates/0/photos', { token: admin, body: { photos: [] } });
    assert.equal(empty.status, 400);

    // One bad image in a batch rejects the whole batch — never half-stored.
    const mixed = await h.call('POST', '/api/projects/prjA1/updates/0/photos', {
      token: admin, body: { photos: [pngDataUri, script] },
    });
    assert.equal(mixed.status, 400);
    const list = await h.call('GET', '/api/projects/prjA1/photos', { token: admin });
    assert.deepEqual(list.json.photos, [], 'the good image in the rejected batch was not kept');
  } finally { h.server.close(); }
});

test('portal photos: an update takes six photographs and no more', async () => {
  const h = await harness();
  try {
    const admin = await h.staffToken('adm');
    const six = Array.from({ length: 6 }, () => pngDataUri);
    assert.equal((await h.call('POST', '/api/projects/prjA1/updates/0/photos', { token: admin, body: { photos: six } })).status, 201);

    const over = await h.call('POST', '/api/projects/prjA1/updates/0/photos', { token: admin, body: { photos: [pngDataUri] } });
    assert.equal(over.status, 400);
    assert.match(over.json.error, /already has 6/);

    // The limit is per update, so the next update is free to take its own.
    assert.equal((await h.call('POST', '/api/projects/prjA1/updates/1/photos', { token: admin, body: { photos: [pngDataUri] } })).status, 201);
  } finally { h.server.close(); }
});

test('portal photos: a client cannot upload, and staff of another company cannot read', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const mgrB = await h.staffToken('mgrb');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const up = await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'On site' }] },
    });
    const photoId = up.json.photos[0].id;

    const asClient = await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: c.token, body: { photos: [pngDataUri] },
    });
    assert.equal(asClient.status, 401, 'a client cannot put pictures on their own project');

    assert.equal((await h.call('GET', `/api/projects/prjA1/photos/${photoId}`, { token: mgrB })).status, 404);
    assert.equal((await h.call('DELETE', `/api/projects/prjA1/photos/${photoId}`, { token: mgrB })).status, 404);
  } finally { h.server.close(); }
});

test('portal photos: the PM can take a photograph down again', async () => {
  const h = await harness();
  try {
    const mgr = await h.staffToken('mgr');
    const admin = await h.staffToken('adm');
    const c = await h.activeClient();
    await h.call('PUT', `/api/customer-accounts/${c.accountId}/projects`, { token: mgr, body: { projectIds: ['prjA1'] } });

    const up = await h.call('POST', '/api/projects/prjA1/updates/1/photos', {
      token: admin, body: { photos: [{ data: pngDataUri, caption: 'Wrong site' }] },
    });
    await h.call('PATCH', '/api/projects/prjA1/updates/1/share', { token: admin, body: { shared: true } });
    const photoId = up.json.photos[0].id;
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: c.token })).status, 200);

    const gone = await h.call('DELETE', `/api/projects/prjA1/photos/${photoId}`, { token: admin });
    assert.equal(gone.status, 200);
    assert.equal((await h.call('GET', `/api/portal/projects/prjA1/photos/${photoId}`, { token: c.token })).status, 404);

    const detail = await h.call('GET', '/api/portal/projects/prjA1', { token: c.token });
    assert.deepEqual(detail.json.project.updates[0].photos, []);
  } finally { h.server.close(); }
});
