'use strict';
/**
 * Frontend <-> backend integration through the real UI: every frontend API
 * call site that run.js / pages.js do not already drive. Each step performs
 * the user action in the browser, then confirms the result on the server
 * through the API (never just "the page rendered"), and records any alert
 * the page raised (a page alert after a request means the server refused it).
 *
 * Same in-memory dev assembly as run.js (never a database):
 *   cd new-app/frontend && npm run build
 *   node e2e/completion/server.js           (port 4100; restart before each run)
 *   node e2e/completion/integration-ui.js [6a 6b ...]   (default: every group)
 * Set PLAYWRIGHT_MODULE / CHROMIUM_PATH if Playwright is not resolvable.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';
const PASSWORD = 'password123';
const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`);
};
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4);
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// 1x1 PNG for the checklist photo upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function apiToken(username) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const j = await r.json();
  if (!j.token) throw new Error(`API login failed for ${username}: ${JSON.stringify(j)}`);
  return j.token;
}
async function api(token, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, json, text };
}

/** Logged-in session; records JS errors, 5xx responses and every alert text. */
async function session(browser, username, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const s = { ctx, page, errors: [], alerts: [] };
  page.on('pageerror', (e) => s.errors.push('JS: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) s.errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  page.on('dialog', (d) => { if (d.type() === 'alert') s.alerts.push(d.message()); d.accept(); });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('label:has-text("Username") input').fill(username);
  await page.locator('label:has-text("Password") input').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  s.token = await page.evaluate(() => localStorage.getItem('mep_new_app_token'));
  return s;
}
async function open(s, p) { await s.page.goto(BASE + p, { waitUntil: 'networkidle' }); await s.page.waitForTimeout(250); }
// networkidle resolves at once if nothing is in flight yet, so give the click's request time to start first.
async function settle(s) { await s.page.waitForTimeout(300); await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300); }
const field = (scope, label) => scope.locator(`.filter-field:has(> label:text-is("${label}")) :is(input, select, textarea)`).first();
const flat = (scope, label) => scope.locator(`label:text-is("${label}") + :is(input, select, textarea)`).first(); // <label>X</label><input> pairs
const noAlerts = (s) => (s.alerts.length ? ` alerts: ${s.alerts.join(' | ')}` : '');

/** Click a download control; returns { name, text } or null if no download started. */
async function download(s, locator) {
  const p = s.page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await locator.click();
  const d = await p;
  if (!d) return null;
  const file = await d.path();
  return { name: d.suggestedFilename(), text: file ? fs.readFileSync(file, 'utf8') : '' };
}
const csvOk = (dl, mustContain) => !!dl && /\.csv$/.test(dl.name) && dl.text.length > 0 && !dl.text.trim().startsWith('{') && (!mustContain || dl.text.includes(mustContain));

/* ------------------------------------------------ 6a users, notifications, logout */
async function group6a(browser) {
  const adminT = await apiToken('admin');
  const s = await session(browser, 'admin');
  await open(s, '/users');
  const uname = 'e2e_user_' + uniq();
  await s.page.locator('button:has-text("+ Create Login")').click();
  const m = s.page.locator('.modal');
  await flat(m, 'Name *').fill('E2E User');
  await flat(m, 'Username *').fill(uname);
  await flat(m, 'Role *').selectOption('finance');
  await flat(m, 'Password *').fill('pw-' + uniq());
  await m.locator('button.btn-primary').click();
  await settle(s);
  const ulist = (await api(adminT, 'GET', '/api/users')).json?.users || [];
  let u = ulist.find((x) => x.username === uname);
  rec('users: Create Login saves a finance user (POST /api/users)', !!u && u.role === 'finance' && (await s.page.locator('tr', { hasText: uname }).count()) === 1, (u ? u.role : 'not found') + noAlerts(s));
  await s.page.locator('tr', { hasText: uname }).locator('button:has-text("Edit")').click();
  await s.page.waitForTimeout(400); // GET /api/users/:id fills the form
  rec('users: Edit loads the user into the form (GET /api/users/:id)', (await flat(m, 'Username *').inputValue()) === uname);
  await flat(m, 'Name *').fill('E2E User Renamed');
  await flat(m, 'Role *').selectOption('sales');
  await m.locator('button.btn-primary').click();
  await settle(s);
  u = (await api(adminT, 'GET', `/api/users/${u?.id}`)).json?.user;
  rec('users: Edit saves name and role (PATCH /api/users/:id)', u?.name === 'E2E User Renamed' && u?.role === 'sales', JSON.stringify(u || {}).slice(0, 100) + noAlerts(s));
  await s.page.locator('tr', { hasText: uname }).locator('button:has-text("Remove")').click();
  await settle(s);
  const g = await api(adminT, 'GET', `/api/users/${u?.id}`);
  rec('users: Remove deletes the user (DELETE /api/users/:id)', g.status === 404 && (await s.page.locator('tr', { hasText: uname }).count()) === 0, `${g.status}${noAlerts(s)}`);
  rec('users: no errors', s.errors.length === 0, s.errors.join('|'));
  // Session restoration: a reload (or a new tab) keeps the user signed in via GET /api/auth/me.
  await s.page.reload({ waitUntil: 'networkidle' });
  const tab2 = await s.ctx.newPage();
  await tab2.goto(BASE + '/users', { waitUntil: 'networkidle' });
  rec('session: reload and a new tab restore the signed-in user (stored token + GET /api/auth/me)', !s.page.url().includes('/login') && !tab2.url().includes('/login') && (await tab2.locator('h2:has-text("Users")').count()) === 1, `${s.page.url()} | ${tab2.url()}`);
  await s.ctx.close();

  // Notifications: a raise creates one for finance; opening the page marks it read.
  const amolT = await apiToken('amol');
  const note = 'E2E notify ' + uniq();
  await api(amolT, 'POST', '/api/sales-orders/so_demo/milestones/0/raise', { note });
  const finT = await apiToken('finance');
  const before = ((await api(finT, 'GET', '/api/notifications?limit=200')).json?.notifications || []).find((n) => (n.text || '').includes(note));
  const f = await session(browser, 'finance');
  await open(f, '/notifications');
  await f.page.waitForTimeout(600);
  const after = ((await api(finT, 'GET', '/api/notifications?limit=200')).json?.notifications || []).find((n) => (n.text || '').includes(note));
  rec('notifications: the raise notification is listed and opening the page marks it read (PATCH /:id/read)', !!before && before.isRead === false && after?.isRead === true && (await f.page.locator(`text=${note}`).count()) >= 1, `${before?.isRead} -> ${after?.isRead}`);
  // Logout ends the server session, not just the local one.
  const tok = f.token;
  await f.page.locator('text=Log out').first().click();
  await f.page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
  const me = await fetch(BASE + '/api/auth/me', { headers: { authorization: `Bearer ${tok}` } });
  rec('logout: returns to login and revokes the server session (POST /api/auth/logout)', f.page.url().includes('/login') && me.status === 401, `${f.page.url()} ${me.status}`);
  rec('notifications / logout: no errors', f.errors.length === 0, f.errors.join('|'));
  await f.ctx.close();
}

/* ------------------------------------------------ 6b platform: companies, subscriptions */
async function group6b(browser) {
  const superT = await apiToken('Sam');
  const sfx = uniq();
  const name = `E2E Gamma ${sfx}`;
  const c = await api(superT, 'POST', '/api/companies', { company: { name, divs: ['HVAC', 'Solar'], status: 'Active', city: 'Nashik', subscriptionRate: 1500, subscriptionCycle: 'Monthly', subscriptionStart: today() }, admin: { username: `gamma_${sfx}`, password: PASSWORD } });
  const cid = c.json?.company?.id;
  rec('companies: throwaway company created for the test (API)', c.status === 201 && !!cid, `${c.status}`);
  const s = await session(browser, 'Sam');
  await open(s, '/admin/companies');
  const row = () => s.page.locator('tr', { hasText: name });
  await row().locator('button:has-text("Suspend")').click();
  await settle(s);
  let co = (await api(superT, 'GET', `/api/companies/${cid}`)).json?.company;
  rec('companies: Suspend sets the status (POST /api/companies/:id/status)', co?.status === 'Suspended', co?.status);
  await row().locator('button:has-text("Activate")').click();
  await settle(s);
  co = (await api(superT, 'GET', `/api/companies/${cid}`)).json?.company;
  rec('companies: Activate restores it', co?.status === 'Active', co?.status);
  await row().locator('button:has-text("Edit")').click();
  await s.page.waitForTimeout(400);
  const m = s.page.locator('.modal');
  const city = m.locator('label:text-is("City / Location") + input');
  await city.fill('Nagpur');
  await m.locator('button:has-text("Save")').click();
  await settle(s);
  co = (await api(superT, 'GET', `/api/companies/${cid}`)).json?.company;
  rec('companies: Edit saves the company (PATCH /api/companies/:id)', co?.city === 'Nagpur', `${co?.city}${noAlerts(s)}`);

  // Subscription for the throwaway company: plan + purchased divisions.
  await open(s, '/admin/subscriptions');
  const seed = s.page.locator('button:has-text("Seed Default Plans")');
  if (!(await s.page.locator('text=HVAC Starter').count())) { await seed.click(); await settle(s); }
  await s.page.locator('tr', { hasText: name }).locator('button').first().click();
  await s.page.waitForTimeout(500);
  const sm = s.page.locator('.modal');
  const plan = sm.locator('label.filter-field:has-text("Plan") select');
  const val = await plan.evaluate((el) => { const o = [...el.options].find((x) => x.textContent.includes('HVAC Starter')); return o ? o.value : ''; });
  await plan.selectOption(val);
  await sm.locator('label.filter-field:has-text("End Date") input').fill(plusDays(60));
  await sm.locator('button[type=submit]').click();
  await settle(s);
  const sub = (await api(superT, 'GET', `/api/subscriptions/company/${cid}`)).json?.subscription;
  rec('subscriptions: assigning a plan saves the subscription (POST /api/subscriptions/company/:id)', !!sub && sub.planCode === val && Array.isArray(sub.purchasedDivisions) && sub.purchasedDivisions.includes('HVAC'), JSON.stringify(sub || {}).slice(0, 140) + noAlerts(s));
  const gT = await apiToken(`gamma_${sfx}`);
  const md = (await api(gT, 'GET', '/api/subscriptions/my-divisions')).json?.divisions;
  rec('subscriptions: the company now works with the purchased divisions (my-divisions)', JSON.stringify(md) === JSON.stringify(sub?.purchasedDivisions), JSON.stringify(md));

  await open(s, '/admin/companies');
  await row().locator('button:has-text("Remove")').click();
  await settle(s);
  const gone = await api(superT, 'GET', `/api/companies/${cid}`);
  const relog = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `gamma_${sfx}`, password: PASSWORD }) });
  rec('companies: Remove deletes the company and its users (DELETE /api/companies/:id)', gone.status === 404 && relog.status === 401 && (await row().count()) === 0, `${gone.status}/${relog.status}`);
  rec('platform admin: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();
}

