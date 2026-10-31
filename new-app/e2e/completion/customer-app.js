'use strict';
/**
 * The customer app — installable portal and notifications (owner decision,
 * 31 Oct 2026).
 *
 *   1. cd new-app/frontend && npm run build
 *   2. node e2e/completion/server.js        (port 4100; restart before each run)
 *   3. node e2e/completion/customer-app.js
 *
 * Checks the three claims the app makes, and the one it must not:
 *
 *   · it can be installed — a valid manifest, in scope, with icons that
 *     actually load, including a maskable one;
 *   · it survives a lost signal — the service worker takes control and the
 *     page still renders with the network cut;
 *   · it can be notified — the key endpoint answers, a subscription is
 *     stored, and the worker's own push handler shows the right thing;
 *   · THE STAFF APP IS UNTOUCHED — no manifest, no service worker, nothing.
 *
 * The push handler is exercised by loading sw.js in a sandbox and firing a
 * push event at it. A real delivery needs Google's or Apple's push service,
 * which an offline test run has no business reaching; what can be tested
 * here is that the payload our server writes becomes the notification the
 * client sees, and that is what is tested.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const BASE = 'http://127.0.0.1:4100';
const SHOTS = path.join(__dirname, 'shots-customer-app');
fs.mkdirSync(SHOTS, { recursive: true });

const CLIENT_PW = 'client-password-1';
const results = [];
const rec = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
  return { status: res.status, json, headers: res.headers };
}

/* ------------------------------------------------------------------ *
 * 1. The service worker's own logic, without a browser
 * ------------------------------------------------------------------ */

function testServiceWorkerLogic() {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/mep-portal-sw.js'), 'utf8');
  const listeners = {};
  const shown = [];
  const opened = [];

  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'https://example.test' },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (u) => { opened.push(u); } },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
  };
  const sandbox = {
    self,
    clients: self.clients,
    caches: { open: async () => ({ add: async () => {}, put: async () => {} }), keys: async () => [], match: async () => null, delete: async () => {} },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Request: function Request(url) { this.url = url; },
    Response: function Response(body, init) { this.body = body; this.init = init; },
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  rec('worker: it listens for a push and for a tap on one',
    typeof listeners.push === 'function' && typeof listeners.notificationclick === 'function');

  // What our server actually sends.
  const payload = JSON.stringify({
    title: 'Your service report is ready',
    body: 'The visit for PSC-11 is finished. Tap to read the report.',
    url: '/portal/complaints/abc123',
    tag: 'complaint-abc123',
  });
  const waits = [];
  listeners.push({ data: { json: () => JSON.parse(payload) }, waitUntil: (p) => waits.push(p) });
  return Promise.all(waits).then(async () => {
    rec('worker: the push becomes a notification in the server’s own words',
      shown.length === 1 && shown[0].title === 'Your service report is ready'
      && shown[0].options.body.includes('PSC-11'), JSON.stringify(shown[0] || {}).slice(0, 200));
    rec('worker: it carries the screen to open', shown.length === 1 && shown[0].options.data.url === '/portal/complaints/abc123');

    // A push with nothing in it still says something true rather than crashing.
    shown.length = 0;
    const empty = [];
    listeners.push({ data: null, waitUntil: (p) => empty.push(p) });
    await Promise.all(empty);
    rec('worker: an empty push still shows something true, and nothing invented',
      shown.length === 1 && shown[0].options.data.url === '/portal/', JSON.stringify(shown[0] || {}).slice(0, 160));

    // A url from anywhere but our own portal is never opened.
    shown.length = 0;
    const evil = [];
    listeners.push({ data: { json: () => ({ title: 'x', body: 'y', url: 'https://evil.example.com/' }) }, waitUntil: (p) => evil.push(p) });
    await Promise.all(evil);
    rec('worker: a link that is not ours is replaced, never followed',
      shown.length === 1 && shown[0].options.data.url === '/portal/');

    // Tapping it opens the portal.
    const clicks = [];
    listeners.notificationclick({
      notification: { close: () => {}, data: { url: '/portal/complaints/abc123' } },
      waitUntil: (p) => clicks.push(p),
    });
    await Promise.all(clicks);
    rec('worker: tapping it opens that screen', opened.length === 1 && opened[0] === '/portal/complaints/abc123', opened.join(','));
  });
}

/* ------------------------------------------------------------------ *
 * 2. The browser
 * ------------------------------------------------------------------ */

