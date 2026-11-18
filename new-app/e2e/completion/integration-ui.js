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
  // Project Team is a dropdown since the owner request of 14 Nov 2026, so the
  // edit picks a name off the list rather than typing one.
  const teamSel = field(sm, 'Project Team');
  const teamNames = (await teamSel.locator('option').allInnerTexts()).map((t) => t.trim()).filter((t) => t !== '— none —');
  const team = teamNames[teamNames.length - 1];
  await teamSel.selectOption({ label: team });
  await sm.locator('button[type=submit]:has-text("Save")').click();
  await settle(a);
  const so = (await api(adminT, 'GET', '/api/sales-orders/so_demo')).json?.salesOrder;
  rec('sales order detail: Edit saves (PATCH /api/sales-orders/:id) and keeps the milestones', !!team && team.startsWith(so?.projectTeam || '\u0000') && (so?.paymentMilestones || []).length > 0, `${so?.projectTeam} vs ${team} ms=${(so?.paymentMilestones || []).length}${noAlerts(a)}`);
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

  /*
   * Owner request (31 Oct 2026): the remark and the last discussion are read
   * before ringing somebody, so they are on the row — not behind the toggle,
   * and on a phone not behind a sideways slide either. Both were just saved
   * above, so this reads them back off the closed row.
   */
  {
    const r = row();
    if (await r.locator('.pay-toggle[aria-expanded="true"]').count() > 0) {
      await r.locator('.pay-toggle').click();
      await s.page.waitForTimeout(150);
    }
    const onRow = (await r.innerText()).replace(/\s+/g, ' ');
    rec('payments: the remark and the discussion are on the row, with the row closed',
      onRow.includes('Retention 10%') && onRow.includes('Promised by Friday'), onRow.slice(0, 200));

    const fits = async (width) => {
      await s.page.setViewportSize({ width, height: 900 });
      await s.page.waitForTimeout(400);
      return s.page.evaluate(() => {
        const t = document.querySelector('.pay-sticky-actions');
        const wrap = t && t.closest('.table-wrap');
        return {
          table: t ? t.scrollWidth - t.clientWidth : -1,
          wrap: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
          page: document.body.scrollWidth - document.documentElement.clientWidth,
        };
      });
    };
    const laptop = await fits(1366);
    rec('payments: nothing slides sideways on a laptop', laptop.wrap <= 0 && laptop.page <= 0, JSON.stringify(laptop));

    const phone = await fits(390);
    rec('payments: nothing slides sideways on a phone', phone.wrap <= 0 && phone.page <= 0, JSON.stringify(phone));
    const phoneRow = (await row().innerText()).replace(/\s+/g, ' ');
    rec('payments: and the remark is still readable on the phone, with the row closed',
      phoneRow.includes('Retention 10%') && phoneRow.includes('Promised by Friday'), phoneRow.slice(0, 200));
    if (process.env.SHOTS) await s.page.screenshot({ path: `${process.env.SHOTS}/6f-phone-cards.png`, fullPage: true });
    await s.page.setViewportSize({ width: 1366, height: 900 });
    await s.page.waitForTimeout(300);
  }
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

  // Owner decision (16 Nov 2026): there is no Change Stage dialog any more —
  // the checklist points ARE the stages, so the project completes itself once
  // every point is ticked AND approved. Driven through the API because a long
  // checklist is a lot of clicking; the rule under test is the server's.
  rec('project: the Change Stage button is gone from the project screen',
    (await s.page.locator('button:has-text("Change Stage")').count()) === 0);

  // Owner request (16 Nov 2026): a checklist point can release the payment
  // milestone it earns, and Finance is asked the moment it is signed off.
  // Point 3 — the earlier checks already signed point 1 off, and a point
  // that is ALREADY signed off releases its milestone the moment it is
  // linked, which is not the flow under test here.
  const msSel = s.page.locator('select[aria-label="Payment released by point 3"]');
  rec('project: a checklist point offers the sales order\u2019s milestones',
    (await msSel.locator('option').allInnerTexts()).some((t) => /Advance/.test(t)),
    (await msSel.locator('option').allInnerTexts()).join(' | '));
  await msSel.selectOption('0');
  await settle(s);
  await s.page.locator('input[aria-label="Collect within days for point 3"]').fill('7');
  await s.page.locator('body').click({ position: { x: 5, y: 5 } });
  await settle(s);
  pr = await getPr();
  rec('project: the link is saved on the point',
    pr?.checklist?.[2]?.releasesMilestoneIndex === 0 && pr?.checklist?.[2]?.releaseCollectWithinDays === 7,
    JSON.stringify(pr?.checklist?.[2] || {}).slice(0, 160));

  const paymentFor = async (mi) => ((await api(adminT, 'GET', '/api/payments')).json.payments || [])
    .find((p) => String(p.salesOrderId) === String(so.json.salesOrder.id) && p.milestoneIndex === mi);
  rec('project: a linked point that is not signed off asks Finance for nothing',
    !(await paymentFor(0))?.raisedToFinance, JSON.stringify((await paymentFor(0))?.raisedToFinance || null));
  await api(adminT, 'POST', `/api/projects/${pid}/checklist/2/tick`, { done: true });
  rec('project: ticking alone does not ask Finance for the money',
    !(await paymentFor(0))?.raisedToFinance, JSON.stringify((await paymentFor(0))?.raisedToFinance || null));
  // This point is signed off by the CLIENT, so it carries their name and
  // signature — the approval, whoever gives it, is what releases the money.
  const appr = await api(adminT, 'POST', `/api/projects/${pid}/checklist/2/approve`,
    { approverName: 'Mr Site Owner', signatureImage: 'data:image/png;base64,iVBORw0KGgo=' });
  rec('project: the point is approved', appr.status === 200, `${appr.status} ${JSON.stringify(appr.json).slice(0, 80)}`);
  const paid = await paymentFor(0);
  rec('project: signing the point off sends its milestone to Finance, with the collect-by date',
    !!paid?.raisedToFinance && !!paid.raisedToFinance.collectByDate,
    JSON.stringify(paid?.raisedToFinance || null).slice(0, 180));

  const points = (pr?.checklist || []);
  const last = points.length - 1;
  // A CLIENT point needs the client's name and their signature; the rest are
  // approved by whoever is entitled to sign them.
  const approvalFor = (pt) => (pt.signResponsibility === 'CLIENT'
    ? { approverName: 'Mr Site Owner', signatureImage: 'data:image/png;base64,iVBORw0KGgo=' }
    : {});
  for (let i = 0; i < last; i += 1) {
    await api(adminT, 'POST', `/api/projects/${pid}/checklist/${i}/tick`, { done: true });
    await api(adminT, 'POST', `/api/projects/${pid}/checklist/${i}/approve`, approvalFor(points[i]));
  }
  pr = await getPr();
  rec(`project: still Ongoing with ${last} of ${points.length} points finished`,
    pr?.status === 'Ongoing', `${pr?.stage}/${pr?.status}`);

  await api(adminT, 'POST', `/api/projects/${pid}/checklist/${last}/tick`, { done: true });
  pr = await getPr();
  rec('project: ticking every point is not enough on its own — the last one is unapproved',
    pr?.status === 'Ongoing', `${pr?.stage}/${pr?.status}`);
  await api(adminT, 'POST', `/api/projects/${pid}/checklist/${last}/approve`, approvalFor(points[last]));
  pr = await getPr();
  rec('project: the project completes itself once every point is done and approved',
    pr?.status === 'Completed' && pr?.stage === 'Completed', `${pr?.stage}/${pr?.status}${noAlerts(s)}`);
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