/* ------------------------------------------------ 6c checklist templates, AMC template */
async function group6c(browser) {
  const adminT = await apiToken('admin');
  const name = 'E2E chk ' + uniq();
  const c = await api(adminT, 'POST', '/api/checklist-templates', { name, division: 'HVAC' });
  const tid = c.json?.template?.id;
  for (const t of ['Point A', 'Point B']) await api(adminT, 'POST', `/api/checklist-templates/${tid}/items`, { text: t, signResponsibility: 'ENGINEER' });
  const s = await session(browser, 'admin');
  await open(s, `/checklists/${tid}`);
  await s.page.locator('button:has-text("Rename")').click();
  const nn = name + ' renamed';
  await s.page.locator('input').first().fill(nn);
  await s.page.locator('button:has-text("Save")').first().click();
  await settle(s);
  let t = (await api(adminT, 'GET', `/api/checklist-templates/${tid}`)).json?.template;
  rec('checklist template: Rename saves (PATCH /:id/rename)', t?.name === nn, t?.name + noAlerts(s));
  await s.page.locator('tr', { hasText: 'Point B' }).locator('button:has-text("↑")').click();
  await settle(s);
  t = (await api(adminT, 'GET', `/api/checklist-templates/${tid}`)).json?.template;
  rec('checklist template: ↑ moves a point up (POST /:id/items/:i/move)', t?.items?.[0]?.text === 'Point B', (t?.items || []).map((x) => x.text).join(','));
  await s.page.locator('tr', { hasText: 'Point A' }).locator('button:has-text("Edit")').click();
  const pm = s.page.locator('.modal');
  await pm.locator('input[placeholder="Checklist point description"]').fill('Point A edited');
  await pm.locator('button.btn-primary').click();
  await settle(s);
  t = (await api(adminT, 'GET', `/api/checklist-templates/${tid}`)).json?.template;
  rec('checklist template: Edit point saves (PATCH /:id/items/:i)', (t?.items || []).some((x) => x.text === 'Point A edited'), (t?.items || []).map((x) => x.text).join(',') + noAlerts(s));
  rec('checklist template detail: no errors', s.errors.length === 0, s.errors.join('|'));

  await open(s, '/checklists');
  const row = () => s.page.locator('tr', { hasText: nn });
  await row().first().locator('button:has-text("Duplicate")').click();
  await settle(s);
  let all = (await api(adminT, 'GET', '/api/checklist-templates')).json?.templates || [];
  const copies = all.filter((x) => x.name.startsWith(nn));
  rec('checklist templates: Duplicate creates a copy (POST /:id/duplicate)', copies.length === 2, copies.map((x) => x.name).join(' | '));
  await row().first().locator('button:has-text("Set Default")').click();
  await settle(s);
  all = (await api(adminT, 'GET', '/api/checklist-templates')).json?.templates || [];
  const def = all.filter((x) => x.division === 'HVAC' && x.isDefault).map((x) => x.name);
  rec('checklist templates: Set Default makes it the single HVAC default (POST /:id/set-default)', def.length === 1 && def[0].startsWith(nn), def.join(' | '));
  const copy = copies.find((x) => x.id !== tid);
  const n0 = all.length;
  await s.page.locator('tr', { hasText: copy?.name || '#none' }).filter({ hasNot: s.page.locator('text=✓') }).last().locator('button:has-text("Delete")').click();
  await settle(s);
  const del = await api(adminT, 'GET', `/api/checklist-templates/${copy?.id}`);
  rec('checklist templates: Delete removes the template (DELETE /:id)', del.status === 404 && ((await api(adminT, 'GET', '/api/checklist-templates')).json?.templates || []).length === n0 - 1, `${del.status}${noAlerts(s)}`);
  rec('checklist template list: no errors', s.errors.length === 0, s.errors.join('|'));

  // AMC template: Edit Template loads the wording, Save stores it, the document shows it.
  await open(s, '/contracts/amc_demo/amc-document?type=amc-letter');
  await s.page.locator('button:has-text("Edit Template")').click();
  await s.page.waitForTimeout(500);
  const words = 'E2E salutation ' + uniq();
  const ta = s.page.locator('textarea').nth(1);
  await ta.fill(words);
  await s.page.locator('button:has-text("Save")').first().click();
  await settle(s);
  const tpl = (await api(adminT, 'GET', '/api/amc-documents/templates/amc-letter')).json?.template;
  // The page no longer draws the document (owner decision, 24 Oct 2026) — the
  // edited wording has to reach the generated document, which is what the PDF
  // is rendered from.
  const generated = (await api(adminT, 'GET', '/api/amc-documents/generate/amc_demo/amc-letter')).json?.document;
  rec('AMC template: Edit Template -> Save stores the wording (GET/PUT /api/amc-documents/templates) and it reaches the letter',
    JSON.stringify(tpl || {}).includes(words) && JSON.stringify(generated || {}).includes(words), noAlerts(s));
  rec('AMC template: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();
}

/* ------------------------------------------------ 6d enquiry edit/lost/reopen, SO edit, quotation duplicate */
async function group6d(browser) {
  const adminT = await apiToken('admin');
  const salesT = await apiToken('sales');
  const e = await api(salesT, 'POST', '/api/enquiries', { name: 'E2E enq ' + uniq(), segment: 'HVAC', siteType: 'Residential', rating: 3 });
  const eid = e.json?.enquiry?.id;
  const s = await session(browser, 'sales');
  await open(s, `/enquiries/${eid}`);
  await s.page.locator('button:has-text("Edit")').first().click();
  const m = s.page.locator('.modal');
  await field(m, 'Capacity').fill('18 TR');
  await m.locator('button[type=submit]:has-text("Save")').click();
  await settle(s);
  let q = (await api(adminT, 'GET', `/api/enquiries/${eid}`)).json?.enquiry;
  rec('enquiry detail: Edit saves (PATCH /api/enquiries/:id)', q?.capacity === '18 TR', `${q?.capacity}${noAlerts(s)}`);
  await s.page.locator('button:has-text("Mark Lost")').first().click();
  const lm = s.page.locator('.modal');
  const reason = field(lm, 'Reason');
  await reason.selectOption({ index: 1 });
  await field(lm, 'Remark').fill('Went with competitor');
  await lm.locator('button:has-text("Mark Lost")').click();
  await settle(s);
  q = (await api(adminT, 'GET', `/api/enquiries/${eid}`)).json?.enquiry;
  rec('enquiry detail: Mark Lost records reason and date (POST /:id/mark-lost)', q?.status === 'Lost' && !!q?.lostReason && !!q?.lostDate, `${q?.status} ${q?.lostReason}${noAlerts(s)}`);
  await s.page.locator('button:has-text("Reopen")').click();
  await settle(s);
  q = (await api(adminT, 'GET', `/api/enquiries/${eid}`)).json?.enquiry;
  rec('enquiry detail: Reopen returns it to Open (POST /:id/reopen)', q?.status === 'Open', `${q?.status}${noAlerts(s)}`);
  rec('enquiry detail: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // SO edit (admin)
  const a = await session(browser, 'admin');
  await open(a, '/sales-orders/so_demo');
  await a.page.locator('button:has-text("Edit Sales Order")').click();
  const sm = a.page.locator('.modal');
  const team = 'E2E team ' + uniq();
  await field(sm, 'Project Team').fill(team);
  await sm.locator('button[type=submit]:has-text("Save")').click();
  await settle(a);
  const so = (await api(adminT, 'GET', '/api/sales-orders/so_demo')).json?.salesOrder;
  rec('sales order detail: Edit saves (PATCH /api/sales-orders/:id) and keeps the milestones', so?.projectTeam === team && (so?.paymentMilestones || []).length > 0, `${so?.projectTeam} ms=${(so?.paymentMilestones || []).length}${noAlerts(a)}`);
  rec('sales order edit: no errors', a.errors.length === 0, a.errors.join('|'));

  // Quotation duplicate (admin)
  const qq = await api(adminT, 'POST', '/api/quotations', { division: 'HVAC', customerName: 'E2E Dup ' + uniq(), equipmentItems: [{ description: 'AHU', unit: 'Nos', qty: 1, supplyRate: 1000, installationRate: 0 }], accessoriesItems: [], gstPercent: 18 });
  const qid = qq.json?.quotation?.id;
  await open(a, `/quotations/${qid}`);
  await a.page.locator('button:text-is("Duplicate")').click();
  await a.page.waitForURL((u) => /\/quotations\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith(qid), { timeout: 8000 }).catch(() => {});
  await settle(a);
  const nid = (a.page.url().match(/\/quotations\/([^/?#]+)$/) || [])[1];
  const dup = nid ? (await api(adminT, 'GET', `/api/quotations/${nid}`)).json?.quotation : null;
  rec('quotation detail: Duplicate creates a new Draft and opens it (POST /:id/duplicate)', !!dup && nid !== qid && dup.status === 'Draft' && dup.customerName === qq.json?.quotation?.customerName, `${nid}${noAlerts(a)}`);
  rec('quotation duplicate: no errors', a.errors.length === 0, a.errors.join('|'));
  await a.ctx.close();
}

/* ------------------------------------------------ 6e inventory admin */
async function group6e(browser) {
  const storeT = await apiToken('store');
  const vinodT = await apiToken('vinod');
  const s = await session(browser, 'store');
  const cat = 'E2E Cat ' + uniq(); const loc = 'E2E Loc ' + uniq();
  const c = await api(storeT, 'POST', '/api/inventory/categories', { name: cat });
  const l = await api(storeT, 'POST', '/api/inventory/locations', { name: loc });
  await open(s, '/inventory/categories');
  for (const [kind, nm, id, list] of [['category', cat, c.json?.category?.id, 'categories'], ['location', loc, l.json?.location?.id, 'locations']]) {
    await s.page.locator('tr', { hasText: nm }).locator('button:has-text("Rename")').click();
    await field(s.page.locator('.modal'), 'Name *').fill(nm + ' X');
    await s.page.locator('.modal button[type=submit]').click();
    await settle(s);
    let rows = (await api(storeT, 'GET', `/api/inventory/${list}`)).json?.[list] || [];
    rec(`inventory ${kind}: Rename saves (PUT /api/inventory/${list}/:id)`, rows.some((x) => x.id === id && x.name === nm + ' X'), noAlerts(s));
    await s.page.locator('tr', { hasText: nm + ' X' }).locator('button:has-text("Delete")').click();
    await settle(s);
    rows = (await api(storeT, 'GET', `/api/inventory/${list}`)).json?.[list] || [];
    rec(`inventory ${kind}: Delete removes it (DELETE /api/inventory/${list}/:id)`, !rows.some((x) => x.id === id), noAlerts(s));
  }
  // Item edit / delete
  await api(storeT, 'POST', '/api/inventory/locations', { name: 'E2E Store ' + uniq() });
  const locs = (await api(storeT, 'GET', '/api/inventory/locations')).json?.locations || [];
  const item = 'E2E Item ' + uniq();
  const it = await api(storeT, 'POST', '/api/inventory/items', { name: item, unit: 'Nos', returnable: true, openingStock: { [locs[0].id]: 5 } });
  const iid = it.json?.item?.id;
  await open(s, '/inventory/stock');
  await s.page.locator('tr', { hasText: item }).locator('button:has-text("Edit")').click();
  await field(s.page.locator('.modal'), 'Rate/Unit').fill('250');
  await s.page.locator('.modal button[type=submit]:has-text("Save")').click();
  await settle(s);
  let g = (await api(storeT, 'GET', `/api/inventory/items/${iid}`)).json?.item;
  rec('inventory item: Edit saves (PUT /api/inventory/items/:id)', Number(g?.ratePerUnit) === 250, `${g?.ratePerUnit}${noAlerts(s)}`);
  // Reject a return request
  const iss = await api(storeT, 'POST', '/api/inventory/issues', { itemId: iid, quantity: 2, staffId: 'seed_user_6', fromLocationId: locs[0].id, site: 'E2E site', date: today() });
  const isid = iss.json?.issue?.id || (iss.json?.issues || [])[0]?.id;
  const rr = await api(vinodT, 'POST', `/api/inventory/issues/${isid}/return-request`, { quantity: 1, note: 'spare' });
  await open(s, '/inventory/returns');
  const reqRow = s.page.locator('.panel:has(h3:has-text("Return Requests")) tr', { hasText: item });
  await reqRow.locator('button:has-text("Reject")').click();
  await settle(s);
  const after = ((await api(storeT, 'GET', '/api/inventory/issues')).json?.issues || []).find((x) => x.id === isid);
  rec('inventory returns: Reject clears the return request (POST /issues/:id/reject-return)', iss.status === 201 && rr.status === 200 && after && !after.returnRequested && Number(after.quantityReturned || 0) === 0, `${iss.status}/${rr.status} requested=${after?.returnRequested}`);
  // Delete an item with no movements other than opening stock
  const item2 = 'E2E Del ' + uniq();
  const it2 = await api(storeT, 'POST', '/api/inventory/items', { name: item2, unit: 'Nos' });
  await open(s, '/inventory/stock');
  await s.page.locator('tr', { hasText: item2 }).locator('button:has-text("Delete")').click();
  await settle(s);
  g = await api(storeT, 'GET', `/api/inventory/items/${it2.json?.item?.id}`);
  rec('inventory item: Delete removes an unused item (DELETE /api/inventory/items/:id)', g.status === 404, `${g.status}${noAlerts(s)}`);
  rec('inventory admin: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();
}

/* ------------------------------------------------ 6f payments */
async function group6f(browser) {
  const finT = await apiToken('finance');
  const getP = async (id) => (await api(finT, 'GET', `/api/payments/${id}`)).json?.payment;
  const ref = 'E2E Pay ' + uniq();
  const s = await session(browser, 'finance');
  await open(s, '/payments');
  await s.page.locator('button:has-text("+ New Manual Payment")').first().click();
  let m = s.page.locator('.modal');
  await field(m, 'Project / Reference *').fill(ref);
  await field(m, 'Amount *').fill('10000');
  await field(m, 'Person Name').fill('Mr Rao');
  await field(m, 'Phone').fill('9811111111');
  await m.locator('button:has-text("Add")').last().click();
  await settle(s);
  const p0 = ((await api(finT, 'GET', '/api/payments')).json?.payments || []).find((x) => x.projectOrReference === ref);
  rec('payments: + New Manual Payment creates a manual record (POST /api/payments)', !!p0 && Number(p0.amount) === 10000 && p0.status === 'Pending', (p0 ? p0.status : 'not found') + noAlerts(s));
  const row = () => s.page.locator('tr', { hasText: ref }).first();
  /*
   * Owner decision (30 Oct 2026): Record Receipt, Follow-up, Edit Received
   * and Edit Milestone moved out of the row and into the strip that opens
   * under it, so they are reachable without sliding the table sideways.
   * `detail()` opens the row if it is closed and returns that strip.
   * Delete and Mark Received stayed on the row itself.
   */
  const detail = async () => {
    const r = row();
    if (await r.locator('.pay-toggle[aria-expanded="false"]').count() > 0) {
      await r.locator('.pay-toggle').click();
      await s.page.waitForTimeout(150);
    }
    return r.locator('xpath=following-sibling::tr[1]');
  };
  await (await detail()).locator('button:has-text("Record Receipt")').click();
  m = s.page.locator('.modal');
  await field(m, 'Amount *').fill('4000');
  await field(m, 'Reference').fill('UTR123');
  await m.locator('button:has-text("Record Receipt")').click();
  await settle(s);
  let p = await getP(p0?.id);
  // PWA: a milestone stays "Pending" (balance shown) until fully received, then "Received".
  rec('payments: Record Receipt on the row records a part payment (POST /:id/part-payments); still Pending with the balance', (p?.partPayments || []).length === 1 && Number(p.partPayments[0].amount) === 4000 && p.status === 'Pending', `${p?.status} ${(p?.partPayments || []).length}${noAlerts(s)}`);
  if (process.env.SHOTS) await s.page.screenshot({ path: `${process.env.SHOTS}/6f-after-part.png`, fullPage: true });
  // Edit the entry from the receipts ledger.
  await s.page.locator('.panel:has(h3:has-text("Receipts Ledger")) tr', { hasText: ref }).locator('button:has-text("Edit")').click();
  m = s.page.locator('.modal');
  await field(m, 'Amount *').fill('5000');
  await m.locator('button:has-text("Save")').click();
  await settle(s);
  p = await getP(p0?.id);
  rec('payments: Edit receipt changes the amount (PATCH /:id/part-payments/:partId)', Number(p?.partPayments?.[0]?.amount) === 5000, `${p?.partPayments?.[0]?.amount}${noAlerts(s)}`);
  // Follow-up
  await (await detail()).locator('button:has-text("Follow-up")').click();
  m = s.page.locator('.modal');
  await field(m, 'Next Call Date').fill(plusDays(3));
  await field(m, 'Discussion Notes').fill('Promised by Friday');
  await m.locator('button:has-text("Save")').click();
  await settle(s);
  p = await getP(p0?.id);
  rec('payments: Follow-up saves next call and notes (POST /:id/follow-up)', String(p?.nextCallDate || '').startsWith(plusDays(3)) && (p?.discussionNotes || '').includes('Promised by Friday'), `${p?.nextCallDate}${noAlerts(s)}`);
  // Edit milestone record
  await (await detail()).locator('button:has-text("Edit Milestone")').click();
  m = s.page.locator('.modal');
  await field(m, 'Remark / Milestone').fill('Retention 10%');
  await m.locator('button:has-text("Save")').click();
  await settle(s);
  p = await getP(p0?.id);
  rec('payments: Edit Milestone saves the record (PATCH /:id/milestone)', p?.remark === 'Retention 10%', `${p?.remark}${noAlerts(s)}`);
  // History -> Del removes the receipt
  await row().locator('button.link-button').first().click(); // "✎ edit 1 entry" opens the payment history
  await s.page.locator('.modal button:has-text("Del")').first().click();
  await settle(s);
  p = await getP(p0?.id);
  rec('payments: History -> Del removes the receipt and reverts to Pending (DELETE /:id/part-payments/:partId)', (p?.partPayments || []).length === 0 && p?.status === 'Pending', `${p?.status}${noAlerts(s)}`);
  // Exports
  const pend = await download(s, s.page.locator('button:has-text("Pending CSV")'));
  rec('payments: Pending CSV downloads a CSV carrying the record', csvOk(pend, ref), pend ? `${pend.name} ${pend.text.slice(0, 60)}` : 'no download');
  const recs = await download(s, s.page.locator('button:has-text("Receipts CSV")'));
  rec('payments: Receipts CSV downloads a CSV', csvOk(recs), recs ? recs.name : 'no download');
  // Delete the manual record
  await row().locator('button:has-text("Delete")').click();
  await settle(s);
  const gone = await api(finT, 'GET', `/api/payments/${p0?.id}`);
  rec('payments: Delete removes a manual record (DELETE /api/payments/:id)', gone.status === 404, `${gone.status}${noAlerts(s)}`);

  // Owner request (29 Oct 2026): a pending payment that is NOT tied to a sales
  // order must be settleable in one click from its own row.
  // The session's own dialog handler (above) already accepts the
  // "mark in full?" confirm.
  const ref2 = 'E2E MarkRcv ' + uniq();
  await s.page.locator('button:has-text("+ New Manual Payment")').first().click();
  m = s.page.locator('.modal');
  await field(m, 'Project / Reference *').fill(ref2);
  await field(m, 'Amount *').fill('7500');
  await m.locator('button:has-text("Add")').last().click();
  await settle(s);
  const p2 = ((await api(finT, 'GET', '/api/payments')).json?.payments || []).find((x) => x.projectOrReference === ref2);
  const row2 = () => s.page.locator('tr', { hasText: ref2 }).first();
  await row2().locator('button:has-text("Mark Received")').click();
  await settle(s);
  const p2done = await getP(p2?.id);
  rec('payments: "Mark Received" settles a non-SO pending in one click, as a receipt for the full balance',
    p2done?.status === 'Received'
      && (p2done.partPayments || []).length === 1
      && Number(p2done.partPayments[0].amount) === 7500,
    `${p2done?.status} parts=${(p2done?.partPayments || []).length} amt=${p2done?.partPayments?.[0]?.amount}${noAlerts(s)}`);

  rec('payments: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();
}

/* ------------------------------------------------ 6g projects + delivery challans + warranty conversion */
async function group6g(browser) {
  const adminT = await apiToken('admin');
  const pname = 'E2E Project ' + uniq();
  const so = await api(adminT, 'POST', '/api/sales-orders', { division: 'HVAC', projectName: pname, startDate: today(), contacts: [{ name: 'Site', phone: '9800000009' }], paymentMilestones: [{ description: 'Advance', amount: 1000 }] });
  const prj = ((await api(adminT, 'GET', '/api/projects')).json?.projects || []).find((x) => x.name === pname);
  rec('projects: a sales order creates its project with a checklist (API setup)', so.status === 201 && !!prj && (prj.checklist || []).length > 0, `${so.status} ${prj ? prj.checklist.length : 'no project'}`);
  if (!prj) return;
  const pid = prj.id;
  const getPr = async () => (await api(adminT, 'GET', `/api/projects/${pid}`)).json?.project;
  const s = await session(browser, 'admin');
  await open(s, `/projects/${pid}`);
  const modal = () => s.page.locator('.modal');

  // Vendor
  await s.page.locator('button:has-text("Edit Vendor")').click();
  await field(modal(), 'Vendor').fill('E2E Fabricators');
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  rec('project: Edit Vendor saves (PATCH /:id/vendor)', (await getPr())?.vendor === 'E2E Fabricators', noAlerts(s));
  // Engineers
  await s.page.locator('button:has-text("Assign Engineers")').click(); await s.page.waitForTimeout(400); // GET /engineer-candidates
  await modal().locator('label', { hasText: 'Vinod' }).locator('input[type=checkbox]').check();
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  rec('project: Assign Engineers saves (GET /engineer-candidates, POST /:id/engineers)', ((await getPr())?.assignedEngineerIds || []).map(String).includes('seed_user_6'), noAlerts(s));
  // Add / edit / remove a point (before the timeline, so the timeline covers every point)
  await s.page.locator('button:has-text("+ Add Point")').click();
  await field(modal(), 'Text').fill('E2E extra point');
  await modal().locator('button:has-text("Add")').click(); await settle(s);
  let pr = await getPr();
  const xi = (pr?.checklist || []).findIndex((c) => c.text === 'E2E extra point');
  rec('project: + Add Point adds a checklist point (POST /:id/checklist)', xi >= 0, noAlerts(s));
  const prow = (text) => s.page.locator('tbody tr', { hasText: text }).first();
  await prow('E2E extra point').locator('button[title="Edit"]').click();
  await field(modal(), 'Text').fill('E2E extra point v2');
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  rec('project: Edit point saves (PATCH /:id/checklist/:i)', (pr?.checklist || []).some((c) => c.text === 'E2E extra point v2'), noAlerts(s));
  await prow('E2E extra point v2').locator('button[title="Remove"]').click(); await settle(s);
  pr = await getPr();
  rec('project: Remove point deletes it (DELETE /:id/checklist/:i)', !(pr?.checklist || []).some((c) => c.text.startsWith('E2E extra point')), noAlerts(s));
  // Choose Checklist (append a library template's points)
  const lib = await api(adminT, 'POST', '/api/checklist-templates', { name: 'E2E library ' + uniq(), division: 'HVAC' });
  for (const t of ['Lib point 1', 'Lib point 2']) await api(adminT, 'POST', `/api/checklist-templates/${lib.json?.template?.id}/items`, { text: t, signResponsibility: 'ENGINEER' });
  const n0 = (pr?.checklist || []).length;
  await s.page.locator('button:has-text("Choose Checklist")').click(); await s.page.waitForTimeout(400);
  const sel = field(modal(), 'Checklist');
  const opt = (await sel.count()) ? await sel.evaluate((el) => [...el.options].map((o) => o.value).find((v) => v)) : null;
  if (opt) {
    await sel.selectOption(opt);
    await modal().locator('button:has-text("Append points")').click(); await settle(s);
  }
  pr = await getPr();
  rec('project: Choose Checklist -> Append points adds the template points (POST /:id/checklist/apply)', !!opt && (pr?.checklist || []).length > n0, `${n0} -> ${(pr?.checklist || []).length}${noAlerts(s)}`);
  // Timeline: start today, auto-fill to +30 days
  await s.page.locator('button:has-text("Timeline")').first().click();
  await field(modal(), 'Project Start Date').fill(today());
  await modal().locator('.filter-pair input[type=date]').fill(plusDays(30));
  await modal().locator('button:has-text("Auto-fill")').click();
  await modal().locator('button:has-text("Save Timeline")').click(); await settle(s);
  pr = await getPr();
  rec('project: Set Timeline saves dates for every point (POST /:id/timeline)', pr?.timelineSet === true && (pr?.checklist || []).every((c) => c.targetDate), `${pr?.timelineSet}${noAlerts(s)}`);
  // Remark, photo, dates, tick, approve, PM sign on point 1
  const first = pr.checklist[0].text;
  await prow(first).locator('button[title="Remark"]').click();
  await field(modal(), 'Remark').fill('Checked on site');
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  rec('project: checklist Remark saves (PATCH /:id/checklist/:i/remark)', pr?.checklist?.[0]?.remark === 'Checked on site', noAlerts(s));
  const fc = s.page.waitForEvent('filechooser', { timeout: 8000 });
  await prow(first).locator('button[title="Photo"]').click();
  await (await fc).setFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  await s.page.waitForTimeout(800); await settle(s);
  pr = await getPr();
  rec('project: checklist Photo uploads a scaled JPEG (POST /:id/checklist/:i/photos)', /^data:image\/jpeg;base64,/.test(pr?.checklist?.[0]?.photos?.[0] || ''), (pr?.checklist?.[0]?.photos?.[0] || '').slice(0, 30) + noAlerts(s));
  await prow(first).locator('button[title="Dates"]').click();
  await field(modal(), 'Scheduled / Target Date').fill(plusDays(2));
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  rec('project: checklist Dates saves the target date (PATCH /:id/checklist/:i/target-date)', String(pr?.checklist?.[0]?.targetDate || '').startsWith(plusDays(2)), `${pr?.checklist?.[0]?.targetDate}${noAlerts(s)}`);
  await prow(first).locator('input[type=checkbox]').click(); await settle(s); // controlled checkbox: state follows the server reply
  pr = await getPr();
  rec('project: ticking a point completes it (POST /:id/checklist/:i/tick)', pr?.checklist?.[0]?.done === true && !!pr?.checklist?.[0]?.completedDate, `done=${pr?.checklist?.[0]?.done}` + noAlerts(s));
  const approve = prow(first).locator('button[title="Approve"]');
  if (await approve.count()) {
    await approve.click();
    const nameIn = modal().locator('input[placeholder^="name of person"]');
    if (await nameIn.count()) {
      await nameIn.fill('Client Rep');
      const cv = modal().locator('canvas').first();
      await cv.scrollIntoViewIfNeeded(); const b = await cv.boundingBox();
      await s.page.mouse.move(b.x + 10, b.y + 20); await s.page.mouse.down();
      for (let k = 1; k <= 6; k++) await s.page.mouse.move(b.x + 10 + k * 20, b.y + 20 + (k % 2) * 25);
      await s.page.mouse.up();
    }
    await modal().locator('button:has-text("Approve")').click(); await settle(s);
  }
  pr = await getPr();
  rec('project: Approve records the approval (POST /:id/checklist/:i/approve)', !!pr?.checklist?.[0]?.approval?.approverName, JSON.stringify(pr?.checklist?.[0]?.approval || {}).slice(0, 120) + noAlerts(s));
  const sign = prow(first).locator('button[title="PM Counter-sign"]');
  if (await sign.count()) { await sign.click(); await settle(s); }
  pr = await getPr();
  rec('project: PM counter-sign (POST /:id/checklist/:i/pm-sign)', pr?.checklist?.[0]?.pmSigned === true, noAlerts(s));
  // Execution update
  await s.page.locator('button:has-text("+ Add Update")').click();
  await field(modal(), 'Action Done *').fill('Ducting 50% done');
  await field(modal(), 'Next Action Date').fill(plusDays(5));
  await modal().locator('button:has-text("Add")').click(); await settle(s);
  pr = await getPr();
  rec('project: + Add Update saves an execution update (POST /:id/updates)', (pr?.executionUpdates || []).some((u) => u.actionDone === 'Ducting 50% done') && (await s.page.locator('text=Ducting 50% done').count()) >= 1, noAlerts(s));

  // Delivery challan: new DC with a returnable item, edit, return, export, then a second line removed.
  await s.page.locator('button:has-text("+ New Delivery Challan")').click();
  const dm = modal();
  await field(dm, 'Received By (site)').fill('Site Supervisor');
  const r0 = dm.locator('.fu-row').nth(0);
  await r0.locator('input[placeholder="Material description"]').fill('Copper pipe 7/8');
  await r0.locator('input[placeholder="Qty"]').fill('10');
  await r0.locator('select').nth(1).selectOption('1');
  const r1 = dm.locator('.fu-row').nth(1);
  await r1.locator('input[placeholder="Material description"]').fill('Insulation tape');
  await r1.locator('input[placeholder="Qty"]').fill('4');
  await dm.locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  const dcs = pr?.deliveryChallans || pr?.materials || [];
  rec('delivery challan: New DC saves both items under one DC number (POST /:id/delivery-challans)', dcs.length === 2 && dcs[0].challanNumber && dcs[0].challanNumber === dcs[1].challanNumber, JSON.stringify(dcs.map((d) => [d.challanNumber, d.materialName])).slice(0, 140));
  const dcRow = (t) => s.page.locator('tr', { hasText: t }).first();
  await dcRow('Copper pipe 7/8').locator('button:has-text("Edit")').click();
  await field(modal(), 'Qty').fill('12');
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  const cu = (pr?.deliveryChallans || []).find((d) => d.materialName === 'Copper pipe 7/8');
  rec('delivery challan: Edit saves (PATCH /:id/delivery-challans/:i)', Number(cu?.quantity) === 12, `${cu?.quantity}`);
  await dcRow('Copper pipe 7/8').locator('button:has-text("Return")').click();
  await field(modal(), 'Return Quantity').fill('3');
  await modal().locator('button:has-text("Return")').last().click(); await settle(s);
  pr = await getPr();
  const cu2 = (pr?.deliveryChallans || []).find((d) => d.materialName === 'Copper pipe 7/8');
  const retQty = (cu2?.returns || []).reduce((a, x) => a + Number(x.quantity || 0), 0) || Number(cu2?.returnedQuantity || 0);
  rec('delivery challan: Return records 3 back (POST /:id/delivery-challans/:i/return)', retQty === 3, JSON.stringify(cu2 || {}).slice(0, 160));
  const dcx = await download(s, s.page.locator('button:has-text("📥 Export")'));
  rec('delivery challan: Export downloads the challan CSV', csvOk(dcx, 'Copper pipe'), dcx ? dcx.name : 'no download');
  await dcRow('Insulation tape').locator('button:has-text("✕")').click(); await settle(s);
  pr = await getPr();
  rec('delivery challan: ✕ removes a line (DELETE /:id/delivery-challans/:i)', !(pr?.deliveryChallans || []).some((d) => d.materialName === 'Insulation tape'), noAlerts(s));
  const rep = await download(s, s.page.locator('button:has-text("Project Report (CSV)")'));
  rec('project: Project Report (CSV) downloads the report', csvOk(rep, pname), rep ? rep.name : 'no download');

  // Stage -> Completed (overriding the open checklist / returnables), then convert to a warranty contract.
  await s.page.locator('button:has-text("Change Stage")').click();
  await field(modal(), 'Stage').selectOption('Completed');
  for (const cb of await modal().locator('input[type=checkbox]').all()) await cb.check();
  await modal().locator('button:has-text("Save")').click(); await settle(s);
  pr = await getPr();
  rec('project: Change Stage -> Completed (POST /:id/stage)', pr?.status === 'Completed' && pr?.stage === 'Completed', `${pr?.stage}/${pr?.status}${noAlerts(s)}`);
  await open(s, `/projects/${pid}`);
  await s.page.locator('button:has-text("Convert to Service")').click(); await settle(s);
  pr = await getPr();
  const contracts = (await api(adminT, 'GET', '/api/contracts')).json?.contracts || [];
  const w = contracts.find((x) => x.originatingProjectId === pid);
  rec('project: Convert to Service creates a 1-year Warranty contract and sets In Service (POST /api/contracts/from-project/:id)', pr?.status === 'In Service' && !!w && w.category === 'Warranty', `${pr?.status} ${w ? w.category : 'no contract'}${noAlerts(s)}`);
  rec('projects: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();
}

/* ------------------------------------------------ 6h every CSV export, per role, and expired-session handling */
async function group6h(browser) {
  const pages = [
    ['admin', '/enquiries', 'button:has-text("Export CSV")', 'Poonawalla'],
    ['admin', '/enquiries/lost', 'button:has-text("Export CSV")', ''],
    ['admin', '/sales-orders', 'button:has-text("Export CSV")', 'Poonawalla'],
    ['amol', '/projects', 'button:has-text("Report")', 'Poonawalla'],
    ['service', '/service-calls', '.enq-header button.btn.sec, button:has-text("CSV")', ''],
    ['service', '/contracts', 'button:has-text("CSV Export")', 'Intervalve'],
    ['store', '/inventory/stock', 'button:has-text("CSV Export")', ''],
    ['store', '/inventory/issue', 'button:has-text("Report")', ''],
    ['store', '/inventory/returns', 'button:has-text("Report")', ''],
    ['store', '/inventory/history', 'button:has-text("Export Transaction Report")', ''],
    ['vinod', '/my-material', 'button:has-text("CSV Export")', ''],
    ['admin', '/quotations', 'button:has-text("Export CSV")', ''],
    ['finance', '/payments', 'button:has-text("Pending CSV")', 'Poonawalla'],
    ['finance', '/payments', 'button:has-text("Receipts CSV")', 'Poonawalla'],
  ];
  for (const [user, p, sel, must] of pages) {
    const s = await session(browser, user);
    await open(s, p);
    const dl = await download(s, s.page.locator(sel).first());
    rec(`export ${p} (${user}): downloads a real CSV`, csvOk(dl, must), dl ? `${dl.name} ${dl.text.split('\n')[0].slice(0, 80)}` : 'no download' + noAlerts(s));
    // Same button after the session was revoked elsewhere: the page must not save an error body as a CSV.
    await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${s.token}` } });
    s.alerts.length = 0;
    const bad = await download(s, s.page.locator(sel).first());
    await s.page.waitForTimeout(300);
    const savedJson = !!bad && bad.text.trim().startsWith('{');
    rec(`export ${p} (${user}) with an expired session: no error-JSON file is saved`, !savedJson, bad ? `${bad.name}: ${bad.text.slice(0, 80)}` : `no file; alerts: ${s.alerts.join('|') || 'none'}; url ${s.page.url().replace(BASE, '')}`);
    await s.ctx.close();
  }
  // Reports hub (each role sees only its own module buttons)
  for (const [user, label, must] of [['admin', 'Enquiry CSV', 'Poonawalla'], ['finance', 'Receipts CSV', ''], ['store', 'Stock Report CSV', ''], ['vinod', 'My Material CSV', '']]) {
    const s = await session(browser, user);
    await open(s, '/reports');
    const dl = await download(s, s.page.locator(`button:has-text("${label}")`));
    rec(`reports hub (${user}): ${label} downloads a real CSV`, csvOk(dl, must), dl ? dl.name : 'no download' + noAlerts(s));
    await s.ctx.close();
  }
}

const GROUPS = { '6a': group6a, '6b': group6b, '6c': group6c, '6d': group6d, '6e': group6e, '6f': group6f, '6g': group6g, '6h': group6h };

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GROUPS);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const g of want) {
      if (!GROUPS[g]) { rec(`group ${g} exists`, false, 'unknown group'); continue; }
      console.log(`\n=== group ${g} ===`);
      try { await GROUPS[g](browser); } catch (e) { rec(`group ${g}: ran to completion`, false, e.message.split('\n')[0]); }
    }
  } finally {
    await browser.close();
  }
  const pass = results.filter((r) => r.status === 'PASS').length;
  fs.writeFileSync(path.join(__dirname, 'integration-ui-results.json'), JSON.stringify(results, null, 1));
  console.log(`\nTOTAL ${results.length}  PASS ${pass}  FAIL ${results.length - pass}`);
  process.exitCode = pass === results.length ? 0 : 1;
})();