(async () => {
  await testServiceWorkerLogic();

  /* ---- the manifest, as a browser would read it ---- */
  const mf = await api('GET', '/portal/manifest.json');
  const m = mf.json || {};
  rec('manifest: it is served', mf.status === 200, String(mf.status));
  rec('manifest: it is a standalone app scoped to the portal',
    m.display === 'standalone' && m.scope === '/portal/' && String(m.start_url).startsWith('/portal/'),
    JSON.stringify({ display: m.display, scope: m.scope, start_url: m.start_url }));
  rec('manifest: the start URL is inside the scope', String(m.start_url || '').startsWith(m.scope || 'x'));
  rec('manifest: it has a name, a short name and a colour',
    Boolean(m.name && m.short_name && m.theme_color && m.background_color));

  const icons = m.icons || [];
  rec('manifest: it offers 192 and 512 icons and a maskable one',
    icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512')
    && icons.some((i) => String(i.purpose || '').includes('maskable')), JSON.stringify(icons.map((i) => i.sizes + ':' + i.purpose)));

  let iconsOk = true;
  for (const icon of icons) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(BASE + icon.src);
    // eslint-disable-next-line no-await-in-loop
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    if (!res.ok || bytes < 1000) iconsOk = false;
  }
  rec('manifest: every icon it names actually loads', iconsOk);

  const sw = await fetch(`${BASE}/mep-portal-sw.js`);
  rec('worker: it is served as JavaScript',
    sw.ok && /javascript/.test(sw.headers.get('content-type') || ''), sw.headers.get('content-type') || String(sw.status));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ---- a client signs in ---- */
    const staff = (await api('POST', '/api/auth/login', { body: { username: 'service', password: 'password123' } })).json.token;
    // The demo AMC client from fixture.js: registering with the number on
    // the contract is what matches the account to it, exactly as a real
    // client's registration does.
    const contract = (await api('GET', '/api/contracts/amc_demo', { token: staff })).json;
    const phone = (contract.contract || contract).phone;
    await api('POST', '/api/portal/auth/register', { body: { name: 'Mr Poonawalla', phone, password: CLIENT_PW } });
    const accounts = (await api('GET', '/api/customer-accounts', { token: staff })).json.accounts || [];
    const acct = accounts.find((a) => String(a.phone).endsWith(String(phone).slice(-10)));
    const approved = await api('POST', `/api/customer-accounts/${acct.id}/approve`, { token: staff, body: {} });
    rec('client: the registration matched the contract and was approved',
      approved.status === 200, JSON.stringify(approved.json).slice(0, 160));

    await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
    await page.locator('label:has-text("Mobile number") input').fill(phone);
    await page.locator('label:has-text("Password") input').fill(CLIENT_PW);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/portal\/?$/, { timeout: 15000 });
    await page.waitForTimeout(1200);

    /* ---- the page says it is an app ---- */
    const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href').catch(() => null);
    rec('page: the portal declares the app manifest', manifestHref === '/portal/manifest.json', String(manifestHref));
    const appleIcons = await page.locator('link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    rec('page: iPhone is given exactly one icon, the portal’s own',
      appleIcons.length === 1 && appleIcons[0] === '/portal/apple-touch-180.png', JSON.stringify(appleIcons));

    /* ---- the worker takes control ---- */
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 })
      .catch(() => {});
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller));
    rec('worker: it is controlling the portal', controlled);

    const scope = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.map((r) => r.scope).join(',');
    });
    rec('worker: its scope is the portal and nothing above it',
      /\/portal\/?$/.test(scope) && scope.split(',').length === 1, scope);

    /* ---- the app card ---- */
    const dash = await page.locator('body').innerText();
    rec('app card: the client is offered notifications', /complaint moves/i.test(dash), dash.slice(0, 300));
    await page.screenshot({ path: path.join(SHOTS, '1-dashboard-app-card.png'), fullPage: true });

    const keyRes = await api('GET', '/api/portal/push/key', { token: (await api('POST', '/api/portal/auth/login', { body: { phone, password: CLIENT_PW } })).json.token });
    rec('notifications: the server offers a key when one is configured',
      keyRes.status === 200 && keyRes.json.enabled === true && typeof keyRes.json.publicKey === 'string' && keyRes.json.publicKey.length > 40,
      JSON.stringify(keyRes.json).slice(0, 120));

    /* ---- a lost signal ---- */
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(800);
    const offlineText = await page.locator('body').innerText();
    rec('offline: the app still opens with the network cut',
      offlineText.length > 0 && !/ERR_INTERNET_DISCONNECTED/i.test(offlineText), offlineText.slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, '2-offline.png'), fullPage: true });
    await context.setOffline(false);

    /* ---- the staff application is untouched ---- */
    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();
    await staffPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await staffPage.waitForTimeout(600);
    const staffManifest = await staffPage.locator('link[rel=manifest]').count();
    rec('staff: the staff app advertises no customer manifest', staffManifest === 0, String(staffManifest));
    const staffWorkers = await staffPage.evaluate(async () => {
      if (!navigator.serviceWorker) return 0;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length;
    });
    rec('staff: and registers no service worker of its own', staffWorkers === 0, String(staffWorkers));
    await staffCtx.close();

    rec('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } catch (err) {
    rec('the run reached the end', false, String((err && err.message) || err));
  } finally {
    await browser.close();
  }

  const pass = results.filter(Boolean).length;
  console.log(`\nTOTAL ${results.length}  PASS ${pass}  FAIL ${results.length - pass}`);
  process.exit(results.length === pass ? 0 : 1);
})();
