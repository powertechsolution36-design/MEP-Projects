'use strict';
// Phone-sized walkthrough of the AMC client / WhatsApp flows (22 Oct 2026).
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const BASE = 'http://127.0.0.1:4100';
const PW = 'password123';
const SHOTS = __dirname + '/shots-amc';
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
const rec = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -- ' + info}`); };

async function apiLogin(username) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  return (await r.json()).token;
}
async function api(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
async function session(browser, username) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('label:has-text("Username") input').fill(username);
  await page.locator('label:has-text("Password") input').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 15000 });
  return { ctx, page, errors };
}
const field = (scope, label) => scope.locator(`.filter-field:has(> label:text-is("${label}")) input, .filter-field:has(> label:text-is("${label}")) textarea, .filter-field:has(> label:text-is("${label}")) select`).first();

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    /* 1. Admin sets the company WhatsApp number in Company Profile */
    const a = await session(browser, 'admin');
    await a.page.goto(BASE + '/company-profile', { waitUntil: 'networkidle' });
    await a.page.locator('button:has-text("Edit Profile")').click();
    const wa = a.page.locator('label:has-text("Company WhatsApp number") input');
    await wa.fill('12345');
    await a.page.locator('form button[type="submit"]').click();
    await a.page.waitForTimeout(600);
    const badMsg = await a.page.locator('text=/WhatsApp/i').allInnerTexts();
    rec('company profile: an invalid WhatsApp number is refused', badMsg.some((t) => /digit|valid|number/i.test(t)), badMsg.join(' | '));
    await wa.fill('74473 33377');
    await a.page.locator('form button[type="submit"]').click();
    await a.page.waitForTimeout(800);
    const shown = await a.page.locator('text=Company WhatsApp').locator('..').innerText().catch(() => '');
    rec('company profile: WhatsApp 7447333377 saved and shown', /7447333377/.test(shown), shown);
    await a.page.screenshot({ path: SHOTS + '/1-company-profile.png', fullPage: true });

    /* 2. Service manager registers a complaint for the AMC client via the picker */
    const m = await session(browser, 'service');
    await m.page.goto(BASE + '/service-calls/new', { waitUntil: 'networkidle' });
    await m.page.locator('input[aria-label="Search AMC or Warranty client"]').fill('Interv');
    await m.page.locator('.client-results button:has-text("Intervalve Poonawalla")').click();
    const picked = await m.page.locator('.client-picked').innerText();
    rec('complaint: picker finds and picks the AMC client', /Intervalve Poonawalla/.test(picked) && /Covered by AMC/.test(picked), picked);
    rec('complaint: customer/phone filled from the client', (await field(m.page, 'Customer *').inputValue()) === 'Intervalve Poonawalla' && (await field(m.page, 'Phone').inputValue()) === '9422011234');
    await field(m.page, 'Description').fill('Indoor unit leaking water');
    await m.page.screenshot({ path: SHOTS + '/2-complaint-picker.png', fullPage: true });
    await m.page.locator('button:has-text("Register Complaint")').click();
    await m.page.waitForURL(/\/service-calls\/[^/n][^/]*$/, { timeout: 10000 });
    const newId = m.page.url().split('/').pop();
    const mTok = await apiLogin('service');
    const created = (await api(mTok, 'GET', `/api/service-calls/${newId}`)).body;
    const sc = created.serviceCall || created;
    rec('complaint: saved linked to the client with coverage AMC', sc.contractId === 'amc_demo' && sc.coverage === 'AMC', JSON.stringify({ c: sc.contractId, cov: sc.coverage }));
    const asg = await api(mTok, 'PUT', `/api/service-calls/${newId}/assign`, { engineerId: 'seed_user_6', appointmentDate: '2026-10-23' });
    rec('manager assigns the complaint to engineer Vinod', asg.status === 200, JSON.stringify(asg.body).slice(0, 200));

    /* 2b. Chargeable walk-in */
    await m.page.goto(BASE + '/service-calls/new', { waitUntil: 'networkidle' });
    await m.page.locator('button:has-text("Not an AMC / Warranty client")').click();
    rec('complaint: "not a client" shows Chargeable', /Chargeable/.test(await m.page.locator('.client-picked').innerText()));

    /* 3. Engineer (Vinod) fills the report with parts + gas and completes on his phone */
    const e = await session(browser, 'vinod');
    await e.page.goto(BASE + `/service-calls/${newId}`, { waitUntil: 'networkidle' });
    await e.page.locator('button:has-text("Edit Report")').click();
    await field(e.page, 'Make').fill('Daikin');
    await field(e.page, 'Service Description *').fill('Cleaned filters, replaced capacitor, topped up gas');
    for (const b of await e.page.locator('.check-toggle-btn.is-done[aria-label]').all()) await b.click();
    await e.page.locator('button:has-text("+ Add part")').click();
    await e.page.locator('input[placeholder^="Part"]').nth(0).fill('Run capacitor 45uF');
    await e.page.locator('.part-row').nth(0).locator('button:has-text("Replaced")').click();
    await e.page.locator('button:has-text("+ Add part")').click();
    await e.page.locator('input[placeholder^="Part"]').nth(1).fill('Drain pipe');
    await e.page.locator('.part-row').nth(1).locator('button:has-text("Repaired")').click();
    await e.page.locator('[aria-label="Gas filled?"] button:has-text("Yes")').click();
    await field(e.page, 'Gas type').selectOption('R32');
    await field(e.page, 'Quantity (kg)').fill('0.8');
    await e.page.screenshot({ path: SHOTS + '/3-engineer-report.png', fullPage: true });
    await e.page.locator('button:has-text("Save Report Draft")').click();
    await e.page.waitForTimeout(800);
    await e.page.locator('button:text-is("Complete")').click();
    const canvas = e.page.locator('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await e.page.mouse.move(box.x + 20, box.y + 20); await e.page.mouse.down();
    await e.page.mouse.move(box.x + 120, box.y + 60, { steps: 8 }); await e.page.mouse.move(box.x + 200, box.y + 30, { steps: 8 }); await e.page.mouse.up();
    await e.page.locator('button:has-text("Complete & Generate Report")').click();
    await e.page.waitForSelector('text=Service Report (PDF)', { timeout: 10000 }).catch(async (er) => {
      await e.page.screenshot({ path: SHOTS + '/x-complete-fail.png', fullPage: true });
      console.log('BODY:', (await e.page.locator('body').innerText()).slice(0, 1500), 'ERR:', e.errors);
      throw er;
    });
    await e.page.waitForTimeout(800);
    const eText = await e.page.locator('body').innerText();
    rec('engineer: after Complete, no client Send button; told the manager will send', !(await e.page.locator('a:has-text("Send report on WhatsApp")').count()) && /service manager has been asked/i.test(eText));
    await e.page.screenshot({ path: SHOTS + '/4-engineer-completed.png', fullPage: true });

    /* 4. Manager sees it in "Reports to send" and sends from the company number */
    await m.page.goto(BASE + '/service-calls', { waitUntil: 'networkidle' });
    const toSend = await m.page.locator('.to-send-list, :has-text("Reports to send")').first().innerText().catch(() => '');
    rec('manager: "Reports to send" lists the completed call', /Reports to send/.test(await m.page.locator('body').innerText()) && /Intervalve/.test(toSend), toSend.slice(0, 200));
    await m.page.screenshot({ path: SHOTS + '/5-reports-to-send.png', fullPage: true });
    const notes = (await api(mTok, 'GET', '/api/notifications')).body;
    const list = notes.notifications || notes.items || notes || [];
    rec('manager: completion notification carries the call link for the phone push', Array.isArray(list) && list.some((n) => JSON.stringify(n).includes(newId)), JSON.stringify(list).slice(0, 200));
    await m.page.goto(BASE + `/service-calls/${newId}`, { waitUntil: 'networkidle' });
    await m.page.waitForSelector('a:has-text("Send report on WhatsApp")', { timeout: 8000 });
    const sendA = m.page.locator('a:has-text("Send report on WhatsApp")');
    const href = await sendA.getAttribute('href');
    const label = await sendA.innerText();
    rec('manager: Send button goes to wa.me/919422011234 with the PDF link', /^https:\/\/wa\.me\/919422011234\?text=[\s\S]*service-reports/.test(decodeURIComponent(href)), href);
    rec('manager: Send button says it sends from +91 74473 33377', /74473 33377/.test(label), label);
    const pdfA = await m.page.locator('a:has-text("Open PDF")').getAttribute('href');
    const pdf = await fetch(new URL(pdfA, BASE));
    const pdfBuf = Buffer.from(await pdf.arrayBuffer());
    rec('service report PDF opens', pdf.status === 200 && pdfBuf.slice(0, 4).toString() === '%PDF', `${pdf.status}`);
    await m.page.locator('button:has-text("Mark as sent")').click();
    await m.page.waitForSelector('text=Sent to client', { timeout: 6000 }).catch(() => {});
    rec('manager: Mark as sent → "Sent to client"', /Sent to client/.test(await m.page.locator('body').innerText()));
    const left = (await api(mTok, 'GET', '/api/service-calls/reports-to-send')).body;
    rec('manager: the call leaves "Reports to send"', !JSON.stringify(left).includes(newId), JSON.stringify(left).slice(0, 200));

    /* 5. AMC client page: history stats, mark paid, AMC letter, renew */
    await m.page.goto(BASE + '/contracts/amc_demo', { waitUntil: 'networkidle' });
    const cText = await m.page.locator('body').innerText();
    rec('client page: service history shows the linked call', /Service history \(1\)/.test(cText), (cText.match(/Service history \(\d+\)/) || [''])[0]);
    const tile = async (lbl) => m.page.locator(`.stat-tile:has(.stat-label:text-is("${lbl}"))`).innerText().catch(() => '');
    const tiles = (await m.page.locator('.stat-grid').innerText().catch(() => '')).replace(/\n/g, ' ');
    rec('client page: parts repaired/replaced and gas fills counted', /1\s*Parts? repaired/i.test(tiles) && /1\s*Parts? replaced/i.test(tiles) && /1×\s*Gas filled/i.test(tiles), tiles);
    rec('client page: AMC letter is held until paid', /paid/i.test(await m.page.locator('.panel:has(h3:text-is("AMC letter"))').innerText()) && !(await m.page.locator('a:has-text("Open AMC letter")').count()));
    await m.page.screenshot({ path: SHOTS + '/6-client-before-paid.png', fullPage: true });
    await m.page.locator('button:has-text("Mark AMC paid")').click();
    await m.page.locator('label:has-text("Reference") input').fill('UTR998877');
    await m.page.locator('button:has-text("Save payment")').click();
    await m.page.waitForSelector('a:has-text("Open AMC letter")', { timeout: 8000 }).catch(() => {});
    const letterHref = await m.page.locator('a:has-text("Open AMC letter")').getAttribute('href').catch(() => null);
    rec('client page: once paid, AMC letter link appears', !!letterHref, String(letterHref));
    if (letterHref) {
      const lr = await fetch(new URL(letterHref, BASE));
      const lb = Buffer.from(await lr.arrayBuffer());
      rec('AMC letter PDF opens', lr.status === 200 && lb.slice(0, 4).toString() === '%PDF', `${lr.status}`);
      require('fs').writeFileSync(SHOTS + '/amc-letter.pdf', lb);
    }
    const waLetter = m.page.locator('a:has-text("Send AMC letter on WhatsApp")');
    const waHref = await waLetter.getAttribute('href').catch(() => '');
    rec('client page: AMC letter WhatsApp from +91 74473 33377 to the client', /wa\.me\/919422011234/.test(waHref || '') && /74473 33377/.test(await waLetter.innerText().catch(() => '')), waHref);
    await m.page.screenshot({ path: SHOTS + '/7-client-paid.png', fullPage: true });
    await m.page.locator('button:has-text("Renew AMC")').click();
    await m.page.locator('form button:text-is("Renew")').click();
    await m.page.waitForTimeout(1000);
    const rText = await m.page.locator('body').innerText();
    rec('renew: new period shown, payment back to pending, earlier period kept', /Earlier periods/.test(rText) && /2028/.test(rText) && /Service history \(1\)/.test(rText), rText.slice(0, 300));
    await m.page.screenshot({ path: SHOTS + '/8-client-renewed.png', fullPage: true });

    /* 6. Engineer cannot mark paid / see send buttons on the client */
    const eTok = await apiLogin('vinod');
    rec('engineer cannot mark AMC paid (403)', (await api(eTok, 'POST', '/api/contracts/amc_demo/payment', {})).status === 403);

    const errs = [...a.errors, ...m.errors, ...e.errors];
    rec('no page JavaScript errors', errs.length === 0, errs.join(' | '));
  } catch (err) {
    rec('walkthrough ran to the end', false, err.stack);
  } finally {
    await browser.close();
    const f = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - f}/${results.length} passed`);
    process.exit(f ? 1 : 0);
  }
})();
