'use strict';
/**
 * Customer portal — responsive and accessibility check (owner decision,
 * 27 Oct 2026).
 *
 *   1. cd new-app/frontend && npm run build
 *   2. node e2e/completion/server.js        (port 4100; restart before each run)
 *   3. node e2e/completion/portal-visual.js
 *
 * Walks every portal screen at phone, tablet and desktop width, writes a
 * screenshot of each into e2e/completion/shots-portal-visual/, and checks the
 * things a person would otherwise have to notice by eye:
 *
 *   - nothing scrolls sideways
 *   - no control is smaller than a fingertip
 *   - every control has a name a screen reader can read
 *   - every form field has a label
 *   - there is exactly one h1/h2 at the top of each screen
 *   - status is never carried by colour alone
 *   - text meets the contrast floor against its own background
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4100';
const SHOTS = path.join(__dirname, 'shots-portal-visual');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: false, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
];

const results = [];
const rec = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

const CLIENT_PW = 'client-password-1';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PNG_PATH = path.join(SHOTS, 'problem.png');
fs.writeFileSync(PNG_PATH, PNG);

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
  return { status: res.status, json };
}

/* ------------------------------------------------------------------ *
 * The checks that run on every screen at every width
 * ------------------------------------------------------------------ */

/** sRGB relative luminance, then the WCAG contrast ratio. */
const AUDIT = `(() => {
  const out = { overflow: null, small: [], unnamed: [], unlabelled: [], headings: [], lowContrast: [], focusable: 0 };

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    // Name the widest offender so the failure is actionable.
    let worst = null;
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 && (!worst || r.right > worst.right)) {
        worst = { right: r.right, tag: el.tagName.toLowerCase(), cls: el.className };
      }
    }
    out.overflow = { page: de.scrollWidth, view: de.clientWidth, worst };
  }

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1) return false;
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
    // A skip link parked above the viewport until it is focused, and
    // anything hidden from assistive technology, are not on the page as far
    // as these checks are concerned.
    if (r.bottom < 0 || r.top > (window.innerHeight + de.scrollHeight)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  };
  const label = (el) => (
    el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') && (document.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent)
    || el.textContent
    || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ')
    || el.getAttribute('title')
    || ''
  ).trim();

  const controls = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(vis);
  out.focusable = controls.length;

  for (const el of controls) {
    const r = el.getBoundingClientRect();
    // A control inside a line of prose is sized by its text; only standalone
    // controls are held to the fingertip minimum.
    const inline = el.tagName === 'A' && el.closest('p, li');
    if (!inline && (r.width < 44 || r.height < 44)) {
      out.small.push(el.tagName.toLowerCase() + '.' + el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const id = el.id;
      const has = (id && document.querySelector('label[for="' + id + '"]')) || el.closest('label') || el.getAttribute('aria-label');
      if (!has && el.type !== 'hidden') out.unlabelled.push(el.tagName.toLowerCase() + ' ' + (el.type || ''));
    } else if (!label(el)) {
      out.unnamed.push(el.tagName.toLowerCase() + '.' + el.className);
    }
  }

  out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 40));

  /* ---- contrast ---- */
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };

  for (const el of document.querySelectorAll('p, span, div, a, button, label, h1, h2, h3, h4, li, td, th, strong, small')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg || fg.a < 0.95) continue;
    const size = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bgOf(el));
    if (got < need) {
      out.lowContrast.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30) + ' ' + got.toFixed(2) + '<' + need + ' "' + el.textContent.trim().slice(0, 30) + '"');
    }
  }
  return out;
})()`;

