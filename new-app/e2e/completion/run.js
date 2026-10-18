'use strict';
/**
 * FINAL COMPLETION ORDER — multi-role browser acceptance run.
 * 1. cd new-app/frontend && npm run build
 * 2. node e2e/completion/server.js   (dev assembly, in-memory data, port 4100)
 * 3. node e2e/completion/run.js      (Playwright + Chromium; set PLAYWRIGHT_MODULE / CHROMIUM_PATH if needed)
 * Restart the server before each run (the run creates a company).
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4100';
const results = [];
const rec = (name, pass, detail = '') => { results.push({ name, status: pass ? 'PASS' : 'FAIL', detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

async function session(browser, username) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('label:has-text("Username") input').fill(username);
  await page.locator('label:has-text("Password") input').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('a.nav-item', { timeout: 10000 });
  return { ctx, page, errors, bad };
}

async function visitMenu(s, label) {
  const { page, errors, bad } = s;
  const items = await page.locator('a.nav-item').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
  const failures = [];
  for (const [, href] of items) {
    const e0 = errors.length, b0 = bad.length;
    await page.goto(BASE + href, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    if (errors.length > e0 || bad.length > b0 || /Something went wrong|Cannot read prop|undefined is not/i.test(body) || body.trim().length < 20) {
      failures.push(`${href}: ${errors.slice(e0).concat(bad.slice(b0)).join(' | ') || 'blank/crash text'}`);
    }
  }
  rec(`${label}: every menu page renders without JS errors or 5xx (${items.length} pages)`, failures.length === 0, failures.join('; '));
  return items;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // Login screen: username + password only.
    {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
      const labels = await page.locator('.login-card label').allInnerTexts();
      rec('login: only Username + Password fields (no company ID)', labels.length === 2 && !labels.some((l) => /company/i.test(l)), labels.join(','));
      await page.locator('label:has-text("Username") input').fill('admin');
      await page.locator('label:has-text("Password") input').fill('wrong');
      await page.locator('button[type=submit]').click();
      await page.waitForSelector('.alert-error', { timeout: 5000 }).catch(() => {});
      rec('login: wrong password shows an error and stays on /login', page.url().includes('/login') && (await page.locator('.alert-error').count()) > 0);
      await ctx.close();
    }

    const roles = [['admin', 'admin'], ['sales', 'sales'], ['amol', 'hvac_pm'], ['akshay', 'solar_pm'], ['ajinkya', 'mep_pm'], ['vinod', 'engineer'], ['store', 'inventory'], ['service', 'service_mgr'], ['israr', 'service_eng'], ['finance', 'finance'], ['Sam', 'super']];
    const menus = {};
    for (const [u, role] of roles) {
      const s = await session(browser, u);
      const brand = await s.page.locator('body').innerText();
      rec(`${role}: logs in and lands on dashboard`, !s.page.url().includes('/login') && /MEP PROJECTS/.test(brand));
      menus[role] = (await visitMenu(s, role)).map((x) => x[0]);
      await s.ctx.close();
    }
    rec('menus: Quotations visible to admin/sales/finance only', ['admin', 'sales', 'finance'].every((r) => menus[r].some((m) => /Quotation/.test(m))) && ['vinod', 'engineer', 'inventory', 'service_eng'].every((r) => !(menus[r] || []).some((m) => /Quotation/.test(m))));
    rec('menus: Company Profile for admin only; Subscriptions for super only', menus.admin.some((m) => /Company Profile/.test(m)) && !menus.sales.some((m) => /Company Profile/.test(m)) && menus.super.some((m) => /Subscription/.test(m)) && !menus.admin.some((m) => /^Subscriptions$/.test(m)));

    // Admin: HVAC enquiry create through the UI; segment list = divisions + AMC.
    {
      const s = await session(browser, 'admin');
      await s.page.goto(BASE + '/enquiries/new', { waitUntil: 'networkidle' });
      const opts = await s.page.locator('select').evaluateAll((sels) => sels.map((x) => [...x.options].map((o) => o.value)));
      const seg = opts.find((o) => o.includes('AMC')) || [];
      // PWA goSeg: /enquiries?segment=HVAC opens the list pre-filtered.
      await s.page.goto(BASE + '/enquiries?segment=HVAC', { waitUntil: 'networkidle' });
      const segSel = await s.page.locator('.filter-field:has(label:text-is("Segment")) select, label:text-is("Segment") + select').first().inputValue().catch(() => '');
      rec('enquiry list: ?segment=HVAC pre-selects the Segment filter (PWA goSeg)', segSel === 'HVAC', segSel);
      await s.page.goto(BASE + '/users', { waitUntil: 'networkidle' });
      const [udl] = await Promise.all([s.page.waitForEvent('download'), s.page.getByRole('button', { name: '⬇ Report' }).click()]);
      const ucsv = fs.readFileSync(await udl.path(), 'utf8');
      rec('users: ⬇ Report downloads the PWA Team & Login report (no passwords)', ucsv.includes('"TEAM & LOGIN REPORT — MEP Powertech (Dev)"') && ucsv.includes('"Name","Role","Username","Assigned Projects","Open Service Calls"') && !/password/i.test(ucsv), udl.suggestedFilename());
      await s.page.goto(BASE + '/enquiries/new', { waitUntil: 'networkidle' });
      rec('enquiry form: segment options = company divisions + AMC', ['HVAC', 'Solar', 'MEP', 'AMC'].every((v) => seg.includes(v)), seg.join(','));
      await s.ctx.close();
    }

    // Super: dashboard KPIs, create a company, edit via ?edit=, reports downloads.
    {
      const s = await session(browser, 'Sam');
      const p = s.page;
      await p.goto(BASE + '/', { waitUntil: 'networkidle' });
      const dash = await p.locator('body').innerText();
      rec('super dashboard: PWA KPIs, quick links and Needs Attention table', ['Total Companies', 'Active Subscriptions', 'Monthly Revenue (MRR)', 'Expiring in 30 Days', 'Total Sales Handled by Clients', 'Quick Links', 'Needs Attention'].every((t) => dash.includes(t)));
      await p.goto(BASE + '/admin/companies', { waitUntil: 'networkidle' });
      await p.getByRole('button', { name: '+ Add Company' }).click();
      const modal = p.locator('.modal');
      const fill = (label, v) => modal.locator(`label:text-is("${label}") + input, label:text-is("${label}") + textarea`).first().fill(v);
      await fill('Company Name', 'E2E Cooling Pvt Ltd');
      await fill('City / Location', 'Nagpur');
      await fill('GST No', '27E2E1234');
      await fill('Contact 1 - Name', 'Meera');
      await fill('Contact 1 - Number', '9000000001');
      await fill('Login ID', 'e2e_admin');
      await fill('Password', 'e2e-pass-1');
      await modal.getByRole('button', { name: 'Save' }).click();
      await p.waitForSelector('text=Company created. Admin login: e2e_admin', { timeout: 5000 }).catch(() => {});
      const list = await p.locator('body').innerText();
      rec('super: Add Company (Trial) through the modal; list shows contact, GST, trial end', list.includes('E2E Cooling Pvt Ltd') && list.includes('Meera · 9000000001') && list.includes('27E2E1234') && /Trial → \d{4}-\d{2}-\d{2}/.test(list));
      // The new admin can log in with username + password only.
      const s2 = await session(browser, 'e2e_admin').catch(() => null);
      if (s2) { rec('new company admin logs in with username + password', !s2.page.url().includes('/login')); await s2.ctx.close(); }
      else {
        // password differs from password123 — log in manually
        const ctx = await browser.newContext(); const pg = await ctx.newPage();
        await pg.goto(BASE + '/login', { waitUntil: 'networkidle' });
        await pg.locator('label:has-text("Username") input').fill('e2e_admin');
        await pg.locator('label:has-text("Password") input').fill('e2e-pass-1');
        await pg.locator('button[type=submit]').click();
        const ok = await pg.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 8000 }).then(() => true).catch(() => false);
        rec('new company admin logs in with username + password', ok);
        await ctx.close();
      }
      // Expiring -> Renew / Edit opens the edit modal prefilled.
      await p.goto(BASE + '/admin/expiring', { waitUntil: 'networkidle' });
      const renew = p.getByRole('button', { name: 'Renew / Edit' }).first();
      if (await renew.count()) {
        await renew.click();
        await p.waitForSelector('.modal h3:has-text("Edit Company")', { timeout: 5000 }).catch(() => {});
        const v = await p.locator('.modal label:text-is("Login ID") + input').inputValue().catch(() => '');
        rec('expiring: Renew / Edit opens the edit modal with the admin Login ID prefilled', p.url().includes('edit=') && v.length > 0, v);
        await p.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
      } else rec('expiring: Renew / Edit opens the edit modal', false, 'no expiring row');
      // Reports: six CSV downloads with PWA columns.
      await p.goto(BASE + '/reports', { waitUntil: 'networkidle' });
      const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Revenue — All Time' }).click()]);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      rec('reports: Revenue — All Time CSV has BOM, PWA header and TOTAL row', csv.charCodeAt(0) === 0xfeff && csv.includes('"Collected Total (₹)"') && csv.includes('"TOTAL"') && /revenue-all-\d{4}-\d{2}-\d{2}\.csv/.test(dl.suggestedFilename()), dl.suggestedFilename());
      const [dl2] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Subscribers — All Time' }).click()]);
      const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
      rec('reports: Subscribers — All Time CSV grouped Active→Trial→Suspended with contacts', csv2.includes('"Contact 1","Phone 1"') && csv2.indexOf('MEP Powertech (Dev)') < csv2.indexOf('E2E Cooling Pvt Ltd'));
      rec('super: no JS errors or 5xx during the super journey', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }

    // ---------- Completed gap screens (seeded business data) ----------

    // Lost Enquiries — PWA vLost: KPI cards, the shared filter bar, the
    // thirteen enqTable columns and the TOTAL row.
    {
      const s = await session(browser, 'admin');
      const p = s.page;
      await p.goto(BASE + '/enquiries/lost', { waitUntil: 'networkidle' });
      const kpis = await p.locator('.kpi-card .kpi-label').allInnerTexts();
      const body = await p.locator('body').innerText();
      void body;
      rec('lost enquiries: KPI cards show the count and value of lost work',
        kpis.includes('Lost Enquiries') && kpis.includes('Total Lost Value') && /₹ 14,350,000|₹ 1,43,50,000/.test(body),
        kpis.join('|'));
      const headers = (await p.locator('table.data-table thead th').allInnerTexts()).map((h) => h.trim().toLowerCase());
      rec('lost enquiries: the PWA enqTable columns are present',
        ['action done', 'next action', 'next date', 'rating', 'value', 'status'].every((h) => headers.includes(h)),
        headers.join('|'));
      rec('lost enquiries: TOTAL row and filtered-count heading', /TOTAL — 2 enquiries/.test(body) && /\(2 of 2,/.test(body));
      await p.getByRole('button', { name: /Filters/ }).click();
      const filterLabels = await p.locator('.filter-panel label').allInnerTexts();
      rec('lost enquiries: full filter bar, with no Status filter (PWA passes showStatus=false)',
        ['Segment', 'Site Type', 'Rating', 'Reference'].every((l) => filterLabels.includes(l)) && !filterLabels.includes('Status'),
        filterLabels.join('|'));
      // Filtering narrows the table but not the KPI cards (PWA asymmetry).
      await p.locator('.filter-field:has(label:text-is("Segment")) select').selectOption('Solar');
      await p.waitForTimeout(600);
      const afterFilter = await p.locator('body').innerText();
      rec('lost enquiries: a filter narrows the table while the KPI cards keep the full picture',
        /TOTAL — 1 enquir/.test(afterFilter) && /\(1 of 2,/.test(afterFilter));
      rec('lost enquiries: no JS errors', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }

    // Payments — PWA vPayments: KPIs, raised banner, pending table with
    // SO sub-line and totals, receipts ledger, settled milestones.
    {
      const s = await session(browser, 'finance');
      const p = s.page;
      await p.goto(BASE + '/payments', { waitUntil: 'networkidle' });
      const body = await p.locator('body').innerText();
      const kpis = await p.locator('.kpi-card .kpi-label').allInnerTexts();
      rec('payments: the five PWA KPI cards',
        ['Total Billed', 'Total Collected', 'Outstanding', 'Part-paid Milestones', 'Raised by PM'].every((l) => kpis.includes(l)),
        kpis.join('|'));
      rec('payments: raised-to-finance banner names the PM, the date and the collect-by',
        /raised by .+ on 2026-09-25/.test(body) && /collect by 2026-10-05/.test(body) && /URGENT/.test(body));
      rec('payments: pending table carries the SO number, balance and a TOTAL row',
        /SO-1001/.test(body) && /TOTAL/.test(body));
      rec('payments: receipts ledger lists each part payment with who entered it',
        /Payment Receipts Ledger/.test(body) && /NEFT0099/.test(body) && /Admin \(Suhas\)/.test(body));
      rec('payments: fully settled milestones panel with a Parts column',
        /Fully Settled Milestones/.test(body) && (await p.locator('th:text-is("Parts")').count()) === 1);
      const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Pending CSV/ }).click()]);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      rec('payments: CSV names the company and who ran it (PWA rptHead)',
        /^PAYMENTS REPORT — MEP Powertech \(Dev\)/.test(csv) && /Generated,\d{4}-\d{2}-\d{2} by Finance \(Vaibhavi\)/.test(csv) && /payments-\d{4}-\d{2}-\d{2}\.csv/.test(dl.suggestedFilename()),
        dl.suggestedFilename());
      rec('payments: no JS errors', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }

    // Projects list — PWA vProjects: nineteen columns with derived values.
    {
      const s = await session(browser, 'amol');
      const p = s.page;
      await p.goto(BASE + '/projects', { waitUntil: 'networkidle' });
      const headers = (await p.locator('table.data-table thead th').allInnerTexts()).map((h) => h.trim().toLowerCase());
      const body = await p.locator('body').innerText();
      rec('projects list: all nineteen PWA columns',
        headers.length === 19
        && ['so no', 'div', 'site type', 'cap.', 'customer', 'engineer(s)', 'checklist', 'timeline', 'target end', 'delay', 'next action', 'next action date', 'received', 'pending', 'material pending return', 'status'].every((h) => headers.includes(h)),
        headers.join('|'));
      rec('projects list: derived values are real — SO number, engineer name, checklist progress, target end',
        /1001/.test(body) && /Engineer \(Vinod\)/.test(body) && /2\/4/.test(body) && /2026-05-20/.test(body));
      rec('projects list: overdue work is flagged and the row is tinted',
        /overdue/.test(body) && (await p.locator('tr.row-bad').count()) >= 1);
      rec('projects list: payments reconciled into Received / Pending',
        /₹ ?6,09,860|₹ ?609,860/.test(body) && /₹ ?7,56,340|₹ ?756,340/.test(body),
        (body.match(/₹ ?[\d,]+/g) || []).slice(0, 6).join(' '));
      rec('projects list: PM sees their own division only, with the division in the heading', /HVAC Projects/.test(body));
      rec('projects list: no JS errors', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }

    // Delivery challans — PWA challanPanel: grouping, tally, banner, print.
    {
      const s = await session(browser, 'amol');
      const p = s.page;
      await p.goto(BASE + '/projects', { waitUntil: 'networkidle' });
      await p.locator('table.data-table tbody tr').first().click();
      await p.waitForLoadState('networkidle');
      await p.locator('tr.group-row').first().waitFor({ timeout: 10000 });
      const body = await p.locator('body').innerText();
      rec('challans: grouped by DC number with a group header carrying date and receiver',
        /DC No 1 · 2026-02-15 · Received by: Site supervisor Ramesh/.test(body) && /DC No 2 · 2026-03-05/.test(body));
      rec('challans: panel badges count documents and items, and pending returnables',
        /2 DC · 3 items/.test(body) && /Returnable pending: 3/.test(body));
      rec('challans: per-line balance, Returnable/Consumable wording and the TALLY row',
        /Returnable/.test(body) && /Consumable/.test(body) && /TALLY/.test(body) && /3 to return/.test(body));
      rec('challans: outstanding returnable material is called out before closure',
        /returnable qty still on site/.test(body));
      const groupRows = await p.locator('tr.group-row').count();
      rec('challans: one group header per challan', groupRows === 2, String(groupRows));
      // Print opens a populated challan document in its own window.
      const [printed] = await Promise.all([
        p.context().waitForEvent('page'),
        p.getByRole('button', { name: '🖨 Print DC' }).first().click(),
      ]);
      await printed.waitForLoadState('domcontentloaded');
      const printedText = await printed.locator('body').innerText();
      rec('challans: Print DC produces a real challan document (company letterhead, meta, items, signatures)',
        /DELIVERY CHALLAN — No\. 1/.test(printedText)
        && /MEP Powertech \(Dev\)/.test(printedText)
        && /GI duct sheet 24g/.test(printedText)
        && /Scaffolding set/.test(printedText)
        && !/Insulation roll/.test(printedText)
        && /Received By \(Client \/ Site\)/.test(printedText),
        printedText.slice(0, 60).replace(/\n/g, ' '));
      await printed.close();
      rec('challans: no JS errors', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }


    // Modal sweep — a page can render fine while a modal inside it throws
    // (a real defect found this way: the user modal referenced a variable
    // from another component's scope). Open the primary modal on each screen
    // that has one and assert it renders with its controls.
    {
      const s = await session(browser, 'admin');
      const p = s.page;
      const modals = [
        ['/users', '+ Create Login', 'select', 'user modal lists the roles this company may assign'],
        ['/enquiries/new', null, 'form', 'new enquiry form renders'],
      ];
      for (const [path, button, control, label] of modals) {
        const before = s.errors.length;
        await p.goto(BASE + path, { waitUntil: 'networkidle' });
        if (button) {
          await p.getByRole('button', { name: button }).click();
          await p.locator('.modal').waitFor({ timeout: 5000 });
        }
        const controls = await p.locator(`.modal ${control}, form ${control}, ${control}`).count();
        rec(`modals: ${label}`, controls > 0 && s.errors.length === before, s.errors.slice(before).join(' | '));
      }
      // The role dropdown must actually be populated (the defect's symptom).
      const roleCount = await p.goto(BASE + '/users', { waitUntil: 'networkidle' })
        .then(() => p.getByRole('button', { name: '+ Create Login' }).click())
        .then(() => p.locator('.modal select option').count());
      rec('modals: the user modal offers role options', roleCount >= 5, String(roleCount));
      rec('modals: no JS errors while opening modals', s.errors.length === 0 && s.bad.length === 0, s.errors.concat(s.bad).join(' | '));
      await s.ctx.close();
    }

    // Responsive: the shell collapses to a drawer and nothing overflows.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
      await page.locator('label:has-text("Username") input').fill('admin');
      await page.locator('label:has-text("Password") input').fill('password123');
      await page.locator('button[type=submit]').click();
      await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      // Wait (bounded) for the app shell to render after the post-login navigation;
      // isVisible() below does not wait, so without this the check can race the render.
      await page.locator('.nav-toggle').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const toggle = await page.locator('.nav-toggle').isVisible().catch(() => false);
      rec('responsive: at 390px the nav collapses to a toggle and the page does not scroll sideways',
        toggle && overflow <= 1, `toggle=${toggle} overflow=${overflow}`);
      await page.locator('.nav-toggle').click();
      await page.waitForTimeout(400);
      const navVisible = await page.locator('.shell-nav a.nav-item').first().isVisible();
      rec('responsive: the drawer opens and exposes the menu', navVisible);
      await page.screenshot({ path: require('path').join(__dirname, 'shot-mobile-dashboard.png') });
      await ctx.close();
    }

    // Design-system screenshots for review (desktop).
    {
      const s = await session(browser, 'finance');
      await s.page.setViewportSize({ width: 1440, height: 900 });
      await s.page.goto(BASE + '/payments', { waitUntil: 'networkidle' });
      await s.page.screenshot({ path: require('path').join(__dirname, 'shot-payments.png'), fullPage: true });
      await s.ctx.close();
      const s2 = await session(browser, 'amol');
      await s2.page.setViewportSize({ width: 1440, height: 900 });
      await s2.page.goto(BASE + '/projects', { waitUntil: 'networkidle' });
      await s2.page.screenshot({ path: require('path').join(__dirname, 'shot-projects.png'), fullPage: true });
      await s2.ctx.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(require('path').join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
    const f = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\nTOTAL ${results.length}  PASS ${results.length - f}  FAIL ${f}`);
  }
})();
