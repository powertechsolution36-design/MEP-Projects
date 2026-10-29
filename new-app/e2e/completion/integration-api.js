'use strict';
/**
 * Frontend <-> backend integration probe (HTTP level, no browser).
 *
 * Runs against the same in-memory dev assembly as run.js / pages.js — never
 * a database. Start the server first (node e2e/completion/server.js, port
 * 4100, fresh for each run), then:  node e2e/completion/integration-api.js
 *
 * Sections:
 *   A  every backend route is mounted (unauthenticated -> 401, never 404)
 *   B  authentication / session lifecycle (username-only login, super without
 *      company, logout revocation, tampered/expired tokens, inactive user,
 *      suspended company — live checks on every request)
 *   C  read access per role for every GET route (matrix + asserted rules)
 *   D  write access per role for every mutating route (no 5xx; denials 403)
 *   E  cross-company isolation (a second company's users can neither read
 *      nor change the first company's records, nor see them in lists)
 *   F  purchased-division and PM-division enforcement
 * Writes integration-api-results.json beside this file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';
const PASSWORD = 'password123';
const SECRET = process.env.AUTH_TOKEN_SECRET || 'e2e-only-secret'; // e2e/completion/server.js's own test-only secret
const results = [];
const matrices = {};
// OPEN = verified behaviour that needs an owner decision (not a pass/fail of the code as specified).
const notVerified = (section, name, detail = '') => {
  results.push({ section, name, status: 'NOT VERIFIED', detail });
  console.log(`[NOT VERIFIED] ${section} ${name}${detail ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`);
};
const open = (section, name, detail = '') => {
  results.push({ section, name, status: 'OPEN', detail });
  console.log(`[OPEN] ${section} ${name}${detail ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`);
};
const rec = (section, name, pass, detail = '') => {
  results.push({ section, name, status: pass ? 'PASS' : 'FAIL', detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${section} ${name}${detail ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`);
};

async function call(method, p, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') || '' };
}
async function login(username, password = PASSWORD) { return call('POST', '/api/auth/login', { body: { username, password } }); }
async function token(username) { const r = await login(username); if (!r.json || !r.json.token) throw new Error(`login ${username}: ${r.status} ${r.text}`); return r.json.token; }

/* ---- backend route inventory, read from the route files (same source the server mounts) ---- */
function backendRoutes() {
  const B = path.join(__dirname, '..', '..', 'backend', 'src');
  const app = fs.readFileSync(path.join(B, 'app.js'), 'utf8');
  const mounts = {};
  for (const m of app.matchAll(/app\.use\('([^']+)',\s*create(\w+)Router/g)) mounts[m[2]] = m[1];
  const out = [{ method: 'GET', path: '/api/health', open: true }];
  for (const f of fs.readdirSync(path.join(B, 'routes'))) {
    const s = fs.readFileSync(path.join(B, 'routes', f), 'utf8');
    const fn = (s.match(/function create(\w+)Router/) || [])[1];
    const base = mounts[fn];
    if (!base) continue;
    for (const m of s.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      // /api/public/* are the login-free client PDF links, keyed by an
      // unguessable token: a made-up token must get 404, never the document.
      const full = m[2] === '/' ? base : base + m[2];
      out.push({
        method: m[1].toUpperCase(),
        path: full,
        publicToken: base === '/api/public',
        // Owner decision (27 Oct 2026): a client registers and signs in
        // without a login — these are the only unauthenticated write
        // endpoints in the application. They must still refuse an empty
        // body rather than doing anything.
        portalPublic: full === '/api/portal/auth/register' || full === '/api/portal/auth/login',
      });
    }
  }
  return out;
}

const ROLES = { super: 'Sam', admin: 'admin', sales: 'sales', hvac_pm: 'amol', solar_pm: 'akshay', mep_pm: 'ajinkya', engineer: 'vinod', inventory: 'store', service_mgr: 'service', service_eng: 'israr', finance: 'finance' };
// Real records of the demo company (e2e/completion/fixture.js) used to fill :params.
const FIXTURE = {
  '/api/enquiries/': 'enq_open', '/api/sales-orders/': 'so_demo', '/api/projects/': 'prj_demo', '/api/contracts/': 'amc_demo',
  '/api/service-calls/': 'svc_demo', '/api/payments/': 'pay_plain', '/api/companies/': 'company_demo', '/api/subscriptions/company/': 'company_demo',
  '/api/amc-documents/generate/': 'amc_demo', '/api/users/': 'seed_user_2', '/api/contracts/from-project/': 'prj_demo', '/api/service-calls/pm/': 'amc_demo',
};
function concrete(p, ids = FIXTURE) {
  let out = p;
  for (const [prefix, id] of Object.entries(ids)) if (out.startsWith(prefix) && /^\/:\w+/.test('/' + out.slice(prefix.length))) { out = prefix + id + out.slice(prefix.length).replace(/^:\w+/, ''); break; }
  return out.replace(/:templateType\b/, 'comprehensive').replace(/:type\b/, 'comprehensive').replace(/:code\b/, 'hvac_starter')
    .replace(/:i\b|:mi\b/g, '0').replace(/:partId\b/, 'pp_1').replace(/:\w+/g, 'nope_404');
}

(async () => {
  const routes = backendRoutes();
  const tok = {};
  for (const [role, u] of Object.entries(ROLES)) tok[role] = await token(u);

  /* ---------------- A. mounts ---------------- */
  {
    const missing = [];
    for (const r of routes) {
      const res = await call(r.method, concrete(r.path), r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} });
      const ok = r.open ? res.status === 200
        : r.publicToken ? res.status === 404
        : r.portalPublic ? [400, 401, 429].includes(res.status) : r.path === '/api/auth/login' ? res.status === 400 || res.status === 401 : res.status === 401;
      if (!ok) missing.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    rec('A', `all ${routes.length} backend routes are mounted and refuse anonymous callers (401)`, missing.length === 0, missing.join('; '));
  }

  /* ---------------- B. authentication / session ---------------- */
  {
    const r = await login('admin');
    rec('B', 'username + password login (no company field) returns a token and the user', r.status === 200 && !!r.json?.token && r.json?.user?.role === 'admin' && !('passwordHash' in (r.json.user || {})), `${r.status}`);
    const w = await login('admin', 'wrong-password');
    rec('B', 'wrong password -> 401 with an error message', w.status === 401 && !!w.json?.error, `${w.status}`);
    const n = await login('no_such_user_xyz');
    rec('B', 'unknown username -> 401 (same message, no user enumeration)', n.status === 401 && n.json?.error === w.json?.error, `${n.status} "${n.json?.error}" vs "${w.json?.error}"`);
    const s = await call('GET', '/api/auth/me', { token: tok.super });
    rec('B', 'super admin logs in without a company (companyId null)', s.status === 200 && s.json?.user?.role === 'super' && !s.json?.user?.companyId, JSON.stringify(s.json?.user || {}).slice(0, 120));
    const sb = await call('GET', '/api/enquiries', { token: tok.super });
    rec('B', 'super admin is refused company business data (no tenant)', sb.status === 403 || sb.status === 400, `${sb.status}`);

    // logout revokes the session
    const t = await token('sales');
    const lo = await call('POST', '/api/auth/logout', { token: t });
    const after = await call('GET', '/api/auth/me', { token: t });
    rec('B', 'logout revokes the session (old token -> 401)', lo.status < 300 && after.status === 401, `${lo.status}/${after.status}`);

    // tampered and expired tokens
    const parts = tok.admin.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const forged = parts[0] + '.' + Buffer.from(JSON.stringify({ ...claims, role: 'super', companyId: null })).toString('base64url') + '.' + parts[2];
    rec('B', 'tampered token (role edited) -> 401', (await call('GET', '/api/auth/me', { token: forged })).status === 401);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ ...claims, iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 });
    const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
    rec('B', 'expired token (valid signature, past exp) -> 401', (await call('GET', '/api/auth/me', { token: `${head}.${body}.${sig}` })).status === 401);
    const otherSig = crypto.createHmac('sha256', 'not-the-secret').update(`${head}.${b64({ ...claims })}`).digest('base64url');
    rec('B', 'token signed with another secret -> 401', (await call('GET', '/api/auth/me', { token: `${head}.${b64({ ...claims })}.${otherSig}` })).status === 401);
    rec('B', 'missing / malformed Authorization header -> 401', (await call('GET', '/api/auth/me', { token: 'garbage' })).status === 401);
  }

  /* ---------------- E-setup: a second company with one user per role ---------------- */
  const sfx = Date.now().toString(36);
  const bAdmin = `bco_admin_${sfx}`;
  const cb = await call('POST', '/api/companies', { token: tok.super, body: { company: { name: `Beta Co ${sfx}`, divs: ['HVAC'], status: 'Active', city: 'Mumbai', subscriptionRate: 1000, subscriptionCycle: 'Monthly', subscriptionStart: new Date().toISOString().slice(0, 10) }, admin: { username: bAdmin, password: PASSWORD } } });
  const B_ID = cb.json?.company?.id;
  rec('E', 'second company created by super (HVAC only)', cb.status === 201 && !!B_ID, `${cb.status} ${cb.text.slice(0, 160)}`);
  const btok = { admin: await token(bAdmin) };
  for (const role of ['sales', 'hvac_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance']) {
    const u = `b_${role}_${sfx}`;
    const c = await call('POST', '/api/users', { token: btok.admin, body: { name: `B ${role}`, username: u, password: PASSWORD, role } });
    if (c.status === 201) btok[role] = await token(u);
    else rec('E', `company B ${role} user created`, false, `${c.status} ${c.text.slice(0, 120)}`);
  }

  /* ---------------- B (cont.). inactive user, suspended company ---------------- */
  {
    // The app removes users (PWA delUser); there is no separate "deactivate" action.
    const u = `b_temp_${sfx}`;
    const c = await call('POST', '/api/users', { token: btok.admin, body: { name: 'Temp', username: u, password: PASSWORD, role: 'sales' } });
    const t = await token(u);
    const d = await call('DELETE', `/api/users/${c.json?.user?.id}`, { token: btok.admin });
    const me = await call('GET', '/api/auth/me', { token: t });
    const relog = await login(u);
    rec('B', 'deleted user: existing token rejected at once and login refused', d.status === 200 && me.status === 401 && relog.status === 401, `${d.status}/${me.status}/${relog.status}`);
    // PWA delUser: removal only. A deactivation request must be refused, not answered with a silent 200.
    const u3 = `b_deact_${sfx}`;
    const c3 = await call('POST', '/api/users', { token: btok.admin, body: { name: 'Deact', username: u3, password: PASSWORD, role: 'sales' } });
    const t3 = await token(u3);
    const de = await call('PATCH', `/api/users/${c3.json?.user?.id}`, { token: btok.admin, body: { active: false } });
    rec('B', 'deactivation request is refused (400 UNSUPPORTED_FIELD) and the user is unchanged', de.status === 400 && de.json?.code === 'UNSUPPORTED_FIELD' && (await call('GET', '/api/auth/me', { token: t3 })).status === 200, `${de.status} ${de.json?.code}`);
    // A role change takes effect on the very next request (the token's role claim is not trusted).
    const u2 = `b_role_${sfx}`;
    const c2 = await call('POST', '/api/users', { token: btok.admin, body: { name: 'Role', username: u2, password: PASSWORD, role: 'sales' } });
    const t2 = await token(u2);
    const before = (await call('GET', '/api/enquiries', { token: t2 })).status;
    await call('PATCH', `/api/users/${c2.json?.user?.id}`, { token: btok.admin, body: { role: 'engineer' } });
    const afterRole = (await call('GET', '/api/enquiries', { token: t2 })).status;
    const meRole = (await call('GET', '/api/auth/me', { token: t2 })).json?.user?.role;
    rec('B', 'role change applies at once to an existing session (sales -> engineer loses Enquiries)', before === 200 && afterRole === 403 && meRole === 'engineer', `${before}/${afterRole}/${meRole}`);
    const sus = await call('POST', `/api/companies/${B_ID}/status`, { token: tok.super, body: { status: 'Suspended' } });
    const me2 = await call('GET', '/api/auth/me', { token: btok.admin });
    const relog2 = await login(bAdmin);
    rec('B', 'suspended company: its users are cut off at once and cannot log in', sus.status === 200 && me2.status === 401 && relog2.status !== 200, `${sus.status}/${me2.status}/${relog2.status} ${relog2.json?.error || ''}`);
    const act = await call('POST', `/api/companies/${B_ID}/status`, { token: tok.super, body: { status: 'Active' } });
    btok.admin = await token(bAdmin);
    rec('B', 'reactivated company: login works again', act.status === 200 && !!btok.admin, `${act.status}`);
    for (const role of Object.keys(btok)) if (role !== 'admin') btok[role] = await token(`b_${role}_${sfx}`);
  }

  /* ---------------- C. read access per role ---------------- */
  await call('POST', '/api/subscriptions/plans/seed', { token: tok.super }); // so /plans/:code has a real plan
  const getRoutes = routes.filter((r) => r.method === 'GET' && !r.open);
  {
    const m = {};
    let fivexx = [];
    for (const r of getRoutes) {
      const p = concrete(r.path);
      m[`GET ${r.path}`] = {};
      for (const role of Object.keys(ROLES)) {
        const res = await call('GET', p, { token: tok[role] });
        m[`GET ${r.path}`][role] = res.status;
        if (res.status >= 500) fivexx.push(`${role} GET ${p} -> ${res.status}`);
      }
    }
    matrices.read = m;
    rec('C', `no GET route returns 5xx for any role (${getRoutes.length} routes x 11 roles)`, fivexx.length === 0, fivexx.join('; '));
    const allow = (route, roles) => {
      const row = m[`GET ${route}`]; if (!row) return rec('C', `${route} exists`, false);
      const wrong = Object.entries(row).filter(([role, st]) => (roles.includes(role) ? st !== 200 : st === 200)).map(([r, s]) => `${r}:${s}`);
      rec('C', `GET ${route}: only ${roles.join('/')} get 200`, wrong.length === 0, wrong.join(' '));
    };
    // Rules taken from the backend's own role constants and the PWA menus.
    allow('/api/users', ['admin']);
    allow('/api/companies', ['super']);
    allow('/api/companies/platform/usage', ['super']);
    allow('/api/payments', ['admin', 'finance']);
    allow('/api/sales-orders', ['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'finance']);
    allow('/api/sales-orders/:id', ['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'finance']); // PWA vSO: no PM-division gate on viewing
    allow('/api/inventory/issues', ['admin', 'inventory']);
    allow('/api/enquiries', ['admin', 'sales']);
    allow('/api/quotations', ['super', 'admin', 'sales', 'finance']); // super admitted "for support" (quotationRoutes.js)
    const sq = await call('GET', '/api/quotations', { token: tok.super });
    rec('C', 'super (no company) gets an empty quotation list, not other companies\' quotations', sq.status === 200 && Array.isArray(sq.json?.quotations) && sq.json.quotations.length === 0, `${sq.json?.quotations?.length}`);
    // Super has no company: company-scoped configuration written by super would be orphaned (companyId null).
    const ptt = await call('POST', '/api/payment-term-templates', { token: tok.super, body: { name: 'Super PTT', documentType: 'quotation', rows: [{ label: 'Advance', percentage: 100 }] } });
    const amc = await call('PUT', '/api/amc-documents/templates', { token: tok.super, body: { type: 'amc-letter', name: 'Super AMC', sections: [] } });
    rec('C', 'super (no company) cannot create company-less configuration: payment-term / AMC templates -> 403 COMPANY_CONTEXT_REQUIRED', ptt.status === 403 && amc.status === 403 && ptt.json?.code === 'COMPANY_CONTEXT_REQUIRED' && amc.json?.code === 'COMPANY_CONTEXT_REQUIRED', `${ptt.status}/${amc.status}`);
    allow('/api/subscriptions/plans', ['super']);
    allow('/api/subscriptions/plans/:code', ['super']);
    allow('/api/payments/:id', ['admin', 'finance']);
    allow('/api/users/:id', ['admin']);
    allow('/api/inventory/my-material', ['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance']);
  }

  /* ---------------- D. write access per role (non-existent ids, empty bodies) ---------------- */
  {
    const mut = routes.filter((r) => r.method !== 'GET' && r.path !== '/api/auth/login' && r.path !== '/api/auth/logout');
    const m = {}; const fivexx = [];
    for (const r of mut) {
      const p = r.path.replace(/:\w+/g, 'nope_404').replace(/\/nope_404\/(milestones|checklist|delivery-challans|items|part-payments)\/nope_404/, '/nope_404/$1/0');
      m[`${r.method} ${r.path}`] = {};
      for (const role of Object.keys(ROLES)) {
        const res = await call(r.method, p, { token: tok[role], body: r.method === 'DELETE' ? undefined : {} });
        m[`${r.method} ${r.path}`][role] = res.status;
        if (res.status >= 500) fivexx.push(`${role} ${r.method} ${p} -> ${res.status} ${res.json?.error || ''}`);
      }
    }
    matrices.write = m;
    rec('D', `no mutating route returns 5xx for any role (${mut.length} routes x 11 roles, empty body / unknown id)`, fivexx.length === 0, fivexx.slice(0, 12).join('; '));
    const succeeded = Object.entries(m).flatMap(([k, row]) => Object.entries(row).filter(([, s]) => s >= 200 && s < 300).map(([role, s]) => `${role} ${k} ${s}`));
    matrices.writeSucceededOnEmpty = succeeded;
  }

  /* ---------------- E. cross-company isolation ---------------- */
  {
    const leaks = [];
    for (const r of getRoutes) {
      if (!r.path.includes(':')) continue;
      if (r.path.startsWith('/api/companies/') || r.path.startsWith('/api/subscriptions/')) continue; // super-only, checked below
      if (r.path.startsWith('/api/amc-documents/templates/')) continue; // per-company template, checked separately below
      for (const [role, t] of Object.entries(btok)) {
        const res = await call('GET', concrete(r.path), { token: t });
        if (res.status === 200) leaks.push(`${role} GET ${concrete(r.path)}`);
      }
    }
    rec('E', 'company B users get no company-A record by id (every GET /:id route)', leaks.length === 0, leaks.join('; '));
    const MARKERS = ['Poonawalla', 'Sai Residency', 'company_demo', 'Intervalve', 'KP87'];
    const listLeaks = [];
    for (const r of getRoutes) {
      if (r.path.includes(':')) continue;
      for (const [role, t] of Object.entries(btok)) {
        const res = await call('GET', r.path, { token: t });
        if (res.status === 200 && MARKERS.some((mk) => res.text.includes(mk))) listLeaks.push(`${role} GET ${r.path}`);
      }
    }
    rec('E', 'no company-B list, report or CSV contains company-A data', listLeaks.length === 0, listLeaks.join('; '));
    const writes = [
      ['PATCH', '/api/enquiries/enq_open', { remark: 'x' }], ['POST', '/api/enquiries/enq_open/follow-ups', { actionDone: 'x' }],
      ['POST', '/api/enquiries/enq_open/mark-lost', { lostReason: 'x' }], ['PATCH', '/api/sales-orders/so_demo', { projectName: 'x' }],
      ['POST', '/api/sales-orders/so_demo/milestones/0/raise', { note: 'x' }], ['POST', '/api/projects/prj_demo/updates', { text: 'x' }],
      ['POST', '/api/projects/prj_demo/stage', { stage: 'Completed' }], ['POST', '/api/payments/pay_plain/part-payments', { amount: 1 }],
      ['DELETE', '/api/payments/pay_plain'], ['PUT', '/api/service-calls/svc_demo/assign', { engineerId: 'x' }],
      ['POST', '/api/service-calls/svc_demo/complete', { signature: 'data:image/png;base64,AA' }], ['POST', '/api/service-calls/pm/amc_demo', {}],
      ['POST', '/api/contracts/from-project/prj_demo', {}], ['PATCH', '/api/users/seed_user_2', { name: 'x' }], ['DELETE', '/api/users/seed_user_2'],
      ['PATCH', '/api/notifications/nope/read', {}],
    ];
    const wl = [];
    for (const [meth, p, body] of writes) for (const [role, t] of Object.entries(btok)) {
      const res = await call(meth, p, { token: t, body });
      if (res.status < 300) wl.push(`${role} ${meth} ${p} ${res.status}`);
    }
    rec('E', `company B users cannot change company-A records (${writes.length} writes x ${Object.keys(btok).length} roles)`, wl.length === 0, wl.join('; '));
    const spoof = await call('GET', '/api/enquiries?companyId=company_demo', { token: btok.admin });
    rec('E', 'a client-supplied companyId is refused (403)', spoof.status === 403, `${spoof.status}`);
    const spoof2 = await call('POST', '/api/enquiries', { token: btok.sales, body: { companyId: 'company_demo', name: 'x', segment: 'HVAC' } });
    rec('E', 'a body companyId of another company is refused (403)', spoof2.status === 403, `${spoof2.status}`);
    const ownA = await call('GET', '/api/enquiries/enq_open', { token: tok.admin });
    rec('E', 'control: company A admin still reads its own record', ownA.status === 200);
    // AMC template wording is per company: A's edit is invisible to B.
    const tA = await call('GET', '/api/amc-documents/templates/amc-letter', { token: tok.admin });
    const secs = (tA.json?.template?.sections || []).map((x) => (x.key === 'salutation' ? { ...x, content: 'A-ONLY-WORDING' } : x));
    const put = await call('PUT', '/api/amc-documents/templates', { token: tok.admin, body: { type: 'amc-letter', name: tA.json?.template?.name || 'AMC Letter', sections: secs } });
    const tA2 = await call('GET', '/api/amc-documents/templates/amc-letter', { token: tok.admin });
    const tB = await call('GET', '/api/amc-documents/templates/amc-letter', { token: btok.admin });
    rec('E', 'AMC template edits are per company (A sees its wording, B keeps the default)', put.status === 200 && tA2.text.includes('A-ONLY-WORDING') && tB.status === 200 && !tB.text.includes('A-ONLY-WORDING'), `${put.status}`);
    // Unknown company ids: 404, never a fabricated record.
    const pc = await call('PATCH', '/api/companies/no_such_company', { token: tok.super, body: { name: 'x' } });
    const dc = await call('DELETE', '/api/companies/no_such_company', { token: tok.super });
    rec('E', 'super: PATCH / DELETE of an unknown company -> 404', pc.status === 404 && dc.status === 404, `${pc.status}/${dc.status}`);
  }

  /* ---------------- F. divisions ---------------- */
  {
    const bs = btok.sales; const ba = btok.admin;
    const e = await call('POST', '/api/enquiries', { token: bs, body: { name: 'E2E Solar', segment: 'Solar', siteType: 'Residential' } });
    const e2 = await call('POST', '/api/enquiries', { token: bs, body: { name: 'E2E AMC', segment: 'AMC', siteType: 'Residential' } });
    rec('F', 'HVAC-only company: Solar enquiry refused (403), AMC enquiry allowed', e.status === 403 && e2.status === 201, `${e.status}/${e2.status}`);
    const so = await call('POST', '/api/sales-orders', { token: ba, body: { division: 'Solar', projectName: 'x', startDate: '2026-10-16', paymentMilestones: [] } });
    rec('F', 'HVAC-only company: Solar sales order refused (403)', so.status === 403, `${so.status} ${so.json?.error || ''}`);
    const q = await call('POST', '/api/quotations', { token: ba, body: { division: 'Solar', customerName: 'x', equipmentItems: [], accessoriesItems: [] } });
    rec('F', 'HVAC-only company: Solar quotation refused (403)', q.status === 403, `${q.status} ${q.json?.error || ''}`);
    const ct = await call('POST', '/api/checklist-templates', { token: ba, body: { division: 'Solar', name: 'x' } });
    rec('F', 'HVAC-only company: Solar checklist template refused (403)', ct.status === 403, `${ct.status} ${ct.json?.error || ''}`);
    const pmu = await call('POST', '/api/users', { token: ba, body: { name: 'x', username: `b_spm_${sfx}`, password: PASSWORD, role: 'solar_pm' } });
    rec('F', 'HVAC-only company: creating a Solar PM is refused with a 4xx (not a server error)', pmu.status >= 400 && pmu.status < 500, `${pmu.status} ${pmu.json?.error || ''}`);
    const md = await call('GET', '/api/subscriptions/my-divisions', { token: ba });
    rec('F', 'my-divisions reports the purchased list (HVAC)', JSON.stringify(md.json?.divisions) === '["HVAC"]', md.text.slice(0, 80));
    // PM division restriction inside company A (so_demo / prj_demo are HVAC)
    // PWA: vProjects lists only the PM's own division; vProject / vSO themselves are not gated,
    // but every PM action on a project is (canPM = admin or PM_DIV[role] === p.div).
    const lp = {};
    for (const role of ['hvac_pm', 'solar_pm', 'mep_pm']) lp[role] = ((await call('GET', '/api/projects', { token: tok[role] })).json?.projects || []).map((x) => x.division);
    rec('F', 'project lists are scoped to the PM division (HVAC PM sees HVAC; Solar / MEP PMs see none of HVAC)', lp.hvac_pm.length > 0 && lp.hvac_pm.every((d) => d === 'HVAC') && !lp.solar_pm.includes('HVAC') && !lp.mep_pm.includes('HVAC'), JSON.stringify(lp));
    const acts = [['POST', '/api/projects/prj_demo/stage', { stage: 'Testing' }], ['PATCH', '/api/projects/prj_demo/vendor', { vendor: 'x' }],
      ['POST', '/api/projects/prj_demo/checklist', { text: 'x' }], ['POST', '/api/projects/prj_demo/timeline', { items: [] }]];
    const wrongPm = [];
    for (const role of ['solar_pm', 'mep_pm']) for (const [meth, p, body] of acts) {
      const res = await call(meth, p, { token: tok[role], body });
      if (res.status < 300) wrongPm.push(`${role} ${meth} ${p} ${res.status}`);
    }
    rec('F', 'Solar / MEP PMs cannot act on an HVAC project (stage, vendor, checklist, timeline)', wrongPm.length === 0, wrongPm.join('; '));
    const raise = await call('POST', '/api/sales-orders/so_demo/milestones/0/raise', { token: tok.solar_pm, body: { note: 'x' } });
    rec('F', 'Solar PM cannot raise an HVAC milestone (403/404)', raise.status === 403 || raise.status === 404, `${raise.status}`);
  }

  /* ---------------- G. calculations and status transitions (expected values from the PWA rules in the services) ---------------- */
  {
    const a = tok.admin;
    const eq = (x, y) => Number(x) === Number(y);
    // G1 HVAC quotation: 2 x (50,000 + 5,000) + 10 x (300 + 200) = 1,15,000; 18% = 20,700; total 1,35,700.
    const q1 = await call('POST', '/api/quotations', { token: a, body: { division: 'HVAC', customerName: 'G1', gstPercent: 18,
      equipmentItems: [{ description: 'Chiller', unit: 'Nos', qty: 2, supplyRate: 50000, installationRate: 5000 }],
      accessoriesItems: [{ description: 'Pipe', unit: 'Mtr', qty: 10, supplyRate: 300, installationRate: 200 }] } });
    const Q = q1.json?.quotation || {};
    rec('G', 'HVAC quotation totals: equipment 1,10,000 + accessories 5,000 = 1,15,000; GST 18% 20,700; grand 1,35,700',
      eq(Q.equipmentTotal, 110000) && eq(Q.accessoriesTotal, 5000) && eq(Q.subtotal, 115000) && eq(Q.gstAmount, 20700) && eq(Q.grandTotal, 135700), JSON.stringify({ e: Q.equipmentTotal, a: Q.accessoriesTotal, s: Q.subtotal, g: Q.gstAmount, t: Q.grandTotal }));
    const q2 = await call('PATCH', `/api/quotations/${Q.id}`, { token: a, body: { gstPercent: 12 } });
    rec('G', 'HVAC quotation re-totals on edit: GST 12% of 1,15,000 = 13,800; grand 1,28,800', eq(q2.json?.quotation?.gstAmount, 13800) && eq(q2.json?.quotation?.grandTotal, 128800), `${q2.status} ${q2.json?.quotation?.gstAmount}`);
    const q0 = await call('PATCH', `/api/quotations/${Q.id}`, { token: a, body: { gstPercent: 0 } });
    rec('G', 'HVAC quotation at 0% GST keeps 0 (not the 18% default)', eq(q0.json?.quotation?.gstPercent, 0) && eq(q0.json?.quotation?.gstAmount, 0), `${q0.json?.quotation?.gstPercent}/${q0.json?.quotation?.gstAmount}`);
    // G2 Solar: per-line GST; a line without a GST % uses 18%.
    const q3 = await call('POST', '/api/quotations', { token: a, body: { division: 'Solar', customerName: 'G2',
      equipmentItems: [{ description: 'Panel', qty: 10, supplyRate: 10000, gstPercent: 12 }, { description: 'Inverter', qty: 1, supplyRate: 50000, gstPercent: 18 }, { description: 'Structure', qty: 1, supplyRate: 10000 }], accessoriesItems: [] } });
    const S3 = q3.json?.quotation || {};
    rec('G', 'Solar quotation: GST = 12% of 1,00,000 + 18% of 50,000 + 18% (default) of 10,000 = 22,800; grand 1,82,800', eq(S3.gstAmount, 22800) && eq(S3.grandTotal, 182800), `${q3.status} ${S3.gstAmount}/${S3.grandTotal}`);
    // G3 Quotation status: a Sent quotation cannot be deleted; Duplicate gives a new Draft number.
    await call('PATCH', `/api/quotations/${Q.id}`, { token: a, body: { status: 'Sent' } });
    const delSent = await call('DELETE', `/api/quotations/${Q.id}`, { token: a });
    const dup = await call('POST', `/api/quotations/${Q.id}/duplicate`, { token: a });
    rec('G', 'quotation: Sent cannot be deleted (4xx); Duplicate is a new Draft with a new number', delSent.status >= 400 && delSent.status < 500 && dup.json?.quotation?.status === 'Draft' && dup.json?.quotation?.quotationNumber !== Q.quotationNumber, `${delSent.status} ${Q.quotationNumber} -> ${dup.json?.quotation?.quotationNumber}`);
    const badStatus = await call('PATCH', `/api/quotations/${Q.id}`, { token: a, body: { status: 'Invented' } });
    // Status values are enforced by the Mongoose enum (runValidators); the in-memory dev store has no schema.
    if (badStatus.status >= 400 && badStatus.status < 500) rec('G', 'quotation: an unknown status is refused (4xx)', true, `${badStatus.status}`);
    else notVerified('G', 'quotation: an unknown status is refused only by the Mongoose enum — needs the test replica set', `in-memory store answered ${badStatus.status}`);

    // G4 Payments: balance, status, overpayment confirmation, revert on delete.
    const f = tok.finance;
    const p = (await call('POST', '/api/payments', { token: f, body: { projectOrReference: 'G4 pay', amount: 10000 } })).json?.payment;
    const pp1 = await call('POST', `/api/payments/${p?.id}/part-payments`, { token: f, body: { amount: 4000, mode: 'UPI' } });
    let cur = (await call('GET', `/api/payments/${p?.id}`, { token: f })).json?.payment;
    const recv = (x) => (x?.partPayments || []).reduce((t, y) => t + Number(y.amount || 0), 0);
    rec('G', 'payment: 4,000 of 10,000 received -> balance 6,000, still Pending', pp1.status < 300 && recv(cur) === 4000 && 10000 - recv(cur) === 6000 && cur.status === 'Pending', `${cur?.status}`);
    const over = await call('POST', `/api/payments/${p?.id}/part-payments`, { token: f, body: { amount: 9000 } });
    rec('G', 'payment: more than the balance without confirmation is refused (4xx, OVERPAYMENT_CONFIRMATION_REQUIRED)', over.status >= 400 && over.status < 500 && over.json?.code === 'OVERPAYMENT_CONFIRMATION_REQUIRED', `${over.status} ${over.json?.code}`);
    await call('POST', `/api/payments/${p?.id}/part-payments`, { token: f, body: { amount: 6000 } });
    cur = (await call('GET', `/api/payments/${p?.id}`, { token: f })).json?.payment;
    rec('G', 'payment: the remaining 6,000 settles it -> Received with a received date', cur?.status === 'Received' && !!cur?.receivedDate, `${cur?.status} ${cur?.receivedDate}`);
    const last = (cur?.partPayments || []).slice(-1)[0];
    await call('DELETE', `/api/payments/${p?.id}/part-payments/${last?.id}`, { token: f });
    cur = (await call('GET', `/api/payments/${p?.id}`, { token: f })).json?.payment;
    rec('G', 'payment: removing a receipt reverts a settled record to Pending', cur?.status === 'Pending' && recv(cur) === 4000, `${cur?.status} ${recv(cur)}`);
    const neg = await call('POST', `/api/payments/${p?.id}/part-payments`, { token: f, body: { amount: -5 } });
    rec('G', 'payment: a zero/negative receipt is refused (4xx)', neg.status >= 400 && neg.status < 500, `${neg.status}`);

    // G5 Sales-order margins (Accessories margin uses actual expense when recorded, else target).
    const so = (await call('POST', '/api/sales-orders', { token: a, body: { division: 'HVAC', projectName: 'G5 SO', startDate: '2026-10-16', highSideSelling: 100000, highSidePurchase: 70000, lowSideCost: 30000, lowSideTargetExpense: 20000, lowSideActualExpense: 0, paymentMilestones: [{ description: 'Advance', amount: 1000 }] } })).json?.salesOrder;
    let M = (await call('GET', `/api/sales-orders/${so?.id}`, { token: a })).json?.salesOrder?.margins || {};
    const m1 = eq(M.equipmentMargin, 30000) && eq(M.accessoriesMargin, 10000) && eq(M.totalMargin, 40000);
    await call('PATCH', `/api/sales-orders/${so?.id}`, { token: a, body: { lowSideActualExpense: 25000 } });
    M = (await call('GET', `/api/sales-orders/${so?.id}`, { token: a })).json?.salesOrder?.margins || {};
    rec('G', 'SO margins: 30,000 / 10,000 / 40,000 on target; with actual 25,000 the accessories margin is 5,000 (total 35,000)', m1 && eq(M.accessoriesMargin, 5000) && eq(M.totalMargin, 35000), JSON.stringify(M));
    const soDiv = await call('PATCH', `/api/sales-orders/${so?.id}`, { token: btok.admin, body: { division: 'Solar' } });
    rec('G', 'SO: another company cannot edit it (404/403)', soDiv.status === 404 || soDiv.status === 403, `${soDiv.status}`);
    // G6 Milestone raise -> payment raised to finance with the collect-by date as next call.
    const raise = await call('POST', `/api/sales-orders/${so?.id}/milestones/0/raise`, { token: tok.hvac_pm, body: { note: 'G6', dueByDate: '2026-11-01', priority: 'Urgent' } });
    const rp = ((await call('GET', '/api/payments', { token: f })).json?.payments || []).find((x) => x.salesOrderId === so?.id && x.milestoneIndex === 0);
    rec('G', 'milestone raise: payment created with raisedToFinance (Urgent) and next call = collect-by date', raise.status === 200 && rp?.raisedToFinance?.priority === 'Urgent' && String(rp?.nextCallDate || '').startsWith('2026-11-01') && eq(rp?.amount, 1000), `${raise.status} ${rp?.nextCallDate}`);

    // G7 Contracts: visit schedule by AMC type, status by end date.
    const mk = async (amcType, end) => (await call('POST', '/api/contracts', { token: tok.service_mgr, body: { site: `G7 ${amcType} ${end}`, start: '2026-01-10', end, amcType, category: 'AMC', amount: 1 } })).json?.contract;
    const cq = await mk('Quarterly', '2027-01-09'); const cm = await mk('Monthly', '2027-01-09'); const ch = await mk('Half-Yearly', '2027-01-09');
    rec('G', 'contract visits: Quarterly 4 (Jan/Apr/Jul/Oct), Monthly 12, Half-Yearly 2', (cq?.scheduledVisits || []).map((v) => v.month).join(',') === '2026-01,2026-04,2026-07,2026-10' && (cm?.scheduledVisits || []).length === 12 && (ch?.scheduledVisits || []).length === 2, `${(cq?.scheduledVisits || []).map((v) => v.month)}`);
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await mk('Quarterly', day(30)); await mk('Quarterly', day(-1)); await mk('Quarterly', day(120));
    // The server's status (computeContractStatus) is exposed through Renewal Opportunities (every non-Active contract).
    const ren = (await call('GET', '/api/contracts/renewal-opportunities', { token: tok.service_mgr })).json?.rows || [];
    const st2 = (end) => (ren.find((x) => x.contract.site === `G7 Quarterly ${end}`) || { status: 'Active' }).status;
    rec('G', 'contract status: ends in 30 days -> Expiring Soon (45-day window), ended yesterday -> Expired, ends in 120 days -> Active', st2(day(30)) === 'Expiring Soon' && st2(day(-1)) === 'Expired' && st2(day(120)) === 'Active', `${st2(day(30))}/${st2(day(-1))}/${st2(day(120))}`);

    // G8 Service calls: Chargeable completion creates one payment; re-completion creates none; AMC creates none.
    const sm = tok.service_mgr;
    // A call completes only with a filled report (description + every checklist point).
    const G8_REPORT = { serviceType: 'Chargeable', amount: 2500, serviceDescription: 'G8 service',
      checklistResults: Object.fromEntries(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'].map((k) => [k, 'Done'])) };
    const mkCall = async () => (await call('POST', '/api/service-calls/complaints', { token: sm, body: { customer: 'G8 ' + Math.random(), phone: '9800000000', site: 'G8 site' } })).json?.serviceCall;
    const c1 = await mkCall();
    const done1 = await call('POST', `/api/service-calls/${c1?.id}/complete`, { token: sm, body: { report: G8_REPORT, signature: 'data:image/png;base64,iVBORw0KGgo=' } });
    const again = await call('POST', `/api/service-calls/${c1?.id}/complete`, { token: sm, body: { report: G8_REPORT, signature: 'data:image/png;base64,iVBORw0KGgo=' } });
    const pays = ((await call('GET', '/api/payments', { token: f })).json?.payments || []).filter((x) => String(x.projectOrReference || '').includes(`(PSC-${c1?.complaintNumber})`));
    rec('G', 'service call: Chargeable 2,500 completion -> exactly one Pending payment of 2,500, even if completed twice', done1.status === 200 && again.status === 200 && pays.length === 1 && eq(pays[0].amount, 2500) && pays[0].status === 'Pending', `${done1.status}/${again.status} payments=${pays.length}`);
    const c2 = await mkCall();
    const amcDone = await call('POST', `/api/service-calls/${c2?.id}/complete`, { token: sm, body: { report: { ...G8_REPORT, serviceType: 'AMC', amount: 0 }, signature: 'data:image/png;base64,iVBORw0KGgo=' } });
    const pays2 = ((await call('GET', '/api/payments', { token: f })).json?.payments || []).filter((x) => String(x.projectOrReference || '').includes(`(PSC-${c2?.complaintNumber})`));
    const c3 = await mkCall();
    const nosig = await call('POST', `/api/service-calls/${c3?.id}/complete`, { token: sm, body: { report: { serviceType: 'AMC' } } });
    rec('G', 'service call: AMC completion creates no payment; completion without a signature is refused (400)', amcDone.status === 200 && pays2.length === 0 && nosig.status === 400, `${amcDone.status} ${pays2.length} ${nosig.status}`);

    // G9 Trial dates
    const tr = await call('POST', '/api/companies', { token: tok.super, body: { company: { name: 'G9 Trial ' + Date.now(), divs: ['HVAC'], status: 'Trial' }, admin: { username: 'g9_' + Date.now().toString(36), password: PASSWORD } } });
    const tc = tr.json?.company || {};
    const days = (new Date(tc.trialEnd) - new Date(tc.since)) / 86400000;
    rec('G', 'trial company: trialEnd is exactly 15 whole days after the joining day', tr.status === 201 && days === 15, `${tr.status} ${tc.since} -> ${tc.trialEnd} (${days})`);

    // G10 Enquiry transitions
    const sT = tok.sales;
    const en = (await call('POST', '/api/enquiries', { token: sT, body: { name: 'G10', segment: 'HVAC', siteType: 'Residential' } })).json?.enquiry;
    const lost = await call('POST', `/api/enquiries/${en?.id}/mark-lost`, { token: sT, body: { lostReason: 'Price', remark: 'x' } });
    const convLost = await call('POST', `/api/enquiries/${en?.id}/convert`, { token: sT, body: { division: 'HVAC', projectName: 'G10', startDate: '2026-10-16' } });
    const lostAgain = await call('POST', `/api/enquiries/${en?.id}/mark-lost`, { token: sT, body: { lostReason: 'Price' } });
    const reopen = await call('POST', `/api/enquiries/${en?.id}/reopen`, { token: sT });
    const conv = await call('POST', `/api/enquiries/${en?.id}/convert`, { token: sT, body: { division: 'HVAC', projectName: 'G10', startDate: '2026-10-16' } });
    const conv2 = await call('POST', `/api/enquiries/${en?.id}/convert`, { token: sT, body: { division: 'HVAC', projectName: 'G10', startDate: '2026-10-16' } });
    const lostWon = await call('POST', `/api/enquiries/${en?.id}/mark-lost`, { token: sT, body: { lostReason: 'Price' } });
    const finalE = (await call('GET', `/api/enquiries/${en?.id}`, { token: sT })).json?.enquiry;
    rec('G', 'enquiry transitions: Open->Lost ok; convert/mark-lost on Lost refused; reopen ok; convert ok once (2nd refused); Won cannot be marked lost',
      lost.status === 200 && convLost.status >= 400 && lostAgain.status >= 400 && reopen.status === 200 && conv.status === 201 && conv2.status >= 400 && lostWon.status >= 400 && finalE?.status === 'Won',
      [lost, convLost, lostAgain, reopen, conv, conv2, lostWon].map((x) => x.status).join('/') + ` ${finalE?.status}`);
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  fs.writeFileSync(path.join(__dirname, 'integration-api-results.json'), JSON.stringify({ results, matrices }, null, 1));
  const nv = results.filter((r) => r.status === 'NOT VERIFIED').length;
  console.log(`\nTOTAL ${results.length}  PASS ${pass}  FAIL ${fail}  OPEN ${results.length - pass - fail - nv}  NOT VERIFIED ${nv}`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 2; });