async function audit(page, screen, width) {
  const a = await page.evaluate(AUDIT);
  const tag = `${screen} @${width}`;
  rec(`${tag}: the page does not scroll sideways`, a.overflow === null,
    a.overflow ? `${a.overflow.page}px in a ${a.overflow.view}px window, widest: ${a.overflow.worst && a.overflow.worst.tag}.${a.overflow.worst && a.overflow.worst.cls}` : '');
  rec(`${tag}: every control is at least 44x44`, a.small.length === 0, a.small.slice(0, 4).join(' | '));
  rec(`${tag}: every control has a name`, a.unnamed.length === 0, a.unnamed.slice(0, 4).join(' | '));
  rec(`${tag}: every field has a label`, a.unlabelled.length === 0, a.unlabelled.slice(0, 4).join(' | '));
  rec(`${tag}: text meets the contrast floor`, a.lowContrast.length === 0, a.lowContrast.slice(0, 4).join(' | '));
  return a;
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/* ------------------------------------------------------------------ */

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const staff = (await api('POST', '/api/auth/login', { body: { username: 'service', password: 'password123' } })).json.token;
    const contract = (await api('GET', '/api/contracts/amc_demo', { token: staff })).json;
    const phone = (contract.contract || contract).phone;

    /* Register once and have staff approve, so the signed-in screens have
       something real on them. */
    await api('POST', '/api/portal/auth/register', { body: { name: 'Mr Poonawalla', phone, password: CLIENT_PW } });
    const pending = (await api('GET', '/api/customer-accounts', { token: staff })).json.accounts.find((a) => a.status === 'Pending');
    await api('POST', `/api/customer-accounts/${pending.id}/approve`, { token: staff, body: { contractId: pending.contractId } });

    /* The client's project, linked once so every width has it on screen
       (owner decision, 30 Oct 2026). */
    const admin = (await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'password123' } })).json.token;
    const active = (await api('GET', '/api/customer-accounts', { token: staff })).json.accounts
      .find((a) => a.status === 'Active');
    if (active) {
      await api('PUT', `/api/customer-accounts/${active.id}/projects`, { token: staff, body: { projectIds: ['prj_demo'] } });
      await api('PATCH', '/api/projects/prj_demo/updates/0/share', {
        token: admin, body: { shared: true, customerNote: 'Ducting is about 80% done on your floor.' },
      });
      const png = `data:image/png;base64,${PNG.toString('base64')}`;
      await api('POST', '/api/projects/prj_demo/updates/0/photos', {
        token: admin,
        body: { photos: [
          { data: png, caption: 'Ducting run above the false ceiling' },
          { data: png, caption: 'AHU platform ready' },
        ] },
      });
    }

    for (const w of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w.width, height: w.height },
        isMobile: w.isMobile,
        hasTouch: w.hasTouch,
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      /* ---- signed out ---- */
      await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
      await shoot(page, `${w.name}-1-login`);
      const loginAudit = await audit(page, 'login', w.name);
      rec(`login @${w.name}: one top-level heading`,
        loginAudit.headings.filter((h) => h.startsWith('H1')).length === 1, loginAudit.headings.join(' | '));

      await page.goto(`${BASE}/portal/register`, { waitUntil: 'networkidle' });
      await shoot(page, `${w.name}-2-register`);
      await audit(page, 'register', w.name);

      /* ---- the empty dashboard, before any complaint exists ---- */
      await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
      await page.locator('label:has-text("Mobile number") input').fill(phone);
      await page.locator('label:has-text("Password") input').fill(CLIENT_PW);
      await page.locator('button[type=submit]').click();
      await page.waitForTimeout(900);
      const dashText = await page.locator('body').innerText();
      if (/no complaints|nothing/i.test(dashText)) await shoot(page, `${w.name}-3-dashboard-empty`);
      else await shoot(page, `${w.name}-3-dashboard`);
      await audit(page, 'dashboard', w.name);

      /* ---- the complaint form, with a photograph chosen ---- */
      await page.goto(`${BASE}/portal/complaints/new`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await audit(page, 'complaint form (empty)', w.name);
      await page.locator('label:has-text("What is the problem?") textarea').fill('Indoor unit is leaking water onto the floor in the main hall');
      await page.locator('input[type=file]').setInputFiles(PNG_PATH);
      await page.waitForTimeout(400);
      await shoot(page, `${w.name}-4-complaint-form`);
      await audit(page, 'complaint form (filled)', w.name);

      /* ---- validation: an empty description must say so, not submit ---- */
      await page.locator('label:has-text("What is the problem?") textarea').fill('');
      await page.locator('button[type=submit]').click();
      await page.waitForTimeout(400);
      rec(`validation @${w.name}: an empty description does not submit`,
        page.url().includes('/complaints/new'), page.url());
      await page.locator('label:has-text("What is the problem?") textarea').fill('Indoor unit is leaking water onto the floor in the main hall');

      await page.locator('button[type=submit]').click();
      await page.waitForURL(/\/portal\/complaints\/[^/]+$/, { timeout: 15000 });
      await page.waitForTimeout(900);
      await shoot(page, `${w.name}-5-complaint-registered`);
      await audit(page, 'complaint (registered)', w.name);
      const callId = page.url().split('/').pop();

      /* ---- assigned ---- */
      await api('PUT', `/api/service-calls/${callId}/assign`, {
        token: staff, body: { engineerId: 'seed_user_6', appointmentDate: '2026-11-05', appointmentTime: '11:00' },
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      await shoot(page, `${w.name}-6-complaint-assigned`);
      await audit(page, 'complaint (assigned)', w.name);

      /* ---- completed ---- */
      await api('POST', `/api/service-calls/${callId}/complete`, {
        token: staff,
        body: {
          signature: 'data:image/png;base64,iVBORw0KGgo=',
          report: {
            serviceDescription: 'Cleared the blocked drain line and tested the unit for an hour',
            engineerRemark: 'INTERNAL ONLY note', amount: 1800, serviceType: 'AMC',
            checklistResults: Object.fromEntries(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'].map((k) => [k, 'Done'])),
          },
        },
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      await shoot(page, `${w.name}-7-complaint-completed`);
      await audit(page, 'complaint (completed)', w.name);

      /* ---- the dashboard with history on it ---- */
      await page.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      await shoot(page, `${w.name}-8-dashboard-full`);
      const full = await audit(page, 'dashboard (with history)', w.name);
      rec(`dashboard @${w.name}: status is not carried by colour alone`,
        (await page.locator('.status-badge').first().innerText()).trim().length > 0);
      // Every complaint in the list must be reachable without a mouse.
      const rows = await page.locator('.portal-row').count();
      const reachable = await page.evaluate(() => [...document.querySelectorAll('.portal-row')]
        .filter((el) => el.tagName === 'A' && el.hasAttribute('href') && el.tabIndex >= 0).length);
      rec(`dashboard @${w.name}: every complaint in the list is reachable by keyboard`,
        rows > 0 && reachable === rows, `${reachable} of ${rows} (${full.focusable} controls on the page)`);

      /* ---- the project page (owner decision, 30 Oct 2026) ---- */
      await page.goto(`${BASE}/portal/projects/prj_demo`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await shoot(page, `${w.name}-9-project`);
      const projAudit = await audit(page, 'project progress', w.name);
      rec(`project @${w.name}: one top-level heading`,
        projAudit.headings.filter((h) => h.startsWith('H1')).length === 1, projAudit.headings.join(' | '));
      rec(`project @${w.name}: the progress figure is in words, not only in the bar`,
        (await page.locator('body').innerText()).includes('% complete'));
      rec(`project @${w.name}: the meter is labelled for a screen reader`,
        (await page.locator('.portal-meter[aria-label]').count()) > 0);
      rec(`project @${w.name}: each stage says whether it is done, not just by colour`,
        (await page.locator('.portal-step .portal-sr').count()) >= 6);
      rec(`project @${w.name}: the photographs of the work are on the page`,
        (await page.locator('.portal-photo img').count()) === 2);
      rec(`project @${w.name}: each photograph can be opened from the keyboard`,
        (await page.evaluate(() => [...document.querySelectorAll('.portal-photo')]
          .every((el) => el.tagName === 'BUTTON' && el.tabIndex >= 0))));
      rec(`project @${w.name}: each photograph is described, not left bare`,
        (await page.evaluate(() => [...document.querySelectorAll('.portal-photo img')]
          .every((el) => (el.getAttribute('alt') || '').trim().length > 0))));

      /* ---- a wrong sign-in, so the error state is on record ---- */
      await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
      await page.evaluate(() => { try { localStorage.clear(); } catch { /* private mode */ } });
      await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
      await page.locator('label:has-text("Mobile number") input').fill(phone);
      await page.locator('label:has-text("Password") input').fill('definitely-wrong');
      await page.locator('button[type=submit]').click();
      await page.waitForTimeout(900);
      await shoot(page, `${w.name}-9-login-error`);
      const errText = await page.locator('[role=alert]').first().innerText().catch(() => '');
      rec(`error @${w.name}: a wrong password is announced, in plain words`,
        errText.length > 0 && !/stack|mongo|5\\d\\d|undefined/i.test(errText), errText.slice(0, 80));
      await audit(page, 'login (error)', w.name);

      rec(`no page errors @${w.name}`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } catch (err) {
    rec('the run reached the end', false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err));
  } finally {
    await browser.close();
    const fail = results.filter((ok) => !ok).length;
    console.log(`\nScreenshots in ${SHOTS}`);
    console.log(`TOTAL ${results.length}  PASS ${results.length - fail}  FAIL ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