/**
 * Owner requests of 5 Nov 2026, on the staff side:
 *   - the service-call register is banded by status, with chips that narrow it;
 *   - a client's name, phone and site can be corrected after registration;
 *   - an enquiry and an AMC client carry several contacts, each with a name
 *     and a designation.
 */
async function group6i(browser) {
  const token = await apiToken('service');

  // Three calls, one per band, so the banding has something to band.
  const made = [];
  for (const row of [
    { customer: 'Banding Registered ' + uniq(), phone: '9000000030', site: 'Band site R', complaint: 'No cooling' },
    { customer: 'Banding Assigned ' + uniq(), phone: '9000000031', site: 'Band site A', complaint: 'Noise' },
  ]) {
    const r = await api(token, 'POST', '/api/service-calls/complaints', row);
    made.push(r.json.serviceCall);
  }
  const engineers = (await api(token, 'GET', '/api/service-calls/engineer-candidates')).json.candidates || [];
  await api(token, 'PUT', `/api/service-calls/${made[1].id}/assign`, { engineerId: engineers[0].id, date: plusDays(3), time: '11:00 AM' });

  const s = await session(browser, 'service');
  await open(s, '/service-calls');
  await s.page.waitForTimeout(400);

  const bands = await s.page.locator('tbody.sc-band .sc-band-head th').allInnerTexts();
  rec('service calls: the register is banded by status, in lifecycle order',
    bands.some((b) => /Registered/i.test(b)) && bands.some((b) => /Assigned/i.test(b))
      && bands.findIndex((b) => /Registered/i.test(b)) < bands.findIndex((b) => /Assigned/i.test(b)),
    bands.join(' | '));

  const regRow = s.page.locator('tbody.sc-band-registered tr.clickable-row');
  const asgRow = s.page.locator('tbody.sc-band-assigned tr.clickable-row');
  rec('service calls: each band holds only its own calls',
    (await regRow.count()) > 0 && (await asgRow.count()) > 0
      && (await s.page.locator('tbody.sc-band-registered tr.clickable-row:has-text("Assigned")').count()) === 0);

  // A chip narrows the table to one band, and clicking it again lets go.
  await s.page.locator('.sc-chip:has-text("Registered")').click();
  await s.page.waitForTimeout(300);
  rec('service calls: a status chip narrows the register to that one band',
    (await s.page.locator('tbody.sc-band').count()) === 1
      && (await s.page.locator('tbody.sc-band-registered').count()) === 1,
    `${await s.page.locator('tbody.sc-band').count()} bands`);
  await s.page.locator('.sc-chip:has-text("Registered")').click();
  await s.page.waitForTimeout(300);
  rec('service calls: clicking the same chip again shows every band again',
    (await s.page.locator('tbody.sc-band').count()) >= 2);

  // --- correcting the client on a registered call ---
  await open(s, `/service-calls/${made[0].id}`);
  await s.page.locator('.panel:has-text("Customer Information") button:has-text("Edit")').first().click();
  await s.page.waitForTimeout(250);
  const fixed = 'Corrected Name ' + uniq();
  await field(s.page, 'Customer').fill(fixed);
  await field(s.page, 'Site').fill('Corrected site');
  await s.page.locator('button:has-text("Save Client Details")').click();
  await settle(s);
  const after = (await api(token, 'GET', `/api/service-calls/${made[0].id}`)).json.serviceCall;
  rec('service call: a mistyped client name and site are corrected in place (PUT /:id/client)',
    after.customer === fixed && after.site === 'Corrected site' && after.status === 'Registered',
    `${after.customer} / ${after.site} / ${after.status}` + noAlerts(s));
  rec('service call: the corrected name is on the page', (await s.page.locator(`text=${fixed}`).count()) >= 1);

  // An engineer has no business renaming a client.
  const engToken = await apiToken('vinod');
  const refused = await api(engToken, 'PUT', `/api/service-calls/${made[0].id}/client`, { customer: 'Nope' });
  rec('service call: an engineer cannot correct the client (server-side)', refused.status === 403, String(refused.status));

  rec('service calls: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // --- several contacts on a new enquiry ---
  const e = await session(browser, 'admin');
  await open(e, '/enquiries/new');
  const project = 'Contacts Enquiry ' + uniq();
  await field(e.page, 'Project Name *').fill(project);
  await field(e.page, 'Segment *').selectOption('HVAC');
  await e.page.locator('button:has-text("Add contact")').click();
  await e.page.locator('.contacts-row').nth(0).locator('input').nth(0).fill('Anil Shah');
  await e.page.locator('.contacts-row').nth(0).locator('input').nth(1).fill('Purchase Manager');
  await e.page.locator('.contacts-row').nth(0).locator('input').nth(2).fill('9000000040');
  await e.page.locator('button:has-text("Add contact")').click();
  await e.page.locator('.contacts-row').nth(1).locator('input').nth(0).fill('Vikas Pawar');
  await e.page.locator('.contacts-row').nth(1).locator('input').nth(1).fill('Maintenance');
  await e.page.locator('.contacts-row').nth(1).locator('input').nth(2).fill('9000000041');
  await e.page.locator('button:has-text("Save Enquiry")').click();
  await settle(e);
  const adminToken = await apiToken('admin');
  const enquiries = (await api(adminToken, 'GET', '/api/enquiries')).json.enquiries || [];
  const saved = enquiries.find((x) => x.name === project);
  rec('enquiry: two contacts are saved, each with a name and a designation',
    !!saved && (saved.contacts || []).length === 2
      && saved.contacts[0].designation === 'Purchase Manager'
      && saved.contacts[1].name === 'Vikas Pawar',
    JSON.stringify(saved ? saved.contacts : 'not saved').slice(0, 160) + noAlerts(e));
  rec('enquiry: with no main number typed, the first contact fills it',
    !!saved && saved.phone === '9000000040', saved ? saved.phone : '—');
  rec('enquiry: the contacts are on the detail page',
    (await (async () => { await open(e, `/enquiries/${saved.id}`); return e.page.locator('.contacts-read li').count(); })()) === 2);
  rec('enquiry: a lead is found by the name of whoever we deal with there',
    ((await api(adminToken, 'GET', '/api/enquiries?q=Vikas%20Pawar')).json.enquiries || []).some((x) => x.id === saved.id));
  rec('enquiry contacts: no errors', e.errors.length === 0, e.errors.join('|'));
  await e.ctx.close();

  // --- several contacts on a new AMC client ---
  const c = await session(browser, 'service');
  await open(c, '/contracts/new');
  const site = 'Contacts Client ' + uniq();
  await field(c.page, 'Site *').fill(site);
  await field(c.page, 'Customer Name').fill('Contacts Customer');
  // Owner request (14 Nov 2026): an AMC now says which division it belongs to.
  await field(c.page, 'Division *').selectOption('HVAC');
  await c.page.locator('button:has-text("Add contact")').click();
  await c.page.locator('.contacts-row').nth(0).locator('input').nth(0).fill('Sneha D');
  await c.page.locator('.contacts-row').nth(0).locator('input').nth(1).fill('Accounts');
  await c.page.locator('.contacts-row').nth(0).locator('input').nth(2).fill('9000000042');
  await c.page.locator('button[type=submit]').first().click();
  await settle(c);
  const contracts = (await api(token, 'GET', '/api/contracts')).json.contracts || [];
  const savedC = contracts.find((x) => x.site === site);
  rec('AMC client: the contact is saved with its designation, the division is kept, and the blank main number is filled',
    !!savedC && (savedC.contacts || []).length === 1 && savedC.contacts[0].designation === 'Accounts'
      && savedC.phone === '9000000042' && savedC.division === 'HVAC',
    JSON.stringify(savedC ? { contacts: savedC.contacts, phone: savedC.phone } : 'not saved').slice(0, 160) + noAlerts(c));
  rec('AMC client contacts: no errors', c.errors.length === 0, c.errors.join('|'));
  await c.ctx.close();
}

/**
 * Owner request (14 Nov 2026): the Solar Manager login. One person runs the
 * solar side end to end and sees nothing else; admin sees everything with a
 * division filter on top.
 */
async function group6j(browser) {
  const admin = await apiToken('admin');
  const tag = uniq();

  // One AMC client and one complaint on each of two divisions.
  const solarAmc = await api(admin, 'POST', '/api/contracts', {
    site: `Solar site ${tag}`, customer: `Solar Client ${tag}`, division: 'Solar',
    category: 'AMC', amcType: 'Quarterly', start: today(), end: plusDays(300),
  });
  const hvacAmc = await api(admin, 'POST', '/api/contracts', {
    site: `HVAC site ${tag}`, customer: `HVAC Client ${tag}`, division: 'HVAC',
    category: 'AMC', amcType: 'Quarterly', start: today(), end: plusDays(300),
  });
  rec('AMC: a client is registered against a division', solarAmc.status === 201
    && solarAmc.json.contract.division === 'Solar', `${solarAmc.status} ${solarAmc.json.contract?.division}`);

  const solarCall = await api(admin, 'POST', '/api/service-calls/complaints', {
    contractId: solarAmc.json.contract.id, customer: `Solar Client ${tag}`, complaint: 'Inverter tripping',
  });
  await api(admin, 'POST', '/api/service-calls/complaints', {
    contractId: hvacAmc.json.contract.id, customer: `HVAC Client ${tag}`, complaint: 'No cooling',
  });
  rec('service call: the division comes from the client it is raised against',
    solarCall.json.serviceCall.division === 'Solar', String(solarCall.json.serviceCall.division));

  // --- the Solar Manager's own login ---
  const s = await session(browser, 'akshay');
  rec('Solar Manager: the role is named that on screen',
    (await s.page.locator('text=Solar Manager').count()) >= 1);

  const menu = (await s.page.locator('nav#main-nav a').allInnerTexts()).map((t) => t.trim());
  // Owner decision (16 Nov 2026): Clients joins the nine screens of 14 Nov,
  // so the Solar Manager can reach the client directory like everyone else.
  // Owner request (18 Nov 2026): Quotations joins it too, so a Manager can
  // reach the quotation they are allowed to edit.
  const want = ['Dashboard', 'Clients', 'Enquiries', 'Quotations', 'Sales Orders', 'Lost Enquiries',
    'Projects', 'Service Calls', 'AMC / PM List', 'Issue Material', 'Checklists'];
  rec('Solar Manager: the menu is the screens asked for, Clients included',
    want.every((w) => menu.some((m) => m.includes(w))) && menu.length === want.length,
    menu.join(' | '));

  await open(s, '/service-calls');
  const callsText = await s.page.locator('body').innerText();
  rec('Solar Manager: sees solar calls and not the others',
    callsText.includes(`Solar Client ${tag}`) && !callsText.includes(`HVAC Client ${tag}`),
    callsText.slice(0, 160));
  rec('Solar Manager: is offered no division filter — there is nothing to filter',
    (await s.page.locator('[aria-label="Filter by division"]').count()) === 0);

  await open(s, '/contracts');
  const amcText = await s.page.locator('body').innerText();
  rec('Solar Manager: the AMC list is solar only',
    amcText.includes(`Solar Client ${tag}`) && !amcText.includes(`HVAC Client ${tag}`),
    amcText.slice(0, 160));

  const solarToken = s.token;
  const peek = await api(solarToken, 'GET', `/api/contracts/${hvacAmc.json.contract.id}`);
  rec('Solar Manager: another division is not reachable by id either', peek.status === 404, String(peek.status));

  const wrongDivision = await api(solarToken, 'POST', '/api/contracts', {
    site: `Nope ${tag}`, division: 'HVAC', category: 'AMC', amcType: 'Quarterly',
  });
  rec('Solar Manager: cannot register another division\u2019s client', wrongDivision.status === 403, String(wrongDivision.status));

  const ownCall = await api(solarToken, 'POST', '/api/service-calls/complaints', { customer: `Walk-in ${tag}` });
  rec('Solar Manager: a walk-in it registers is solar without being asked',
    ownCall.status === 201 && ownCall.json.serviceCall.division === 'Solar',
    `${ownCall.status} ${ownCall.json.serviceCall?.division}`);

  const engineers = (await api(solarToken, 'GET', '/api/service-calls/engineer-candidates')).json.candidates || [];
  const assigned = await api(solarToken, 'PUT', `/api/service-calls/${ownCall.json.serviceCall.id}/assign`,
    { engineerId: engineers[0] && engineers[0].id, date: plusDays(2), time: '10:00 AM' });
  rec('Solar Manager: can send a company engineer to it',
    assigned.status === 200 && assigned.json.serviceCall.status === 'Assigned', String(assigned.status));

  // Owner report (14 Nov 2026): "Solar Manager is able to see HVAC Sales
  // order ... can only see Solar Sales order".
  const soSolar = await api(admin, 'POST', '/api/sales-orders', {
    division: 'Solar', projectName: `Solar order ${tag}`, startDate: today(), paymentMilestones: [],
  });
  const soHvac = await api(admin, 'POST', '/api/sales-orders', {
    division: 'HVAC', projectName: `HVAC order ${tag}`, startDate: today(), paymentMilestones: [],
  });
  await open(s, '/sales-orders');
  await s.page.waitForTimeout(400);
  const soText = await s.page.locator('body').innerText();
  rec('Solar Manager: the Sales Orders list is solar only',
    soText.includes(`Solar order ${tag}`) && !soText.includes(`HVAC order ${tag}`), soText.slice(0, 200));
  const peekSo = await api(s.token, 'GET', `/api/sales-orders/${soHvac.json.salesOrder.id}`);
  rec('Solar Manager: an HVAC order is not reachable by id either', peekSo.status === 404, String(peekSo.status));
  const ownSo = await api(s.token, 'GET', `/api/sales-orders/${soSolar.json.salesOrder.id}`);
  rec('Solar Manager: its own order opens normally', ownSo.status === 200, String(ownSo.status));

  // The three things it must be able to raise when the admin is busy.
  const ownEnq = await api(s.token, 'POST', '/api/enquiries', {
    name: `Solar lead ${tag}`, segment: 'Solar', siteType: 'Commercial', rating: 3,
  });
  rec('Solar Manager: can raise an enquiry of its own', ownEnq.status === 201, String(ownEnq.status));
  const ownAmc = await api(s.token, 'POST', '/api/contracts', {
    site: `Own AMC ${tag}`, customer: `Own Client ${tag}`, division: 'Solar',
    category: 'AMC', amcType: 'Quarterly', start: today(), end: plusDays(300),
  });
  rec('Solar Manager: can register an AMC client of its own', ownAmc.status === 201, String(ownAmc.status));

  rec('Solar Manager: no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // --- admin sees everything, and can narrow it ---
  const a = await session(browser, 'admin');
  await open(a, '/service-calls');
  await a.page.waitForTimeout(400);
  const bothText = await a.page.locator('body').innerText();
  rec('Admin: sees every division at once',
    bothText.includes(`Solar Client ${tag}`) && bothText.includes(`HVAC Client ${tag}`));

  await a.page.locator('[aria-label="Filter by division"] button:has-text("Solar")').click();
  await settle(a);
  const solarOnly = await a.page.locator('body').innerText();
  rec('Admin: the Solar filter narrows the register to solar',
    solarOnly.includes(`Solar Client ${tag}`) && !solarOnly.includes(`HVAC Client ${tag}`),
    solarOnly.slice(0, 160));

  await a.page.locator('[aria-label="Filter by division"] button:has-text("All divisions")').click();
  await settle(a);
  rec('Admin: clearing the filter brings the others back',
    (await a.page.locator('body').innerText()).includes(`HVAC Client ${tag}`));

  rec('Admin division filter: no errors', a.errors.length === 0, a.errors.join('|'));

  // Owner request (17 Nov 2026): a call still Registered 48 hours after it
  // was taken is highlighted, because nobody has been sent to it. The
  // fixture carries one registered three days ago (svc_waiting).
  await open(a, '/service-calls');
  await a.page.waitForTimeout(400);
  const register = await a.page.locator('body').innerText();
  const waiting = ((await api(admin, 'GET', '/api/service-calls')).json.serviceCalls || [])
    .find((r) => String(r.id) === 'svc_waiting');
  rec('Service register: the server flags a call waiting over 48h',
    !!waiting && waiting.unattended === true && waiting.unattendedHours >= 72,
    JSON.stringify({ u: waiting && waiting.unattended, h: waiting && waiting.unattendedHours }));
  rec('Service register: its row is highlighted and says how long it has waited',
    (await a.page.locator('tr.sc-overdue').count()) === 1 && /waiting 3 days/.test(register),
    (register.match(/waiting[^\n]{0,30}/) || [''])[0]);
  rec('Service register: the Registered band says how many are waiting',
    /1 waiting over 48h/.test(register));
  rec('Service register: a call that has an engineer is not highlighted',
    (await a.page.locator('tr.sc-overdue:has-text("Intervalve")').count()) === 0);
  rec('Service register: no errors', a.errors.length === 0, a.errors.join('|'));

  // Owner request (17 Nov 2026): a client holds all their data. The
  // fixture's AMC client has a service call and a project under the same
  // name, so the page has real history to gather.
  const imported = await api(admin, 'POST', '/api/clients/import/amc', {});
  rec('Clients: the AMC clients can be brought into the directory',
    imported.status === 200 && imported.json.added >= 1, JSON.stringify(imported.json));
  const client = ((await api(admin, 'GET', '/api/clients')).json.clients || [])
    .find((x) => /Intervalve/i.test(x.companyName || ''));
  rec('Clients: the AMC client is on the list', !!client, client ? client.companyName : 'not found');

  const records = await api(admin, 'GET', `/api/clients/${client.id}/records`);
  rec('Clients: their history comes back, gathered by name',
    records.status === 200
    && (records.json.serviceCalls || []).length >= 1
    && (records.json.projects || []).length >= 1
    && (records.json.contracts || []).length >= 1,
    JSON.stringify({
      s: (records.json.serviceCalls || []).length,
      p: (records.json.projects || []).length,
      c: (records.json.contracts || []).length,
    }));

  // Owner request (17 Nov 2026): clicking the client opens them — the row
  // is the link, and there is no Open button to find first.
  await open(a, '/clients');
  await a.page.waitForTimeout(400);
  rec('Clients: the list offers no Open button',
    (await a.page.locator('.data-table button:text-is("Open")').count()) === 0);
  // The NAME is the link ("if i click on their name it will open"), and the
  // row around it opens too.
  await a.page.locator(`.name-link:text-is("${client.companyName}")`).first().click();
  await a.page.waitForURL(/\/clients\/(?!$)[^/]+$/, { timeout: 10000 }).catch(() => {});
  await a.page.waitForTimeout(400);
  rec('Clients: clicking the client’s name opens them',
    new URL(a.page.url()).pathname === `/clients/${client.id}`, a.page.url());

  await open(a, '/clients');
  await a.page.waitForTimeout(400);
  await a.page.locator(`tr.clickable-row:has-text("${client.companyName}") td:nth-child(3)`).first().click();
  await a.page.waitForURL(/\/clients\/(?!$)[^/]+$/, { timeout: 10000 }).catch(() => {});
  await a.page.waitForTimeout(400);
  rec('Clients: so does the rest of the row',
    new URL(a.page.url()).pathname === `/clients/${client.id}`, a.page.url());

  await open(a, `/clients/${client.id}`);
  await a.page.waitForTimeout(400);
  const page = await a.page.locator('body').innerText();
  rec('Clients: the page shows every section',
    ['Service Calls', 'Projects', 'Quotations', 'AMC / PM Contracts', 'Sales Orders', 'Payments']
      .every((h) => page.includes(h)), page.slice(0, 220));
  rec('Clients: their own details are on it', page.includes('Intervalve') && page.includes('KP87'));
  rec('Clients: no errors', a.errors.length === 0, a.errors.join('|') + noAlerts(a));
  await a.ctx.close();

  // A sales login may open the directory, but the Service Calls section is
  // not theirs — it must say so rather than show an empty list.
  const sl = await session(browser, 'sales');
  await open(sl, `/clients/${client.id}`);
  await sl.page.waitForTimeout(400);
  const salesPage = await sl.page.locator('body').innerText();
  rec('Clients: a section the viewer may not see says so, rather than looking empty',
    /Not yours to see/i.test(salesPage), (salesPage.match(/Not yours[^\n]{0,60}/) || [''])[0]);
  rec('Clients (sales): no errors', sl.errors.length === 0, sl.errors.join('|'));
  await sl.ctx.close();
}

/* ------------------------------------------------ 6k the team dropdowns, and the
   quotation a Project Manager's site was won on (owner request, 14 Nov 2026) */
async function group6k(browser) {
  const adminT = await apiToken('admin');
  const salesT = await apiToken('sales');
  const tag = uniq();

  // A lead, quoted, accepted -- the only route to a sales order now.
  const enq = await api(salesT, 'POST', '/api/enquiries', {
    name: `Quote Client ${tag}`, segment: 'Solar', siteType: 'Commercial', rating: 4,
    contacts: [{ name: 'Mr Rao', designation: 'Owner', phone: '9000012345' }],
  });
  rec('6k: the lead is registered', enq.status === 201 && !!enq.json.enquiry?.id, String(enq.status));
  const qt = await api(salesT, 'POST', '/api/quotations', {
    division: 'Solar', customerName: `Quote Client ${tag}`, customerPhone: '9000012345',
    subject: `Rooftop ${tag}`, date: today(), enquiryId: enq.json.enquiry.id,
    equipmentItems: [{ description: 'Panels', unit: 'Nos', qty: 1, supplyRate: 400000, installationRate: 100000 }],
    accessoriesItems: [],
  });
  // Solar prices per item, so the 18% default applies: 5,00,000 + 90,000.
  rec('6k: a quotation is raised against the lead, totalling 5,90,000',
    qt.status === 201 && qt.json.quotation?.grandTotal === 590000,
    `${qt.status} ${qt.json.quotation?.quotationNumber} ${qt.json.quotation?.grandTotal}`);

  // --- the two dropdowns on the conversion form ---
  const s = await session(browser, 'sales');
  await open(s, `/quotations/${qt.json.quotation.id}/convert`);

  const salesSel = field(s.page, 'Sales Team');
  const projSel = field(s.page, 'Project Team');
  rec('6k: Sales Team is a dropdown, not a text box',
    (await salesSel.evaluate((el) => el.tagName)) === 'SELECT');
  rec('6k: Project Team is a dropdown, not a text box',
    (await projSel.evaluate((el) => el.tagName)) === 'SELECT');

  const salesNames = (await salesSel.locator('option').allInnerTexts()).map((t) => t.trim());
  const projNames = (await projSel.locator('option').allInnerTexts()).map((t) => t.trim());
  rec('6k: Sales Team offers the Admin and Sales logins',
    salesNames.some((n) => /admin/i.test(n)) && salesNames.some((n) => /sales/i.test(n)),
    salesNames.join(' | '));
  rec('6k: Project Team offers the Admin and the division Managers, and no sales person',
    projNames.some((n) => /admin/i.test(n)) && projNames.length >= 3,
    projNames.join(' | '));

  // The two lists are not the same list.
  rec('6k: the two dropdowns are different lists',
    JSON.stringify(salesNames) !== JSON.stringify(projNames));

  const projectPick = projNames.find((n) => n !== '— none —');
  await projSel.selectOption({ label: projectPick });
  await flat(s.page, 'Project Name *').fill(`Won site ${tag}`);
  await s.page.locator('form button[type=submit]').click();
  await s.page.waitForFunction(() => !location.pathname.endsWith('/convert'), null, { timeout: 15000 }).catch(() => {});
  await settle(s);

  const sos = (await api(adminT, 'GET', '/api/sales-orders')).json.salesOrders || [];
  const so = sos.find((o) => o.projectName === `Won site ${tag}`);
  rec('6k: the order saved the chosen Project Team exactly as picked',
    !!so && projectPick.startsWith(so.projectTeam), `${so && so.projectTeam} vs ${projectPick}`);
  rec('6k: conversion form: no errors', s.errors.length === 0, s.errors.join('|') + noAlerts(s));
  await s.ctx.close();

  // --- the quotation shows on the project the order created ---
  const projects = (await api(adminT, 'GET', '/api/projects')).json.projects || [];
  const prj = projects.find((x) => x.name === `Won site ${tag}`);
  rec('6k: the order created a project for the site', !!prj, String(projects.length));

  const pm = await session(browser, 'akshay'); // the Solar Manager
  await open(pm, `/projects/${prj.id}`);
  const pmText = await pm.page.locator('body').innerText();
  rec('6k: the Project Manager sees the quotation the site was won on',
    pmText.includes(`Won on quotation ${qt.json.quotation.quotationNumber}`), pmText.slice(0, 200));
  const quotePanel = await pm.page.locator('.proj-quote').innerText();
  rec('6k: and what it was quoted at, and that the customer accepted it',
    /quoted value/i.test(quotePanel) && /5,90,000/.test(quotePanel) && /accepted/i.test(quotePanel),
    quotePanel.replace(/\s+/g, ' ').slice(0, 200));

  rec('6k: View Quotation sits beside View Sales Order',
    (await pm.page.locator('button:has-text("View Sales Order")').count()) === 1
    && (await pm.page.locator('button:has-text("View Quotation")').count()) === 1);

  // For a Project Manager the button opens the customer's PDF in a new tab,
  // because the Quotations screens are not theirs to open.
  const popup = pm.page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  await pm.page.locator('button:has-text("View Quotation")').click();
  const tab = await popup;
  rec('6k: for the Project Manager it opens the quotation PDF',
    !!tab && /\/api\/public\/quotations\/[0-9a-f]{48}$/.test(tab.url()), tab ? tab.url() : 'no new tab');
  if (tab) await tab.close();

  // Owner request (18 Nov 2026): the Quotations area is open to a Manager
  // now — for their OWN division. This is the Solar Manager on a Solar
  // quotation, so it is theirs. Group 6o covers the division boundary.
  const open403 = await api(pm.token, 'GET', `/api/quotations/${qt.json.quotation.id}`);
  rec('6k: the Project Manager can now open their own division’s quotation',
    open403.status === 200, String(open403.status));

  const link = await api(pm.token, 'GET', `/api/projects/${prj.id}/quotation-pdf-link`);
  rec('6k: but the quotation PDF is reachable through the project',
    link.status === 200 && /^[0-9a-f]{48}$/.test(link.json.pdfToken || ''), String(link.status));

  rec('6k: project screen: no errors', pm.errors.length === 0, pm.errors.join('|') + noAlerts(pm));
  await pm.ctx.close();

  // Admin may open the Quotations screens, so the same button goes there.
  const ad = await session(browser, 'admin');
  await open(ad, `/projects/${prj.id}`);
  await ad.page.locator('button:has-text("View Quotation")').click();
  await settle(ad);
  rec('6k: for Admin the same button opens the quotation screen itself',
    ad.page.url().endsWith(`/quotations/${qt.json.quotation.id}`), ad.page.url());
  rec('6k: admin project screen: no errors', ad.errors.length === 0, ad.errors.join('|') + noAlerts(ad));
  await ad.ctx.close();
}

/* ------------------------------------------------ 6l Save as Draft on the
   quotation and the sales order (owner request, 14 Nov 2026) */
async function group6l(browser) {
  const adminT = await apiToken('admin');
  const tag = uniq();

  // The quotation screen wraps its input inside the label; the sales order
  // screen puts the label above it.
  // The quotation screen wraps its input inside the label, except where a
  // shared component (ClientSelect, 16 Nov 2026) puts the label above it.
  // Match either shape rather than pinning the test to one of them.
  const qField = (page, text) => page.locator(
    `label.filter-field:has-text("${text}") :is(input, select), `
    + `.filter-field:has(> label:text-is("${text}")) :is(input, select)`
  ).first();
  const countQuotations = async () => ((await api(adminT, 'GET', '/api/quotations')).json.quotations || []).length;
  const countOrders = async () => ((await api(adminT, 'GET', '/api/sales-orders')).json.salesOrders || []).length;
  const countProjects = async () => ((await api(adminT, 'GET', '/api/projects')).json.projects || []).length;

  const quotationsBefore = await countQuotations();
  const ordersBefore = await countOrders();
  const projectsBefore = await countProjects();

  // --- a quotation put away half-filled ---
  const s = await session(browser, 'sales');
  await open(s, '/quotations/new');
  await qField(s.page, 'Customer Name *').fill(`Draft Client ${tag}`);
  // Division deliberately left empty: a draft does not have to be complete.
  await s.page.locator('button:has-text("Save as Draft")').click();
  await settle(s);
  rec('6l: the quotation form says it saved', (await s.page.locator('body').innerText()).includes('Saved as draft.'));
  rec('6l: a quotation draft creates no quotation, so no QTN number is spent',
    (await countQuotations()) === quotationsBefore, `${await countQuotations()} vs ${quotationsBefore}`);

  const drafts = (await api(s.token, 'GET', '/api/form-drafts?kind=quotation')).json.drafts || [];
  const mine = drafts.find((d) => d.label === `Draft Client ${tag}`);
  rec('6l: the draft is listed under the name it had got to', !!mine, drafts.map((d) => d.label).join(' | '));

  // --- and picked up again on a fresh visit ---
  await open(s, '/quotations/new');
  await s.page.locator('button:has-text("Drafts (")').click();
  await s.page.locator(`button:has-text("Draft Client ${tag}")`).click();
  await settle(s);
  rec('6l: resuming a draft puts the form back as it was',
    (await qField(s.page, 'Customer Name *').inputValue()) === `Draft Client ${tag}`);

  // Finishing it is the ordinary submit — and only then is a number spent.
  await qField(s.page, 'Division *').selectOption('Solar');
  await s.page.locator('button:has-text("Create Quotation")').click();
  await s.page.waitForURL(/\/quotations\/(?!new$)[^/]+$/, { timeout: 15000 }).catch(() => {});
  await settle(s);
  rec('6l: finishing the draft creates the quotation', (await countQuotations()) === quotationsBefore + 1,
    `${await countQuotations()} vs ${quotationsBefore + 1}`);
  const left = (await api(s.token, 'GET', '/api/form-drafts?kind=quotation')).json.drafts || [];
  rec('6l: and the draft is cleared once the quotation exists',
    !left.some((d) => d.label === `Draft Client ${tag}`), left.map((d) => d.label).join(' | '));
  rec('6l: quotation drafts: no errors', s.errors.length === 0, s.errors.join('|') + noAlerts(s));
  await s.ctx.close();

  // --- a sales order put away half-filled raises nothing at all ---
  const so = await session(browser, 'sales');
  await open(so, '/sales-orders/new');
  await field(so.page, 'Project Name *').fill(`Draft Site ${tag}`);
  await so.page.locator('button:has-text("Save as Draft")').click();
  await settle(so);
  rec('6l: a sales order draft raises no order, no project and no payment',
    (await countOrders()) === ordersBefore && (await countProjects()) === projectsBefore,
    `orders ${await countOrders()}/${ordersBefore} projects ${await countProjects()}/${projectsBefore}`);

  const soDrafts = (await api(so.token, 'GET', '/api/form-drafts?kind=salesOrder')).json.drafts || [];
  rec('6l: the sales order draft is listed', soDrafts.some((d) => d.label === `Draft Site ${tag}`),
    soDrafts.map((d) => d.label).join(' | '));
  rec('6l: sales order drafts: no errors', so.errors.length === 0, so.errors.join('|') + noAlerts(so));
  await so.ctx.close();

  // --- a draft is personal ---
  const otherT = await apiToken('finance');
  const seen = (await api(otherT, 'GET', '/api/form-drafts?kind=quotation')).json.drafts || [];
  rec('6l: another person does not see someone else’s drafts',
    !seen.some((d) => d.label === `Draft Client ${tag}`), seen.map((d) => d.label).join(' | '));
  const engineerT = await apiToken('vinod');
  const refused = await api(engineerT, 'GET', '/api/form-drafts?kind=quotation');
  rec('6l: a role that cannot raise a quotation cannot keep drafts of one either',
    refused.status === 403, String(refused.status));
}


/* ------------------------------------------------ 6m the client's PEOPLE fill the
   forms (owner request, 17 Nov 2026) */
async function group6m(browser) {
  const adminT = await apiToken('admin');
  const tag = uniq();
  const name = `Peoplecorp ${tag}`;

  // A client with an owner and two more people on their record.
  const made = await api(adminT, 'POST', '/api/clients', {
    companyName: name,
    clientName: 'Mr. Owner Patil',
    designation: 'Director',
    phone: '9800000001',
    address: 'Bhosari, Pune',
    gst: '27ZZZZZ9999Z1Z1',
    contacts: [
      { name: 'Mrs. Kavita Rao', designation: 'Purchase Manager', phone: '9800000002' },
      { name: 'Mr. Rahul Deshmukh', designation: 'Maintenance In-charge', phone: '9800000003' },
    ],
  });
  rec('6m: a client can hold the owner and more people', made.status === 201 || made.status === 200,
    String(made.status));

  const qField = (page, text) => page.locator(
    `label.filter-field:has-text("${text}") :is(input, select), `
    + `.filter-field:has(> label:text-is("${text}")) :is(input, select)`
  ).first();
  /** Click the chip for one of the client's people. */
  const person = (page, who) => page.locator(`.contact-pick button:has-text("${who}")`).first();

  // --- the quotation ---
  const s = await session(browser, 'sales');
  await open(s, '/quotations/new');
  await qField(s.page, 'Customer Name *').fill(name);
  await s.page.waitForTimeout(600);
  await s.page.locator(`.client-suggestions button:has-text("${name}")`).first().click();
  await settle(s);
  rec('6m: picking the client brings their GST and address with them',
    (await qField(s.page, 'Customer GST').inputValue()) === '27ZZZZZ9999Z1Z1'
    && (await qField(s.page, 'Customer Address').inputValue()) === 'Bhosari, Pune');
  rec('6m: and their people are offered', (await s.page.locator('.contact-pick button').count()) === 3,
    String(await s.page.locator('.contact-pick button').count()));

  await person(s.page, 'Mrs. Kavita Rao').click();
  await s.page.waitForTimeout(200);
  rec('6m: picking a person fills their number, not the company’s',
    (await qField(s.page, 'Customer Phone').inputValue()) === '9800000002',
    await qField(s.page, 'Customer Phone').inputValue());

  await qField(s.page, 'Division *').selectOption('HVAC');
  await s.page.locator('button:has-text("Create Quotation")').click();
  await s.page.waitForURL(/\/quotations\/(?!new$)[^/]+$/, { timeout: 15000 }).catch(() => {});
  await settle(s);
  const quoted = ((await api(adminT, 'GET', '/api/quotations')).json.quotations || [])
    .find((q) => q.customerName === name);
  rec('6m: the quotation records WHO it is for, for the Kind Attn line',
    !!quoted && quoted.contactName === 'Mrs. Kavita Rao'
    && quoted.contactDesignation === 'Purchase Manager',
    JSON.stringify(quoted && { n: quoted.contactName, d: quoted.contactDesignation }));
  rec('6m: and WHICH client, so their history is exact', !!quoted && !!quoted.clientId);
  rec('6m: quotation: no errors', s.errors.length === 0, s.errors.join('|') + noAlerts(s));
  await s.ctx.close();

  // --- the complaint ---
  const a = await session(browser, 'admin');
  await open(a, '/service-calls/new');
  await a.page.locator('button:has-text("Not an AMC / Warranty client")').click();
  await a.page.waitForTimeout(200);
  await qField(a.page, 'Client (from the client list)').fill(name);
  await a.page.waitForTimeout(600);
  await a.page.locator(`.client-suggestions button:has-text("${name}")`).first().click();
  await settle(a);
  rec('6m: a complaint for a non-AMC client fills from the client list',
    (await qField(a.page, 'Customer *').inputValue()) === name,
    await qField(a.page, 'Customer *').inputValue());

  await person(a.page, 'Mr. Rahul Deshmukh').click();
  await a.page.waitForTimeout(200);
  rec('6m: and the number is the person’s, not the company’s',
    (await qField(a.page, 'Phone').inputValue()) === '9800000003',
    await qField(a.page, 'Phone').inputValue());

  await a.page.locator('.filter-field:has(> label:text-is("Description")) textarea').fill('Indoor unit leaking');
  await a.page.locator('button:has-text("Register Complaint")').last().click();
  await a.page.waitForURL(/\/service-calls\/(?!new$)[^/]+$/, { timeout: 15000 }).catch(() => {});
  await settle(a);
  const call = ((await api(adminT, 'GET', '/api/service-calls')).json.serviceCalls || [])
    .find((c) => c.customer === name);
  rec('6m: the call records who reported it and which client they are',
    !!call && call.contactName === 'Mr. Rahul Deshmukh'
    && call.contactDesignation === 'Maintenance In-charge' && !!call.clientId,
    JSON.stringify(call && { n: call.contactName, d: call.contactDesignation, c: !!call.clientId }));
  rec('6m: complaint: no errors', a.errors.length === 0, a.errors.join('|') + noAlerts(a));
  await a.ctx.close();
}


/* ------------------------------------------------ 6n correcting a client corrects
   the records that copied their details (owner request, 18 Nov 2026) */
async function group6n(browser) {
  const adminT = await apiToken('admin');
  const salesT = await apiToken('sales');
  const tag = uniq();
  const was = `Oldname Industries ${tag}`;
  const now = `Newname Industries ${tag}`;

  // A client, and real records raised FOR them through the ordinary routes.
  const client = (await api(adminT, 'POST', '/api/clients', {
    companyName: was, clientName: 'Mr Owner', phone: '9811100001',
    address: 'Undri, Pune', email: 'old@example.com', gst: 'GST-OLD',
  })).json.client;

  const draft = (await api(salesT, 'POST', '/api/quotations', {
    division: 'HVAC', clientId: client.id, customerName: was,
    customerPhone: '9811100001', customerAddress: 'Undri, Pune',
    equipmentItems: [{ description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 100 }],
  })).json.quotation;

  const sent = (await api(salesT, 'POST', '/api/quotations', {
    division: 'HVAC', clientId: client.id, customerName: was,
    equipmentItems: [{ description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 100 }],
  })).json.quotation;
  await api(salesT, 'PATCH', `/api/quotations/${sent.id}`, { status: 'Sent' });

  const call = (await api(adminT, 'POST', '/api/service-calls/complaints', {
    customer: was, phone: '9811100001', clientId: client.id,
    complaintDescription: 'Unit not cooling', division: 'HVAC',
  })).json.serviceCall;

  // Rename them on the Clients screen, the way the owner would.
  const a = await session(browser, 'admin');
  await open(a, '/clients');
  await a.page.waitForTimeout(400);
  await a.page.locator(`tr:has-text("${was}") button:has-text("Edit")`).first().click();
  await a.page.waitForTimeout(300);
  const company = a.page.locator('.modal .filter-field:has(> label:text-is("Company Name")) input').first();
  await company.fill(now);
  await a.page.locator('.modal button:has-text("Save")').click();
  await settle(a);

  const note = await a.page.locator('body').innerText();
  rec('6n: the screen says what the correction reached',
    /Updated .*quotation/i.test(note) && /Left as sent/i.test(note),
    (note.match(/Updated[^\n]{0,160}/) || [''])[0]);

  const after = (await api(salesT, 'GET', '/api/quotations')).json.quotations || [];
  rec('6n: the draft quotation now says the new name',
    (after.find((q) => q.id === draft.id) || {}).customerName === now,
    (after.find((q) => q.id === draft.id) || {}).customerName);
  rec('6n: the quotation already sent keeps the name it went out with',
    (after.find((q) => q.id === sent.id) || {}).customerName === was,
    (after.find((q) => q.id === sent.id) || {}).customerName);

  const calls = (await api(adminT, 'GET', '/api/service-calls')).json.serviceCalls || [];
  rec('6n: the service register says the new name',
    (calls.find((c) => c.id === call.id) || {}).customer === now,
    (calls.find((c) => c.id === call.id) || {}).customer);

  // And their own page still gathers everything, old records included.
  const records = await api(adminT, 'GET', `/api/clients/${client.id}/records`);
  rec('6n: their page still finds all of it after the rename',
    records.status === 200
    && (records.json.quotations || []).length >= 2
    && (records.json.serviceCalls || []).length >= 1,
    JSON.stringify({ q: (records.json.quotations || []).length, s: (records.json.serviceCalls || []).length }));
  rec('6n: no errors', a.errors.length === 0, a.errors.join('|') + noAlerts(a));
  await a.ctx.close();
}


/* ------------------------------------------------ 6o a Project Manager edits the
   sales order and the quotation of the job they run (owner request, 18 Nov 2026) */
async function group6o(browser) {
  const adminT = await apiToken('admin');
  const salesT = await apiToken('sales');
  const tag = uniq();

  // An HVAC quotation, and a Solar one the HVAC Manager must never reach.
  const mine = (await api(salesT, 'POST', '/api/quotations', {
    division: 'HVAC', customerName: `PM Edit HVAC ${tag}`,
    equipmentItems: [{ description: 'Unit', unit: 'Nos', qty: 1, supplyRate: 100 }],
  })).json.quotation;
  const theirs = (await api(salesT, 'POST', '/api/quotations', {
    division: 'Solar', customerName: `PM Edit Solar ${tag}`,
    equipmentItems: [{ description: 'Panel', unit: 'Nos', qty: 1, supplyRate: 100 }],
  })).json.quotation;

  const pmT = await apiToken('amol'); // the HVAC Manager
  const list = (await api(pmT, 'GET', '/api/quotations')).json.quotations || [];
  rec('6o: a Manager’s quotation register is their own division’s',
    list.some((q) => q.id === mine.id) && !list.some((q) => q.id === theirs.id),
    `${list.length} rows, divisions ${[...new Set(list.map((q) => q.division))].join('/')}`);
  rec('6o: another division’s quotation is not found, rather than refused',
    (await api(pmT, 'GET', `/api/quotations/${theirs.id}`)).status === 404);
  rec('6o: and cannot be edited either',
    (await api(pmT, 'PATCH', `/api/quotations/${theirs.id}`, { subject: 'nope' })).status === 404);
  rec('6o: a Manager cannot raise a new quotation',
    (await api(pmT, 'POST', '/api/quotations', { division: 'HVAC', customerName: 'x', equipmentItems: [] })).status === 403);

  // Editing their own, through the screen.
  const pm = await session(browser, 'amol');
  await open(pm, `/quotations/${mine.id}`);
  await pm.page.waitForTimeout(400);
  rec('6o: the Edit button is there for them',
    (await pm.page.locator('button:text-is("Edit")').count()) === 1);
  rec('6o: raising and duplicating are not',
    (await pm.page.locator('button:has-text("Duplicate")').count()) === 0);
  await pm.page.locator('button:text-is("Edit")').click();
  await settle(pm);
  const subject = pm.page.locator('label.filter-field:has-text("Subject") input, .filter-field:has(> label:text-is("Subject")) input').first();
  await subject.fill(`Corrected by the Manager ${tag}`);
  await pm.page.locator('button:has-text("Save")').first().click();
  await settle(pm);
  const q = (await api(adminT, 'GET', `/api/quotations/${mine.id}`)).json.quotation;
  rec('6o: a Manager’s quotation edit saves', q.subject === `Corrected by the Manager ${tag}`, q.subject);
  rec('6o: quotation: no errors', pm.errors.length === 0, pm.errors.join('|') + noAlerts(pm));

  // The sales order: the job, never the money.
  const soList = (await api(pmT, 'GET', '/api/sales-orders')).json.salesOrders || [];
  const target = soList.find((o) => o.division === 'HVAC');
  rec('6o: the Manager has an HVAC sales order to work on', !!target);
  await open(pm, `/sales-orders/${target.id}`);
  await pm.page.waitForTimeout(400);
  await pm.page.locator('button:has-text("Edit Sales Order")').first().click();
  await pm.page.waitForTimeout(400);
  const modal = await pm.page.locator('.modal').innerText();
  rec('6o: the edit form offers them the job',
    /Site Address/i.test(modal) && /Crucial/i.test(modal));
  rec('6o: and not the money',
    !/Equipment Purchase/i.test(modal) && !/Payment Milestones/i.test(modal) && !/Total Cost/i.test(modal),
    (modal.match(/(Equipment Purchase|Payment Milestones|Total Cost)/) || [''])[0]);
  const site = pm.page.locator('.modal .filter-field:has(> label:text-is("Site Address")) input').first();
  await site.fill(`Plant 2, Chakan ${tag}`);
  await pm.page.locator('.modal button:has-text("Save")').click();
  await settle(pm);
  const after = (await api(adminT, 'GET', `/api/sales-orders/${target.id}`)).json.salesOrder;
  rec('6o: a Manager’s sales order edit saves', after.siteAddress === `Plant 2, Chakan ${tag}`, after.siteAddress);
  rec('6o: and the costing is untouched', after.highSidePurchase === target.highSidePurchase,
    `${after.highSidePurchase} vs ${target.highSidePurchase}`);
  rec('6o: a money field sent anyway is refused',
    (await api(pmT, 'PATCH', `/api/sales-orders/${target.id}`, { highSidePurchase: 1 })).status === 403);
  rec('6o: sales order: no errors', pm.errors.length === 0, pm.errors.join('|') + noAlerts(pm));
  await pm.ctx.close();
}

const GROUPS = { '6a': group6a, '6b': group6b, '6c': group6c, '6d': group6d, '6e': group6e, '6f': group6f, '6g': group6g, '6h': group6h, '6i': group6i, '6j': group6j, '6k': group6k, '6l': group6l, '6m': group6m, '6n': group6n, '6o': group6o };

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
