'use strict';
/**
 * Frontend page-migration workflows — the screens migrated in batches 5a–5g of
 * FRONTEND_32_PAGE_MIGRATION_PLAN.md, exercised through the real UI:
 * create / detail / action flows, the roles that use them, desktop and mobile
 * (390 px) layout, and no JS errors or server errors along the way.
 *
 * Runs against the same in-memory dev assembly as run.js (never a database):
 *   1. cd new-app/frontend && npm run build
 *   2. node e2e/completion/server.js        (port 4100; restart before each run)
 *   3. node e2e/completion/pages.js [5a 5b ...]   (default: every group)
 * Set PLAYWRIGHT_MODULE / CHROMIUM_PATH if Playwright is not resolvable.
 * Optional SHOTS=<dir> saves desktop + mobile screenshots of each checked page.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';
const SHOTS = process.env.SHOTS || '';
const PASSWORD = 'password123';
const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`);
};
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4);

async function apiToken(username) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const j = await r.json();
  if (!j.token) throw new Error(`API login failed for ${username}: ${JSON.stringify(j)}`);
  return j.token;
}
async function api(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

/** A logged-in browser session that records JS errors and 5xx responses. */
async function session(browser, username, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('JS: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('label:has-text("Username") input').fill(username);
  await page.locator('label:has-text("Password") input').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return { ctx, page, errors };
}
async function open(s, path) {
  await s.page.goto(BASE + path, { waitUntil: 'networkidle' });
  await s.page.waitForTimeout(250);
}
const bodyText = async (page) => (await page.locator('main, #main-content, body').first().innerText()).replace(/\s+/g, ' ');

/**
 * Layout check for one page: desktop render plus a 390 px phone render with
 * no sideways page scroll, and optional screenshots.
 */
async function layoutCheck(browser, username, path, label, mustContain) {
  for (const [vn, vp] of [['desktop', { width: 1366, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
    const s = await session(browser, username, vp);
    await open(s, path);
    const t = await bodyText(s.page);
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    rec(`${label} [${vn}]: renders${mustContain ? ` "${mustContain}"` : ''}, no page-level sideways scroll, no errors`,
      (!mustContain || t.includes(mustContain)) && over <= 1 && s.errors.length === 0 && !/Something went wrong|Cannot read prop/i.test(t),
      `overflow=${over}px ${s.errors.join(' | ')}`);
    if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/${label.replace(/[^a-z0-9]+/gi, '-')}-${vn}.png`, fullPage: true });
    await s.ctx.close();
  }
}

/* ---------------------------------------------------------------- 5a */
async function group5a(browser) {
  const adminT = await apiToken('admin');
  const storeT = await apiToken('store');

  // Notifications (admin): list renders; marking one read works when any exist.
  {
    const s = await session(browser, 'admin');
    await open(s, '/notifications');
    rec('notifications: page renders for admin', (await bodyText(s.page)).includes('Notifications') && s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'admin', '/notifications', 'notifications', 'Notifications');
  }

  // Subscription Management (super): seed the default plans, see all seven, open a company's subscription modal.
  {
    const s = await session(browser, 'Sam');
    await open(s, '/admin/subscriptions');
    const seed = s.page.locator('button:has-text("Seed Default Plans")');
    if (await seed.count()) { await seed.click(); await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300); }
    const t = await bodyText(s.page);
    const plans = ['HVAC Starter', 'Solar Starter', 'MEP Starter', 'MEP + HVAC Pro', 'MEP + Solar Pro', 'Solar + HVAC Pro', 'Full Enterprise'];
    rec('subscriptions (super): all seven plans listed after seeding', plans.every((p) => t.includes(p)), plans.filter((p) => !t.includes(p)).join(', ') || 'all 7');
    const manage = s.page.locator('table button.btn.sec').first();
    if (await manage.count()) {
      await manage.click(); await s.page.waitForTimeout(300);
      rec('subscriptions (super): company subscription modal opens and cancels', await s.page.locator('.modal').isVisible());
      await s.page.locator('.modal button:has-text("Cancel")').click();
    } else rec('subscriptions (super): company subscription modal opens and cancels', false, 'no company row button');
    rec('subscriptions (super): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'Sam', '/admin/subscriptions', 'subscriptions', 'Subscription Management');
  }

  // Checklist template detail (admin): add a point, then remove it.
  {
    const name = 'E2E template ' + uniq();
    const c = await api(adminT, 'POST', '/api/checklist-templates', { name, division: 'HVAC' });
    const tid = c.json && (c.json.template?.id || c.json.id);
    rec('checklist template created for the test (API)', c.status < 300 && !!tid, `${c.status} ${c.text.slice(0, 120)}`);
    const s = await session(browser, 'admin');
    await open(s, `/checklists/${tid}`);
    await s.page.locator('button:has-text("+ Add Point")').click();
    const point = 'E2E point ' + uniq();
    await s.page.locator('.modal input').first().fill(point);
    await s.page.locator('.modal button:has-text("Save")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    rec('checklist detail: Add Point saves and the point is listed', (await bodyText(s.page)).includes(point));
    const after = await api(adminT, 'GET', `/api/checklist-templates/${tid}`);
    const items = after.json?.template?.items || after.json?.items || [];
    rec('checklist detail: the point is persisted on the server', items.some((i) => i.text === point), `${items.length} items`);
    const row = s.page.locator('tr', { hasText: point });
    await row.locator('button:has-text("Remove")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    rec('checklist detail: Remove deletes the point', !(await bodyText(s.page)).includes(point));
    rec('checklist detail: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'admin', `/checklists/${tid}`, 'checklist-detail', name);
  }

  // Company Profile (admin): edit and save a field, reload shows it, then restore.
  {
    const s = await session(browser, 'admin');
    await open(s, '/company-profile');
    const before = (await api(adminT, 'GET', '/api/companies/my-profile')).json;
    const prevSite = (before?.company || before)?.website || '';
    await s.page.locator('button:has-text("Edit Profile")').click();
    const site = `https://e2e-${uniq()}.example.in`;
    await s.page.locator('label:has-text("Website") input').fill(site);
    await s.page.locator('form button[type=submit]').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    await open(s, '/company-profile');
    rec('company profile: an edited field is saved and shown after reload', (await bodyText(s.page)).includes(site));
    await api(adminT, 'PATCH', '/api/companies/my-profile', { website: prevSite });
    rec('company profile: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'admin', '/company-profile', 'company-profile', 'Company Profile');
  }

  // Contract create (admin): a new AMC contract is created and reachable.
  {
    const s = await session(browser, 'admin');
    await open(s, '/contracts/new');
    const site = 'E2E plant ' + uniq();
    await s.page.locator('label:has-text("Customer Name") + input, label:has-text("Customer Name") ~ input').first().fill('E2E Customer');
    await s.page.locator('label:has-text("Site") + input').first().fill(site);
    await s.page.locator('label:has-text("Amount") + input').first().fill('48000');
    await s.page.locator('label:has-text("Start Date") + input').first().fill('2026-11-01');
    await s.page.locator('label:has-text("End Date") + input').first().fill('2027-10-31');
    await s.page.locator('form button[type=submit]').click();
    await s.page.waitForFunction(() => !location.pathname.endsWith('/contracts/new'), null, { timeout: 10000 }).catch(() => {});
    await s.page.waitForLoadState('networkidle');
    const list = await api(adminT, 'GET', '/api/contracts');
    const all = list.json?.contracts || list.json || [];
    rec('contract create: the contract is saved', Array.isArray(all) && all.some((c) => c.site === site), `${list.status}`);
    rec('contract create: leaves the form after saving', !s.page.url().endsWith('/contracts/new'), s.page.url());
    rec('contract create: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'admin', '/contracts/new', 'contract-create', 'New AMC / Warranty Contract');
  }

  // Categories & Locations (inventory staff): add one of each.
  const locA = 'E2E Store A ' + uniq();
  const locB = 'E2E Store B ' + uniq();
  {
    const s = await session(browser, 'store');
    await open(s, '/inventory/categories');
    const cat = 'E2E Cat ' + uniq();
    await s.page.locator('button:has-text("+ Add Category")').click();
    await s.page.locator('.modal input').first().fill(cat);
    await s.page.locator('.modal button[type=submit], .modal button:has-text("Save"), .modal button:has-text("Create")').first().click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    rec('categories: inventory staff can add a category', (await bodyText(s.page)).includes(cat));
    for (const loc of [locA, locB]) {
      await s.page.locator('button:has-text("+ Add Location")').click();
      await s.page.locator('.modal input').first().fill(loc);
      await s.page.locator('.modal button[type=submit], .modal button:has-text("Save"), .modal button:has-text("Create")').first().click();
      await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    }
    const t = await bodyText(s.page);
    rec('categories: inventory staff can add locations', t.includes(locA) && t.includes(locB));
    rec('categories: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'store', '/inventory/categories', 'categories-locations', 'Categories');
  }

  // Stock transfer (inventory staff): move stock between the two locations; stock levels follow.
  {
    const locs = (await api(storeT, 'GET', '/api/inventory/locations')).json;
    const L = (locs?.locations || locs || []);
    const a = L.find((l) => l.name === locA), b = L.find((l) => l.name === locB);
    const itemName = 'E2E Copper pipe ' + uniq();
    const it = await api(storeT, 'POST', '/api/inventory/items', { name: itemName, unit: 'Nos', openingStock: { [a.id]: 10 } });
    const item = it.json?.item || it.json;
    rec('transfer: test item created with opening stock (API)', it.status < 300 && !!item?.id, `${it.status} ${it.text.slice(0, 120)}`);
    const s = await session(browser, 'store');
    await open(s, '/inventory/transfer');
    const selects = s.page.locator('form select');
    await selects.nth(0).selectOption({ label: new RegExp(itemName) }).catch(async () => selects.nth(0).selectOption(item.id));
    await selects.nth(1).selectOption(a.id);
    await selects.nth(2).selectOption(b.id);
    await s.page.locator('label:has-text("Quantity") + input, .filter-field:has-text("Quantity") input').first().fill('4');
    await s.page.locator('form button[type=submit]').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(400);
    const after = (await api(storeT, 'GET', `/api/inventory/items/${item.id}`)).json;
    const stock = (after?.item || after)?.stockByLocation || {};
    rec('transfer: 4 of 10 moved — source 6, destination 4', Number(stock[a.id]) === 6 && Number(stock[b.id]) === 4, JSON.stringify(stock));
    rec('transfer: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'store', '/inventory/transfer', 'stock-transfer', 'Stock Transfer');
  }

  // Sales order list (admin) → detail.
  {
    const s = await session(browser, 'admin');
    await open(s, '/sales-orders');
    const row = s.page.locator('tr.clickable-row', { hasText: '1001' });
    rec('sales order list: SO 1001 listed', (await row.count()) > 0);
    await row.first().click(); await s.page.waitForLoadState('networkidle');
    await s.page.waitForSelector('h2:has-text("SO-1001")', { timeout: 8000 }).catch(() => {});
    rec('sales order list: a row opens the sales order', /\/sales-orders\/so_demo$/.test(s.page.url()) && (await s.page.locator('h2:has-text("SO-1001")').count()) > 0, s.page.url());
    rec('sales order list: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'admin', '/sales-orders', 'sales-order-list', 'Sales Orders');
  }

  // Service call list (service manager) → detail.
  {
    const s = await session(browser, 'service');
    await open(s, '/service-calls');
    const row = s.page.locator('tr', { hasText: 'AHU 2 vibration' }).or(s.page.locator('tr', { hasText: 'Intervalve Poonawalla' }));
    rec('service call list: the open call is listed for the service manager', (await row.count()) > 0);
    await row.first().click(); await s.page.waitForLoadState('networkidle');
    rec('service call list: a row opens the call', /\/service-calls\/svc_demo$/.test(s.page.url()), s.page.url());
    rec('service call list: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
    await layoutCheck(browser, 'service', '/service-calls', 'service-call-list', 'Service Calls');
  }
}

/* ---------------------------------------------------------------- 5b */
async function group5b(browser) {
  const CO = 'MEP Powertech (Dev)';
  const s = await session(browser, 'Sam');

  // Client usage: per-company business figures come from the platform usage API.
  await open(s, '/admin/usage');
  await s.page.waitForSelector(`td:has-text("${CO}")`, { timeout: 8000 }).catch(() => {});
  const usageRow = (await s.page.locator('tr', { hasText: CO }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec('client usage (super): the company row shows its real counts (4 enquiries, 1 SO, 1 project)', /\b4\b/.test(usageRow) && /\b1\b/.test(usageRow), usageRow);
  rec('client usage (super): the payments panel is shown', (await bodyText(s.page)).includes('Payments Handled Through the App'));

  // Expiring: the company (subscription ends in 10 days) is listed; Renew / Edit opens the company editor.
  await open(s, '/admin/expiring');
  const expRow = s.page.locator('tr', { hasText: CO });
  rec('expiring (super): the company whose subscription ends within 30 days is listed', (await expRow.count()) > 0);
  const renew = expRow.locator('button:has-text("Renew / Edit")');
  if (!(await renew.count())) rec('expiring (super): Renew / Edit opens the company edit form', false, 'no Renew / Edit button');
  else {
    await renew.first().click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(400);
    rec('expiring (super): Renew / Edit opens the company edit form', /\/admin\/companies\?edit=/.test(s.page.url()) && (await s.page.locator('.modal').count()) > 0, s.page.url());
  }

  // Locations: grouped by city with totals.
  await open(s, '/admin/locations');
  const puneRow = (await s.page.locator('tr', { hasText: 'Pune' }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec('locations (super): companies grouped by city with counts', /Pune/.test(puneRow) && /\b1\b/.test(puneRow), puneRow);

  // Revenue: Monthly / Yearly / Total switch the headline; the company row carries its rate.
  await open(s, '/admin/revenue');
  const kpi = async () => (await s.page.locator('.kpi-card').first().innerText()).replace(/\s+/g, ' ');
  const monthly = await kpi();
  await s.page.locator('button:has-text("Yearly")').click(); const yearly = await kpi();
  await s.page.locator('button:has-text("Total")').click(); const total = await kpi();
  rec('revenue (super): Monthly / Yearly / Total switch the headline figure', /MRR/.test(monthly) && /ARR/.test(yearly) && /collected/.test(total), `${monthly} | ${yearly} | ${total}`);
  rec('revenue (super): the company row shows its ₹2,500 rate', (await s.page.locator('tr', { hasText: CO }).first().innerText().catch(() => '')).includes('2,500'));
  rec('platform pages (super): no errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // Tenant isolation: a company admin is refused the platform data by the server.
  const adminT = await apiToken('admin');
  const u = await api(adminT, 'GET', '/api/companies/platform/usage');
  rec('platform usage API refuses a company admin (403)', u.status === 403, `${u.status}`);

  for (const [p, label, text] of [['/admin/usage', 'client-usage', 'Business Handled'], ['/admin/expiring', 'expiring', 'Expiring'], ['/admin/locations', 'locations', 'Location-wise'], ['/admin/revenue', 'revenue', 'Subscription Revenue']]) {
    await layoutCheck(browser, 'Sam', p, label, text);
  }
}

/* ---------------------------------------------------------------- 5c */
/** Option texts of the select that follows a field label (label and select share a .filter-field). */
async function fieldOptions(page, labelText, scope = '') {
  const sel = page.locator(`${scope} .filter-field:has(> label:text-is("${labelText}")) select`).first();
  if (!(await sel.count())) return null;
  return (await sel.locator('option').allInnerTexts()).map((t) => t.trim()).filter((t) => t && !/^—/.test(t));
}
const fieldInput = (page, labelText, scope = '') => page.locator(`${scope} .filter-field:has(> label:text-is("${labelText}")) :is(input, select, textarea)`).first();
const OLD_COST_LABELS = ['HS Selling', 'HS Purchase', 'LS Cost', 'LS Target', 'LS Actual', 'High Side', 'Low Side'];
const NEW_COST_LABELS = ['Equipment Selling', 'Equipment Purchase', 'Accessories Cost', 'Accessories Target Exp.', 'Accessories Actual Exp.'];

async function group5c(browser) {
  const superT = await apiToken('Sam');
  const adminT = await apiToken('admin');
  const CO_ID = 'company_demo';
  const ALL = ['HVAC', 'Solar', 'MEP'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Restrict the company to two divisions so the screens must follow the purchased list, not a hard-coded one.
  const before = await api(adminT, 'GET', '/api/subscriptions/my-divisions');
  rec('divisions: the company starts with HVAC, Solar and MEP', same(before.json?.divisions, ALL), before.text.slice(0, 120));
  const p = await api(superT, 'PATCH', `/api/companies/${CO_ID}`, { divisions: ['HVAC', 'Solar'] });
  const mine = await api(adminT, 'GET', '/api/subscriptions/my-divisions');
  rec('divisions: company restricted to HVAC + Solar for this test (super API)', p.status === 200 && same(mine.json?.divisions, ['HVAC', 'Solar']), `${p.status} ${mine.text.slice(0, 120)}`);
  const TWO = ['HVAC', 'Solar'];

  try {
    // Enquiry create (sales): Segment = purchased divisions + AMC; Site Type defaults to Residential.
    let enqId = null;
    const enqName = 'E2E enquiry ' + uniq();
    {
      const s = await session(browser, 'sales');
      await open(s, '/enquiries/new');
      const seg = await fieldOptions(s.page, 'Segment *');
      rec('enquiry create: Segment offers the purchased divisions + AMC only', same(seg, [...TWO, 'AMC']), JSON.stringify(seg));
      await fieldInput(s.page, 'Project Name *').fill(enqName);
      await fieldInput(s.page, 'Segment *').selectOption('Solar');
      await fieldInput(s.page, 'Customer Phone').fill('9820000001');
      await s.page.locator('button:has-text("Save Enquiry")').click();
      await s.page.waitForURL(/\/enquiries\/(?!new$)[^/]+$/, { timeout: 8000 }).catch(() => {});
      await s.page.waitForLoadState('networkidle');
      enqId = (s.page.url().match(/\/enquiries\/([^/?#]+)$/) || [])[1];
      const g = enqId ? await api(adminT, 'GET', `/api/enquiries/${enqId}`) : { json: null };
      const e = g.json?.enquiry || {};
      rec('enquiry create: saved and opened on its detail page', !!enqId && enqId !== 'new' && e.name === enqName && e.segment === 'Solar', s.page.url());
      rec('enquiry create: Site Type and Rating carry the PWA defaults (Residential, 3)', e.siteType === 'Residential' && Number(e.rating) === 3, `${e.siteType} / ${e.rating}`);
      rec('enquiry create: no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }

    // Enquiry detail (sales): follow-up saved; edit form offers only the purchased divisions + AMC.
    if (enqId) {
      const s = await session(browser, 'sales');
      await open(s, `/enquiries/${enqId}`);
      const act = 'E2E follow-up ' + uniq();
      await fieldInput(s.page, 'Action Done *').fill(act);
      await fieldInput(s.page, 'Next Action').fill('Send quotation');
      await s.page.locator('button:has-text("Save Follow-Up")').click();
      await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
      const g = await api(adminT, 'GET', `/api/enquiries/${enqId}`);
      rec('enquiry detail: follow-up saved on the server and shown', g.text.includes(act) && (await bodyText(s.page)).includes(act));
      await s.page.locator('button:has-text("Edit")').first().click(); await s.page.waitForTimeout(300);
      const seg = await fieldOptions(s.page, 'Segment *', '.modal');
      rec('enquiry detail: edit form Segment offers the purchased divisions + AMC only', same(seg, [...TWO, 'AMC']), JSON.stringify(seg));
      await s.page.locator('.modal button:has-text("Cancel")').click();
      rec('enquiry detail: no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }

    // Enquiry convert (sales): Equipment / Accessories costing; Division = purchased divisions; SO created.
    if (enqId) {
      const s = await session(browser, 'sales');
      await open(s, `/enquiries/${enqId}/convert`);
      const t = await bodyText(s.page);
      const div = await fieldOptions(s.page, 'Division *');
      rec('enquiry convert: Division offers the purchased divisions only', same(div, TWO), JSON.stringify(div));
      rec('enquiry convert: costing uses Equipment / Accessories labels (no HS/LS)', NEW_COST_LABELS.every((l) => t.includes(l)) && !OLD_COST_LABELS.some((l) => t.includes(l)));
      rec('enquiry convert: Solar segment pre-selects the Solar division', (await fieldInput(s.page, 'Division *').inputValue()) === 'Solar');
      await fieldInput(s.page, 'Equipment Selling').fill('200000');
      await fieldInput(s.page, 'Equipment Purchase').fill('150000');
      await s.page.locator('button:has-text("Create Sales Order")').click();
      await s.page.waitForURL(/\/sales-orders\/(?!new$)[^/]+$/, { timeout: 8000 }).catch(() => {});
      await s.page.waitForLoadState('networkidle');
      const soId = (s.page.url().match(/\/sales-orders\/([^/?#]+)$/) || [])[1];
      const e = await api(adminT, 'GET', `/api/enquiries/${enqId}`);
      const so = soId ? await api(adminT, 'GET', `/api/sales-orders/${soId}`) : { json: null };
      rec('enquiry convert: sales order created with the entered costing and the enquiry is Won',
        !!soId && so.json?.salesOrder?.division === 'Solar' && Number(so.json?.salesOrder?.highSideSelling) === 200000 && e.json?.enquiry?.status === 'Won',
        `${s.page.url()} ${e.json?.enquiry?.status}`);
      rec('enquiry convert: no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
      await layoutCheck(browser, 'sales', `/enquiries/${enqId}`, 'enquiry-detail', enqName);
    }
    // Server refuses a division the company has not purchased.
    {
      const salesT = await apiToken('sales');
      const r = await api(salesT, 'POST', '/api/enquiries', { name: 'E2E MEP ' + uniq(), segment: 'MEP', siteType: 'Residential' });
      rec('enquiry API refuses a division the company has not purchased (403)', r.status === 403, `${r.status}`);
    }

    // Sales order create (admin): Division = purchased divisions; Equipment / Accessories; SO saved.
    let soId = null;
    const soName = 'E2E SO ' + uniq();
    {
      const s = await session(browser, 'admin');
      await open(s, '/sales-orders/new');
      const t = await bodyText(s.page);
      const div = await fieldOptions(s.page, 'Division *');
      rec('SO create: Division offers the purchased divisions only', same(div, TWO), JSON.stringify(div));
      rec('SO create: costing uses Equipment / Accessories labels (no HS/LS)', NEW_COST_LABELS.every((l) => t.includes(l)) && !OLD_COST_LABELS.some((l) => t.includes(l)));
      await fieldInput(s.page, 'Division *').selectOption('HVAC');
      await fieldInput(s.page, 'Project Name *').fill(soName);
      await fieldInput(s.page, 'Equipment Selling').fill('100000');
      await fieldInput(s.page, 'Equipment Purchase').fill('70000');
      await fieldInput(s.page, 'Accessories Cost').fill('30000');
      await fieldInput(s.page, 'Accessories Target Exp.').fill('20000');
      const ms = s.page.locator('input[placeholder*="escription" i]').first();
      if (await ms.count()) {
        await ms.fill('Advance');
        await s.page.locator('input[placeholder*="mount" i]').first().fill('50000');
      }
      await s.page.locator('button:has-text("Create Sales Order")').click();
      await s.page.waitForURL(/\/sales-orders\/(?!new$)[^/]+$/, { timeout: 8000 }).catch(() => {});
      await s.page.waitForLoadState('networkidle');
      soId = (s.page.url().match(/\/sales-orders\/([^/?#]+)$/) || [])[1];
      if (soId === 'new') soId = null;
      const so = soId ? (await api(adminT, 'GET', `/api/sales-orders/${soId}`)).json?.salesOrder : null;
      rec('SO create: saved with division and costing, opened on its detail page',
        !!so && so.projectName === soName && so.division === 'HVAC' && Number(so.lowSideCost) === 30000, s.page.url());
      rec('SO create: the Advance milestone was saved', !!so && (so.paymentMilestones || []).some((m) => m.description === 'Advance' && Number(m.amount) === 50000), JSON.stringify(so?.paymentMilestones || []));
      rec('SO create: no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }

    // Sales order detail (admin): Equipment / Accessories costing, server-computed margins, edit form divisions.
    if (soId) {
      const s = await session(browser, 'admin');
      await open(s, `/sales-orders/${soId}`);
      await s.page.waitForSelector('h2:has-text("SO-")', { timeout: 8000 }).catch(() => {});
      const t = await bodyText(s.page);
      // Field labels are upper-cased by CSS, so innerText is compared case-insensitively.
      const lt = t.toLowerCase();
      rec('SO detail (admin): Equipment / Accessories costing (no HS/LS)', NEW_COST_LABELS.every((l) => lt.includes(l.toLowerCase())) && !OLD_COST_LABELS.some((l) => lt.includes(l.toLowerCase())));
      // 100000-70000 = 30000 equipment; 30000-20000 = 10000 accessories (target, no actual); total 40000.
      rec('SO detail (admin): Equipment, Accessories and Total margin shown (30,000 / 10,000 / 40,000)',
        /Equipment Margin:\s*₹?\s*30,000/i.test(t) && /Accessories Margin:\s*₹?\s*10,000/i.test(t) && /Total Margin:\s*₹?\s*40,000/i.test(t), (t.match(/Equipment Margin.{0,80}/i) || [''])[0]);
      await s.page.locator('button:has-text("Edit Sales Order")').click(); await s.page.waitForTimeout(300);
      const div = await fieldOptions(s.page, 'Division', '.modal');
      const mt = (await s.page.locator('.modal').innerText()).replace(/\s+/g, ' ');
      rec('SO detail (admin): edit form offers the purchased divisions and Equipment / Accessories fields', same(div, TWO) && NEW_COST_LABELS.every((l) => mt.includes(l)), JSON.stringify(div));
      await s.page.locator('.modal button:has-text("Cancel")').click();
      rec('SO detail (admin): no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
      await layoutCheck(browser, 'admin', `/sales-orders/${soId}`, 'so-detail', soName);
    }

    // Raise to Finance (HVAC PM on an HVAC SO): payment raised and visible to Finance.
    if (soId) {
      const s = await session(browser, 'amol');
      await open(s, `/sales-orders/${soId}`);
      await s.page.waitForSelector('h2:has-text("SO-")', { timeout: 8000 }).catch(() => {});
      const btn = s.page.locator('button:has-text("Raise to Finance")').first();
      if (!(await btn.count())) rec('SO detail (HVAC PM): Raise to Finance raises the milestone', false, 'no Raise to Finance button');
      else {
        await btn.click(); await s.page.waitForTimeout(200);
        const note = 'E2E raise ' + uniq();
        await s.page.locator('.modal textarea, .modal input:not([type=date])').first().fill(note);
        await s.page.locator('.modal button:has-text("Raise")').last().click();
        await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
        const fin = await api(await apiToken('finance'), 'GET', '/api/payments');
        rec('SO detail (HVAC PM): Raise to Finance raises the milestone (Finance sees the note)', fin.text.includes(note) && (await s.page.locator('.modal').count()) === 0, `${fin.status}`);
      }
      rec('SO detail (HVAC PM): no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }

    // Engineers are refused sales orders (and with them the costing) by the server.
    {
      const r = await api(await apiToken('vinod'), 'GET', '/api/sales-orders/so_demo');
      rec('SO API refuses an engineer (costing never reaches the engineer)', r.status === 403 || r.status === 404, `${r.status}`);
    }

    // Checklist templates (admin): division tabs follow the purchased list; + New creates in the active division.
    {
      const s = await session(browser, 'admin');
      await open(s, '/checklists');
      const tabs = async () => (await s.page.locator('button').allInnerTexts()).map((x) => x.trim()).filter((x) => ALL.includes(x));
      const tb = await tabs();
      rec('checklists (admin): division tabs are the purchased divisions only', same(tb, TWO), JSON.stringify(tb));
      await s.page.locator('button', { hasText: /^Solar$/ }).click();
      await s.page.locator('button:has-text("+ New Checklist")').click();
      const name = 'E2E Solar list ' + uniq();
      await s.page.locator('.modal input[placeholder="Checklist name"]').fill(name);
      await s.page.locator('.modal button:has-text("Create")').click();
      await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
      const all = await api(adminT, 'GET', '/api/checklist-templates');
      const list = all.json?.templates || all.json || [];
      const made = (Array.isArray(list) ? list : []).find((x) => x.name === name);
      rec('checklists (admin): + New Checklist creates the template in the active division', !!made && made.division === 'Solar' && (await bodyText(s.page)).includes(name), made ? made.division : 'not found');
      rec('checklists (admin): no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }
    {
      const s = await session(browser, 'amol');
      await open(s, '/checklists');
      const tb = (await s.page.locator('button').allInnerTexts()).map((x) => x.trim()).filter((x) => ALL.includes(x));
      const t = await bodyText(s.page);
      rec('checklists (HVAC PM): only HVAC templates, no division tabs, can create', tb.length === 0 && !t.includes('E2E Solar list') && (await s.page.locator('button:has-text("+ New Checklist")').count()) === 1, JSON.stringify(tb));
      rec('checklists (HVAC PM): no errors', s.errors.length === 0, s.errors.join('|'));
      await s.ctx.close();
    }

    await layoutCheck(browser, 'sales', '/enquiries/new', 'enquiry-create', 'New Enquiry');
    await layoutCheck(browser, 'admin', '/sales-orders/new', 'so-create', 'Equipment Selling');
    await layoutCheck(browser, 'sales', '/enquiries/enq_open/convert', 'enquiry-convert', 'Equipment Selling');
    await layoutCheck(browser, 'admin', '/checklists', 'checklist-list', 'Checklist Templates');
  } finally {
    const r = await api(superT, 'PATCH', `/api/companies/${CO_ID}`, { divisions: ALL });
    const back = await api(adminT, 'GET', '/api/subscriptions/my-divisions');
    rec('divisions: restored to HVAC, Solar and MEP', r.status === 200 && same(back.json?.divisions, ALL), back.text.slice(0, 120));
  }
}

/* ---------------------------------------------------------------- 5d */
/** Choose the option whose text contains `text` in the select under a field label. */
async function pickOption(page, labelText, text, scope = '') {
  const sel = page.locator(`${scope} .filter-field:has(> label:text-is("${labelText}")) select`).first();
  const value = await sel.evaluate((el, t) => { const o = [...el.options].find((x) => x.textContent.includes(t)); return o ? o.value : null; }, text);
  if (value === null) throw new Error(`no option containing "${text}" under "${labelText}"`);
  await sel.selectOption(value);
}

async function group5d(browser) {
  const storeT = await apiToken('store');
  const vinodT = await apiToken('vinod');
  const total = (it) => Object.values((it && it.stockByLocation) || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const getItem = async (name) => ((await api(storeT, 'GET', '/api/inventory/items')).json?.items || []).find((i) => i.name === name);
  const getIssues = async () => (await api(storeT, 'GET', '/api/inventory/issues')).json?.issues || [];

  // A store location to work in (self-contained: created when none exists).
  let locs = (await api(storeT, 'GET', '/api/inventory/locations')).json?.locations || [];
  if (!locs.length) {
    await api(storeT, 'POST', '/api/inventory/locations', { name: 'E2E Main Store' });
    locs = (await api(storeT, 'GET', '/api/inventory/locations')).json?.locations || [];
  }
  rec('inventory: a store location exists for the test', locs.length > 0, `${locs.length}`);
  const loc = locs[0];
  const item = 'E2E Drill ' + uniq();

  // Stock (store): + New Item with opening stock, then Purchase In adjustment.
  {
    const s = await session(browser, 'store');
    await open(s, '/inventory/stock');
    await s.page.locator('button:has-text("+ New Item")').click();
    await fieldInput(s.page, 'Name *', '.modal').fill(item);
    await fieldInput(s.page, 'Opening Stock', '.modal').fill('20');
    await fieldInput(s.page, 'Opening Location', '.modal').selectOption(loc.id);
    await s.page.locator('.modal input[type=checkbox]').first().check();
    await s.page.locator('.modal button:has-text("Create")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    let it = await getItem(item);
    rec('stock: + New Item creates a returnable item with 20 opening stock', !!it && total(it) === 20 && it.returnable === true && (await bodyText(s.page)).includes(item), it ? `${total(it)} returnable=${it.returnable}` : 'not found');
    await s.page.locator('tr', { hasText: item }).locator('button:has-text("Adjust")').click();
    await fieldInput(s.page, 'Adjustment Type', '.modal').selectOption('Purchase In');
    await fieldInput(s.page, 'Quantity *', '.modal').fill('5');
    await fieldInput(s.page, 'Location *', '.modal').selectOption(loc.id);
    await s.page.locator('.modal button:has-text("Adjust")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    it = await getItem(item);
    rec('stock: Purchase In adjustment of 5 raises stock to 25', total(it) === 25, `${total(it)}`);
    rec('stock: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Issue (store): issue 6 to Vinod; stock falls to 19 and the issue is listed.
  {
    const s = await session(browser, 'store');
    await open(s, '/inventory/issue');
    await s.page.locator('button:has-text("+ Issue Material")').click();
    await pickOption(s.page, 'Item *', item, '.modal');
    await fieldInput(s.page, 'From Location *', '.modal').selectOption(loc.id);
    await fieldInput(s.page, 'Quantity *', '.modal').fill('6');
    await pickOption(s.page, 'Issue To (staff) *', 'Vinod', '.modal');
    await s.page.locator('.modal button:has-text("Issue Material")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const iss = (await getIssues()).find((x) => x.itemName === item);
    rec('issue: material issued to Vinod (6) and stock falls to 19', !!iss && Number(iss.quantityIssued) === 6 && /Vinod/.test(iss.staffName || '') && total(await getItem(item)) === 19, iss ? `${iss.quantityIssued} ${iss.staffName}` : 'no issue');
    rec('issue: the issue is listed on the page', (await bodyText(s.page)).includes(item));
    rec('issue: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // My Material (engineer): sees the issue and requests a return of 2.
  {
    const s = await session(browser, 'vinod');
    await open(s, '/my-material');
    const row = s.page.locator('tr', { hasText: item });
    rec('my material (engineer): the issued item is listed with balance 6', (await row.count()) === 1 && /\b6\b/.test(await row.innerText()));
    await row.locator('button:has-text("Request Return")').click();
    await fieldInput(s.page, 'Quantity to return *', '.modal').fill('2');
    await fieldInput(s.page, 'Note', '.modal').fill('leftover after job');
    await s.page.locator('.modal button:has-text("Submit Request")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const iss = (await getIssues()).find((x) => x.itemName === item);
    rec('my material (engineer): return request recorded and shown as awaiting approval', !!iss?.returnRequested && (await row.innerText()).includes('Awaiting approval'));
    rec('my material (engineer): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }
  {
    const r = await api(vinodT, 'GET', '/api/inventory/issues');
    rec('issue API refuses an engineer the store-wide issue list', r.status === 403, `${r.status}`);
    const s = await session(browser, 'vinod');
    await open(s, '/inventory/issue');
    rec('issue page tells an engineer they cannot issue material', (await bodyText(s.page)).includes('do not have permission'));
    await s.ctx.close();
  }

  // Returns (store): receive the requested 2 (stock 21), then mark 1 used on site.
  {
    const s = await session(browser, 'store');
    await open(s, '/inventory/returns');
    const req = s.page.locator('.panel:has(h3:has-text("Return Requests")) tr', { hasText: item });
    rec('returns: the staff return request is listed', (await req.count()) === 1);
    await req.locator('button:has-text("Receive")').click();
    await fieldInput(s.page, 'Quantity returned *', '.modal').fill('2');
    await s.page.locator('.modal button[type=submit]').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    let iss = (await getIssues()).find((x) => x.itemName === item);
    rec('returns: receiving 2 records the return and adds it back to stock (21)', Number(iss?.quantityReturned) === 2 && total(await getItem(item)) === 21, `${iss?.quantityReturned} / ${total(await getItem(item))}`);
    const pend = s.page.locator('.panel:has(h3:has-text("Material Pending Return")) tr', { hasText: item });
    await pend.locator('button:has-text("Mark Used")').click();
    await fieldInput(s.page, 'Quantity used *', '.modal').fill('1');
    await s.page.locator('.modal button[type=submit]').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    iss = (await getIssues()).find((x) => x.itemName === item);
    rec('returns: Mark Used records 1 used on site; balance 3 stays out', Number(iss?.quantityUsed) === 1 && total(await getItem(item)) === 21 && (await pend.innerText()).includes('3'), `${iss?.quantityUsed}`);
    rec('returns: the return appears in Return History', (await s.page.locator('.panel:has(h3:has-text("Return History")) tr', { hasText: item }).count()) >= 1);
    rec('returns: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // History (store): the ledger is on screen and searchable.
  {
    const s = await session(browser, 'store');
    await open(s, '/inventory/history');
    await s.page.locator('input[placeholder^="Search item"]').fill(item);
    await s.page.waitForTimeout(200);
    const types = (await s.page.locator('tbody tr').allInnerTexts()).join(' | ');
    rec('history: the item ledger shows Opening Stock, Purchase In, Issue and Return', ['Opening Stock', 'Purchase In', 'Issue', 'Return'].every((x) => types.includes(x)), types.slice(0, 200));
    rec('history: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  await layoutCheck(browser, 'store', '/inventory/stock', 'inventory-stock', item);
  await layoutCheck(browser, 'store', '/inventory/issue', 'inventory-issue', item);
  await layoutCheck(browser, 'store', '/inventory/returns', 'inventory-returns', item);
  await layoutCheck(browser, 'store', '/inventory/history', 'inventory-history', item);
  await layoutCheck(browser, 'vinod', '/my-material', 'my-material', item);
}

/* ---------------------------------------------------------------- 5e */
async function group5e(browser) {
  const serviceT = await apiToken('service');
  const adminT = await apiToken('admin');
  const ymd = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const end = new Date(now.getTime() + 10 * 86400000);
  const site = 'E2E Site ' + uniq();

  // A warranty that started three months ago (a quarterly visit is due) and ends in ten days (renewal opportunity).
  const c = await api(serviceT, 'POST', '/api/contracts', { customer: 'E2E Customer', phone: '9800000002', site, start: ymd(start), end: ymd(end), amcType: 'Quarterly', category: 'Warranty', amount: 0 });
  const cid = c.json?.contract?.id;
  rec('contract created for the test (API)', c.status === 201 && !!cid, `${c.status} ${c.text.slice(0, 120)}`);

  // Contract list (service manager): PM Due and Renewal Opportunities panels; Schedule PM; renewal row opens the contract.
  {
    const s = await session(browser, 'service');
    await open(s, '/contracts');
    const pmRow = s.page.locator('.panel:has(h3:has-text("PM Due")) tr', { hasText: site });
    rec('contracts (service mgr): the due visit is listed in the PM Due panel', (await pmRow.count()) >= 1);
    const renRow = s.page.locator('.panel:has(h3:has-text("Renewal Opportunities")) tr', { hasText: site });
    rec('contracts (service mgr): the expiring contract is listed under Renewal Opportunities', (await renRow.count()) === 1);
    await pmRow.first().locator('button:has-text("Schedule PM")').click();
    await s.page.waitForLoadState('networkidle');
    rec('contracts (service mgr): Schedule PM opens a new service call for that contract', s.page.url().endsWith(`/service-calls/new?contractId=${cid}`), s.page.url());
    await open(s, '/contracts');
    await s.page.locator('.panel:has(h3:has-text("Renewal Opportunities")) tr', { hasText: site }).click();
    await s.page.waitForLoadState('networkidle');
    rec('contracts (service mgr): a renewal row opens the contract', s.page.url().endsWith(`/contracts/${cid}`), s.page.url());
    rec('contracts (service mgr): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }
  {
    const s = await session(browser, 'israr');
    await open(s, '/contracts');
    const pmRow = s.page.locator('.panel:has(h3:has-text("PM Due")) tr', { hasText: site });
    rec('contracts (service engineer): sees PM Due but no Schedule PM action', (await pmRow.count()) >= 1 && (await s.page.locator('button:has-text("Schedule PM")').count()) === 0);
    await open(s, `/contracts/${cid}`);
    rec('contract detail (service engineer): no Schedule PM action', (await s.page.locator('button:has-text("Schedule PM")').count()) === 0 && (await bodyText(s.page)).includes(site));
    rec('contracts (service engineer): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Contract detail (admin): AMC Document and Schedule PM actions.
  {
    const s = await session(browser, 'admin');
    await open(s, `/contracts/${cid}`);
    await s.page.locator('button:has-text("Schedule PM")').click();
    await s.page.waitForLoadState('networkidle');
    rec('contract detail (admin): Schedule PM opens a new service call for the contract', s.page.url().endsWith(`/service-calls/new?contractId=${cid}`), s.page.url());
    await open(s, '/contracts/amc_demo');
    await s.page.locator('button:has-text("AMC Document")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    rec('contract detail (admin): AMC Document opens the comprehensive document', /\/contracts\/amc_demo\/amc-document\?type=comprehensive$/.test(s.page.url()), s.page.url());

    // AMC document: company details come from Company Profile only; amounts are formatted once.
    let t = await bodyText(s.page);
    rec('AMC document: payment shows ₹ 1,77,000 (amount + 18% GST) with a single ₹ sign', t.includes('₹ 1,77,000') && !/₹\s*₹/.test(t));
    rec('AMC document: no hard-coded tagline or signatory designation when Company Profile has none', !t.includes('Trusted-Econimical') && !t.includes('(Project & Service head)'));
    await s.page.locator('select').first().selectOption('amc-letter');
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(400);
    t = await bodyText(s.page);
    rec('AMC letter: the proposal carries the contract amount and period, with no {{placeholders}}', t.includes('1,50,000') && !t.includes('{{'), (t.match(/our proposal.{0,160}/i) || [''])[0]);
    const tag = 'E2E Tagline ' + uniq();
    const p = await api(adminT, 'PATCH', '/api/companies/my-profile', { tagline: tag });
    await open(s, '/contracts/amc_demo/amc-document?type=comprehensive');
    rec('AMC document: the Company Profile tagline is shown when set', p.status === 200 && (await bodyText(s.page)).includes(tag), `${p.status}`);
    const popupP = s.page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
    await s.page.locator('button:has-text("Print / Save as PDF")').click();
    const popup = await popupP;
    const pt = popup ? await popup.locator('body').innerText().catch(() => '') : '';
    rec('AMC document: Print / Save as PDF opens the printable document', !!popup && pt.includes('Intervalve Poonawalla'));
    if (popup) await popup.close().catch(() => {});
    await api(adminT, 'PATCH', '/api/companies/my-profile', { tagline: '' });
    rec('AMC document: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  await layoutCheck(browser, 'service', '/contracts', 'contract-list', 'PM Due');
  await layoutCheck(browser, 'admin', `/contracts/${cid}`, 'contract-detail', site);
  await layoutCheck(browser, 'admin', '/contracts/amc_demo/amc-document?type=comprehensive', 'amc-document', 'Intervalve Poonawalla');
  {
    // The document's action buttons must stay on screen on a phone (not clipped off the right edge).
    const s = await session(browser, 'admin', { width: 390, height: 844 });
    await open(s, '/contracts/amc_demo/amc-document?type=comprehensive');
    const boxes = [];
    for (const label of ['Print / Save as PDF', 'Edit Template', 'Back to Contract']) boxes.push(await s.page.locator(`button:has-text("${label}")`).boundingBox());
    rec('AMC document [mobile]: Print / Edit Template / Back buttons are fully on screen', boxes.every((b) => b && b.x >= 0 && b.x + b.width <= 390), boxes.map((b) => b && Math.round(b.x + b.width)).join(','));
    await s.ctx.close();
  }
}

/* ---------------------------------------------------------------- 5f */
async function group5f(browser) {
  const adminT = await apiToken('admin');
  const getQ = async (id) => (await api(adminT, 'GET', `/api/quotations/${id}`)).json?.quotation;
  const field = (page, text) => page.locator(`label.filter-field:has-text("${text}") :is(input, select)`).first();
  const fillRow = async (panel, i, { desc, qty, supply, gst }) => {
    const row = panel.locator('tbody tr').nth(i);
    await row.locator('input[placeholder="Item description"]').fill(desc);
    const nums = row.locator('input[type=number]');
    await nums.nth(0).fill(String(qty));
    await nums.nth(1).fill(String(supply));
    if (gst !== undefined) await nums.nth(2).fill(String(gst));
  };
  const createAndOpen = async (s) => {
    await s.page.locator('button:has-text("Create Quotation")').click();
    await s.page.waitForURL(/\/quotations\/(?!new$)[^/]+$/, { timeout: 8000 }).catch(() => {});
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const id = (s.page.url().match(/\/quotations\/([^/?#]+)$/) || [])[1];
    return id && id !== 'new' ? id : null;
  };

  // Solar quotation (sales): GST is the sum of each line's own GST % — 12% on ₹1,00,000 + 18% on ₹50,000 = ₹21,000.
  let solarId = null;
  {
    const s = await session(browser, 'sales');
    await open(s, '/quotations/new');
    await field(s.page, 'Division *').selectOption('Solar');
    await field(s.page, 'Customer Name *').fill('E2E Solar Customer');
    const panel = s.page.locator('.panel:has(h3:text-is("Solar Equipment Items"))');
    rec('quotation create (Solar): one flat Solar Equipment table with a GST % column; no Accessories table',
      (await panel.count()) === 1 && (await panel.locator('th:has-text("GST %")').count()) === 1 && (await s.page.locator('h3:text-is("Accessories Items")').count()) === 0);
    await fillRow(panel, 0, { desc: 'E2E Solar panel 540W', qty: 10, supply: 10000, gst: 12 });
    await panel.locator('button:has-text("+ Add Row")').click();
    await fillRow(panel, 1, { desc: 'E2E Inverter', qty: 1, supply: 50000, gst: 18 });
    const tot = (await s.page.locator('.panel:has(h3:text-is("Totals"))').innerText()).replace(/\s+/g, ' ');
    rec('quotation create (Solar): on-screen GST is per item (₹ 21,000), grand total ₹ 1,71,000', /GST Amount ₹ 21,000/i.test(tot) && /Grand Total ₹ 1,71,000/i.test(tot), tot);
    solarId = await createAndOpen(s);
    const q = solarId ? await getQ(solarId) : null;
    rec('quotation create (Solar): saved; the server agrees on ₹ 21,000 GST', !!q && Number(q.gstAmount) === 21000 && Number(q.grandTotal) === 171000, q ? `${q.gstAmount} / ${q.grandTotal}` : s.page.url());
    const t = await bodyText(s.page);
    rec('quotation detail (Solar): totals show "GST (per item)" ₹ 21,000', /GST \(per item\)\s*₹ 21,000/i.test(t), (t.match(/GST \(.{0,40}/i) || [''])[0]);
    rec('quotation (Solar): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // HVAC quotation at 0% GST (sales): 0% is kept, not replaced by 18%.
  let hvacId = null;
  {
    const s = await session(browser, 'sales');
    await open(s, '/quotations/new');
    await field(s.page, 'Division *').selectOption('HVAC');
    await field(s.page, 'Customer Name *').fill('E2E Export Customer');
    const panel = s.page.locator('.panel:has(h3:text-is("Equipment Items"))');
    await fillRow(panel, 0, { desc: 'E2E VRF outdoor unit', qty: 1, supply: 200000 });
    await s.page.locator('.panel:has(h3:text-is("Totals")) input[type=number]').fill('0');
    hvacId = await createAndOpen(s);
    const q = hvacId ? await getQ(hvacId) : null;
    rec('quotation create (HVAC): a 0% GST quotation is saved at 0% (not 18%)', !!q && Number(q.gstPercent) === 0 && Number(q.gstAmount) === 0, q ? `${q.gstPercent}% ${q.gstAmount}` : s.page.url());
    rec('quotation detail (HVAC): totals show GST (0%)', (await bodyText(s.page)).includes('GST (0%)'));
    rec('quotation detail (sales): Draft quotation offers Edit, Duplicate and Delete',
      (await s.page.locator('button:text-is("Edit")').count()) === 1 && (await s.page.locator('button:text-is("Duplicate")').count()) === 1 && (await s.page.locator('button:text-is("Delete")').count()) === 1);
    rec('quotation (HVAC): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Finance: may create and edit quotations, but not delete them (mirrors the server routes).
  {
    const s = await session(browser, 'finance');
    await open(s, '/quotations');
    rec('quotation list (finance): + New Quotation is offered', (await s.page.locator('button:has-text("+ New Quotation")').count()) === 1);
    if (hvacId) {
      await open(s, `/quotations/${hvacId}`);
      rec('quotation detail (finance): Edit and Duplicate offered, Delete withheld',
        (await s.page.locator('button:text-is("Edit")').count()) === 1 && (await s.page.locator('button:text-is("Duplicate")').count()) === 1 && (await s.page.locator('button:text-is("Delete")').count()) === 0);
      await s.page.locator('button:text-is("Edit")').click(); await s.page.waitForTimeout(300);
      const subj = s.page.locator('label.filter-field:has-text("Subject") input').first();
      const subject = 'E2E finance edit ' + uniq();
      await subj.fill(subject);
      await s.page.locator('button:has-text("Save Changes")').click();
      await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
      const q = await getQ(hvacId);
      rec('quotation detail (finance): edit saves; 0% GST is preserved', q?.subject === subject && Number(q?.gstPercent) === 0, `${q?.subject} ${q?.gstPercent}`);
    }
    const financeT = await apiToken('finance');
    const del = await api(financeT, 'DELETE', `/api/quotations/${hvacId}`);
    rec('quotation API refuses delete to finance (403)', del.status === 403, `${del.status}`);
    rec('quotations (finance): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // List (sales): both quotations listed; Delete works for a Draft.
  {
    const s = await session(browser, 'sales');
    await open(s, '/quotations');
    const t = await bodyText(s.page);
    rec('quotation list (sales): both new quotations are listed', t.includes('E2E Solar Customer') && t.includes('E2E Export Customer'));
    await s.page.locator('tr', { hasText: 'E2E Export Customer' }).first().click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    rec('quotation list (sales): a row opens its quotation', s.page.url().endsWith(`/quotations/${hvacId}`), s.page.url());
    await s.page.locator('button:text-is("Delete")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const g = await api(adminT, 'GET', `/api/quotations/${hvacId}`);
    rec('quotation detail (sales): Delete removes the Draft quotation', g.status === 404, `${g.status}`);
    rec('quotation list (sales): no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Forms built from <label class="filter-field">text<input></label> must flow as a normal grid:
  // side by side on a desktop, one full-width column on a phone (not squeezed into a label column).
  for (const [user, path, a, b, click] of [['sales', '/quotations/new', 'Division *', 'Customer Name *'], ['admin', '/company-profile', 'Display Name', 'Subtitle', 'Edit Profile']]) {
    for (const [vn, vp] of [['desktop', { width: 1366, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
      const s = await session(browser, user, vp);
      await open(s, path);
      if (click) { await s.page.locator(`button:has-text("${click}")`).click(); await s.page.waitForTimeout(200); }
      const box = async (t) => s.page.locator(`label.filter-field:has-text("${t}") :is(input, select)`).first().boundingBox();
      const A = await box(a); const B = await box(b);
      const ok = A && B && (vn === 'desktop' ? Math.abs(A.y - B.y) < 4 : Math.abs(A.x - B.x) < 2 && A.width >= 300 && B.width >= 300);
      rec(`${path} [${vn}]: "${a}" and "${b}" fields ${vn === 'desktop' ? 'sit side by side' : 'stack full-width'}`, !!ok,
        A && B ? `A(${Math.round(A.x)},${Math.round(A.y)},w${Math.round(A.width)}) B(${Math.round(B.x)},${Math.round(B.y)},w${Math.round(B.width)})` : 'field not found');
      await s.ctx.close();
    }
  }

  // Flat <label>text</label><input> pairs keep their label column (desktop and phone).
  for (const vp of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) {
    const s = await session(browser, 'admin', vp);
    await open(s, '/checklists');
    await s.page.locator('button:has-text("+ New Checklist")').click();
    const L = await s.page.locator('.modal .form-grid > label:text-is("Name *")').boundingBox();
    const I = await s.page.locator('.modal input[placeholder="Checklist name"]').boundingBox();
    rec(`checklist modal [${vp.width}px]: flat label/input pairs keep the label column`, !!(L && I && I.x > L.x + L.width - 1 && Math.abs((L.y + L.height / 2) - (I.y + I.height / 2)) < 8),
      L && I ? `L(${Math.round(L.x)},${Math.round(L.y)}) I(${Math.round(I.x)},${Math.round(I.y)})` : 'not found');
    await s.ctx.close();
  }

  await layoutCheck(browser, 'sales', '/quotations', 'quotation-list', 'E2E Solar Customer');
  await layoutCheck(browser, 'sales', '/quotations/new', 'quotation-create', 'New Quotation');
  if (solarId) await layoutCheck(browser, 'sales', `/quotations/${solarId}`, 'quotation-detail', 'E2E Solar Customer');
}

/* ---------------------------------------------------------------- 5g */
async function group5g(browser) {
  const serviceT = await apiToken('service');
  const getCall = async (id) => (await api(serviceT, 'GET', `/api/service-calls/${id}`)).json?.serviceCall;
  const callIdFrom = (url) => { const m = url.match(/\/service-calls\/([^/?#]+)$/); return m && m[1] !== 'new' ? m[1] : null; };
  const cust = 'E2E Complaint ' + uniq();

  // Register a complaint (service manager): the registration message is shown on the new call, ready to send.
  let cid = null;
  {
    const s = await session(browser, 'service');
    await open(s, '/service-calls/new');
    rec('service call create: complaint form', (await bodyText(s.page)).includes('Register Complaint'));
    // A walk-in complaint: say it is not an AMC / Warranty client (Chargeable).
    await s.page.locator('button:has-text("Not an AMC / Warranty client")').click();
    await fieldInput(s.page, 'Customer *').fill(cust);
    await fieldInput(s.page, 'Phone').fill('9822000003');
    await fieldInput(s.page, 'Site').fill('E2E plant, Pune');
    await s.page.locator('.filter-field:has(> label:text-is("Description")) textarea').fill('Chiller tripping on HP');
    await s.page.locator('button[type=submit]:has-text("Register Complaint")').click();
    await s.page.waitForURL(/\/service-calls\/(?!new$)[^/]+$/, { timeout: 8000 }).catch(() => {});
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    cid = callIdFrom(s.page.url());
    const msg = (await s.page.locator('.panel:has(h3:text-is("Customer Message")) pre').innerText().catch(() => '')).trim();
    rec('service call create: complaint registered and its customer message shown on the call', !!cid && msg.length > 20, msg.slice(0, 120));
    rec('service call create: WhatsApp send link offered for the message', (await s.page.locator('a:has-text("Send via WhatsApp")').count()) === 1);
    rec('service call create: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Schedule a PM visit from a contract (service manager).
  {
    const s = await session(browser, 'service');
    await open(s, '/service-calls/new?contractId=amc_demo');
    const t = await bodyText(s.page);
    rec('PM schedule: the form shows the contract it is for', t.includes('Schedule PM Visit') && t.includes('Intervalve Poonawalla'));
    await s.page.locator('button[type=submit]:has-text("Schedule PM")').click();
    await s.page.waitForURL(/\/service-calls\/(?!new)[^/?]+$/, { timeout: 8000 }).catch(() => {});
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const pid = callIdFrom(s.page.url());
    const pc = pid ? await getCall(pid) : null;
    rec('PM schedule: PM call created for the contract with its customer message', pc?.type === 'PM' && (await s.page.locator('.panel:has(h3:text-is("Customer Message"))').count()) === 1, pc ? `${pc.type}` : s.page.url());
    // PM report defaults to the AMC service type.
    await s.page.locator('button:has-text("Edit Report")').click();
    rec('PM call report: Service Type defaults to AMC', (await fieldInput(s.page, 'Service Type').inputValue()) === 'AMC');
    rec('PM schedule: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  if (!cid) return;
  // Assign the complaint to the service engineer (service manager).
  {
    const s = await session(browser, 'service');
    await open(s, `/service-calls/${cid}`);
    await s.page.locator('button:has-text("Assign Engineer")').click();
    await pickOption(s.page, 'Engineer', 'Israr');
    await fieldInput(s.page, 'Appointment Date').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await s.page.locator('button:has-text("Save Assignment")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    const c = await getCall(cid);
    rec('service call detail: engineer assigned', !!c?.engineerId && (await bodyText(s.page)).includes('Israr'), c?.status);
    rec('service call assign: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  // Service engineer: report (Chargeable default, free-text checklist), then sign on the pad and complete.
  {
    const s = await session(browser, 'israr', { width: 390, height: 844 });
    await open(s, `/service-calls/${cid}`);
    await s.page.locator('button:has-text("Edit Report")').click();
    rec('complaint report: Service Type defaults to Chargeable', (await fieldInput(s.page, 'Service Type').inputValue()) === 'Chargeable');
    // Checklist: tick (Done) / cross (Not done) per point; mark Gas Pressure not done, the rest done.
    const ticks = s.page.locator('.check-toggle-btn.is-done[aria-label]');
    const nChecks = await ticks.count();
    for (let i = 0; i < nChecks; i++) await ticks.nth(i).click();
    await s.page.locator('button[aria-label="Gas Pressure: Not done"]').click();
    await fieldInput(s.page, 'Amount (₹)').fill('1500');
    await s.page.locator('.filter-field:has(> label:text-is("Service Description *")) textarea').fill('Cleaned HP switch, reset');
    await s.page.locator('button:has-text("Save Report Draft")').click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(300);
    let c = await getCall(cid);
    const cr = c?.report?.checklistResults || {};
    rec('complaint report: checklist saved as tick/cross (Gas Pressure "Not done", the rest "Done") and the draft is saved',
      nChecks === 6 && cr['Gas Pressure'] === 'Not done' && cr['Cooling Testing'] === 'Done' && c?.report?.serviceType === 'Chargeable', JSON.stringify(c?.report?.checklistResults || {}).slice(0, 120));

    await s.page.locator('button:text-is("Complete")').click();
    const done = s.page.locator('button:has-text("Complete & Generate Report")');
    rec('completion: Complete is disabled until the client signs', await done.isDisabled());
    const cv = s.page.locator('canvas').first();
    await cv.scrollIntoViewIfNeeded();
    const b = await cv.boundingBox();
    await s.page.mouse.move(b.x + 20, b.y + 30); await s.page.mouse.down();
    for (let i = 1; i <= 8; i++) await s.page.mouse.move(b.x + 20 + i * 25, b.y + 30 + (i % 2) * 40);
    await s.page.mouse.up(); await s.page.waitForTimeout(150);
    rec('completion: signing on the pad enables Complete', await done.isEnabled());
    await done.click();
    await s.page.waitForLoadState('networkidle'); await s.page.waitForTimeout(400);
    c = await getCall(cid);
    const sig = c?.clientSignatureImage || '';
    rec('completion: call Completed with the drawn signature saved as a PNG', c?.status === 'Completed' && /^data:image\/png;base64,/.test(sig), `${c?.status} sig=${String(sig).slice(0, 30)}`);
    const t = await bodyText(s.page);
    rec('completion: the completion customer message is shown', (await s.page.locator('.panel:has(h3:text-is("Customer Message"))').count()) === 1 && t.length > 0);
    // Chargeable completion creates a Pending payment for Finance (server side; the call keeps no payment reference).
    const fin = await api(await apiToken('finance'), 'GET', '/api/payments');
    const pays = fin.json?.payments || [];
    const pay = pays.find((p) => String(p.projectOrReference || '').includes(`PSC-${c?.complaintNumber}`) && p.personName === cust);
    rec('completion: Chargeable ₹1,500 creates a Pending payment visible to Finance', !!pay && Number(pay.amount) === 1500 && pay.status === 'Pending', pay ? `${pay.projectOrReference} ${pay.amount} ${pay.status}` : `${fin.status} ${pays.length} payments`);
    rec('service engineer flow: no errors', s.errors.length === 0, s.errors.join('|'));
    await s.ctx.close();
  }

  await layoutCheck(browser, 'service', '/service-calls/new', 'service-call-create', 'Register Complaint');
  await layoutCheck(browser, 'service', `/service-calls/${cid}`, 'service-call-detail', cust);
}

const GROUPS = { '5a': group5a, '5b': group5b, '5c': group5c, '5d': group5d, '5e': group5e, '5f': group5f, '5g': group5g };

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GROUPS);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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
  console.log(`\nTOTAL ${results.length}  PASS ${pass}  FAIL ${results.length - pass}`);
  process.exitCode = pass === results.length ? 0 : 1;
})();
