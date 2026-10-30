'use strict';
/**
 * Customer portal, end to end at phone size (owner decision, 27 Oct 2026).
 *
 *   1. cd new-app/frontend && npm run build
 *   2. node e2e/completion/server.js        (port 4100; restart before each run)
 *   3. node e2e/completion/customer-portal.js
 *
 * Walks the whole journey in a real browser: a client registers, is refused
 * until staff approve them, signs in, raises a complaint with a photograph,
 * and follows it while staff assign an engineer and complete it. It then
 * covers project progress (owner decision, 30 Oct 2026): staff link a
 * project to the account, and the client sees its stage, its timeline and
 * only the updates a PM published. Also checks the things that must NOT
 * work from a browser — reaching a staff screen with a client session,
 * seeing another client's complaint, and seeing a project nobody linked.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4100';
const SHOTS = path.join(__dirname, 'shots-portal');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

const CLIENT_PW = 'client-password-1';
// A real 1x1 PNG, written to disk so the file chooser has something genuine.
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const staff = (await api('POST', '/api/auth/login', { body: { username: 'service', password: 'password123' } })).json.token;
    // The demo contract (fixture.js) — its phone is what the client registers with.
    const contract = (await api('GET', '/api/contracts/amc_demo', { token: staff })).json;
    const phone = (contract.contract || contract).phone;
    rec('fixture: the demo AMC client has a phone number to register with', Boolean(phone), String(phone));

    /* ---- register ---- */
    await page.goto(`${BASE}/portal/register`, { waitUntil: 'networkidle' });
    await page.locator('label:has-text("Your name") input').fill('Mr Poonawalla');
    await page.locator('label:has-text("Mobile number") input').fill(phone);
    await page.locator('label:has-text("Choose a password") input').fill(CLIENT_PW);
    await page.locator('button[type=submit]').click();
    await page.waitForTimeout(600);
    rec('register: the client is told staff will check their details',
      (await page.locator('body').innerText()).includes('Thank you'));
    await page.screenshot({ path: path.join(SHOTS, '1-registered.png'), fullPage: true });

    /* ---- refused until approved ---- */
    await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
    const signIn = async () => {
      await page.locator('label:has-text("Mobile number") input').fill(phone);
      await page.locator('label:has-text("Password") input').fill(CLIENT_PW);
      await page.locator('button[type=submit]').click();
      await page.waitForTimeout(700);
    };
    await signIn();
    rec('login: a pending account is refused, and told why',
      /waiting to be activated/i.test(await page.locator('body').innerText()));

    /* ---- staff approve ---- */
    // A separate browser context: a real client's browser holds no staff
    // session, and sharing one here would hand the client page a staff token
    // through localStorage.
    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();
    await staffPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await staffPage.locator('label:has-text("Username") input').fill('service');
    await staffPage.locator('label:has-text("Password") input').fill('password123');
    await staffPage.locator('button[type=submit]').click();
    await staffPage.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 15000 });
    await staffPage.goto(`${BASE}/customer-accounts`, { waitUntil: 'networkidle' });
    await staffPage.waitForTimeout(600);
    const staffText = await staffPage.locator('body').innerText();
    rec('staff: the registration is waiting, with the client it matched',
      staffText.includes('Mr Poonawalla') && staffText.includes('Intervalve Poonawalla'), staffText.slice(0, 160));
    await staffPage.screenshot({ path: path.join(SHOTS, '2-staff-review.png'), fullPage: true });
    await staffPage.locator('button:has-text("Approve")').first().click();
    await staffPage.waitForTimeout(800);
    rec('staff: approving marks the login Active',
      (await staffPage.locator('body').innerText()).includes('Active'));

    /* ---- sign in and raise a complaint ---- */
    await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
    await signIn();
    const dash = await page.locator('body').innerText();
    rec('login: an approved client reaches their dashboard',
      dash.includes('Your service') && dash.includes('KP87'), dash.slice(0, 160));
    await page.screenshot({ path: path.join(SHOTS, '3-dashboard.png'), fullPage: true });

    await page.locator('a:has-text("Raise a complaint")').click();
    await page.waitForTimeout(500);
    await page.locator('label:has-text("What is the problem?") textarea').fill('Indoor unit is leaking water onto the floor');
    await page.locator('input[type=file]').setInputFiles(PNG_PATH);
    await page.waitForTimeout(400);
    rec('complaint: the chosen photograph is previewed before sending',
      (await page.locator('.portal-thumb img').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, '4-new-complaint.png'), fullPage: true });
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/portal\/complaints\/[^/]+$/, { timeout: 10000 });
    await page.waitForTimeout(900);
    const detail = await page.locator('body').innerText();
    rec('complaint: it is created, numbered and shown as Registered',
      /PSC-\d+/.test(detail) && detail.includes('Registered') && detail.includes('leaking water'), detail.slice(0, 200));
    rec('complaint: the photograph is served back behind the session',
      (await page.locator('.portal-thumb img').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, '5-complaint-detail.png'), fullPage: true });

    const callId = page.url().split('/').pop();

    /* ---- staff see it, with the photograph ---- */
    const made = (await api('GET', '/api/service-calls', { token: staff })).json;
    const list = made.serviceCalls || made.calls || [];
    const mine = list.find((c) => String(c.id) === String(callId));
    rec('staff: the complaint appears on the service-call list, marked as the client’s',
      Boolean(mine) && mine.source === 'Customer', mine ? mine.source : 'not found');
    const atts = await api('GET', `/api/service-calls/${callId}/attachments`, { token: staff });
    rec('staff: the photograph is listed against the call', atts.status === 200 && atts.json.attachments.length === 1);

    /* ---- staff assign and complete; the client follows it ---- */
    await api('PUT', `/api/service-calls/${callId}/assign`, {
      token: staff, body: { engineerId: 'seed_user_6', appointmentDate: '2026-11-05', appointmentTime: '11:00' },
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const assigned = await page.locator('body').innerText();
    rec('client: sees the engineer and the appointment once staff set them',
      assigned.includes('Vinod') && /05\/11\/2026|2026-11-05|5 Nov/i.test(assigned) && assigned.includes('11:00'),
      assigned.slice(0, 240));

    await api('POST', `/api/service-calls/${callId}/complete`, {
      token: staff,
      body: {
        signature: 'data:image/png;base64,iVBORw0KGgo=',
        report: {
          serviceDescription: 'Cleared the drain and tested', engineerRemark: 'INTERNAL ONLY note',
          amount: 1800, serviceType: 'AMC',
          checklistResults: Object.fromEntries(['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'].map((k) => [k, 'Done'])),
        },
      },
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const completed = await page.locator('body').innerText();
    rec('client: sees the work once it is completed', completed.includes('Completed') && completed.includes('Cleared the drain'));
    rec('client: never sees the internal remark or the amount',
      !completed.includes('INTERNAL ONLY') && !completed.includes('1800'), completed.slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS, '6-completed.png'), fullPage: true });


    /* ---- project progress (owner decision, 30 Oct 2026) ---- */

    // Nothing is linked yet, so the dashboard must not offer a project at
    // all — not even the one whose customer name matches this client.
    await page.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const beforeLink = await page.locator('body').innerText();
    rec('client: no project is shown until staff link one', !beforeLink.includes('Your projects'), beforeLink.slice(0, 120));

    const admin = (await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'password123' } })).json.token;
    const accounts = (await api('GET', '/api/customer-accounts', { token: staff })).json.accounts || [];
    const myAccount = accounts.find((a) => a.status === 'Active');

    // The suggestion list should put this client's own project at the top.
    const cands = await api('GET', `/api/customer-accounts/${myAccount.id}/project-candidates`, { token: staff });
    rec('staff: the client’s own project is suggested first',
      cands.status === 200 && cands.json.projects[0] && cands.json.projects[0].id === 'prj_demo',
      JSON.stringify((cands.json.projects || []).slice(0, 2).map((x) => [x.id, x.score])));

    const linked = await api('PUT', `/api/customer-accounts/${myAccount.id}/projects`, {
      token: staff, body: { projectIds: ['prj_demo'] },
    });
    rec('staff: linking the project is recorded', linked.status === 200
      && (linked.json.account.linkedProjectIds || []).includes('prj_demo'), String(linked.status));

    // One update published for the client, in the PM's own client wording.
    const shared = await api('PATCH', '/api/projects/prj_demo/updates/0/share', {
      token: admin, body: { shared: true, customerNote: 'Ducting is about 80% done on your floor.' },
    });
    rec('PM: an update can be published to the client', shared.status === 200, String(shared.status));

    await page.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const projDash = await page.locator('body').innerText();
    rec('client: the dashboard now lists their project with its stage',
      projDash.includes('Your projects') && projDash.includes('Poonawalla KP87') && projDash.includes('Installation'),
      projDash.slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS, '7-projects.png'), fullPage: true });

    // Open it by tapping the row, the way a client would.
    await page.locator('a.portal-row:has-text("Poonawalla KP87")').first().click();
    await page.waitForURL(/\/portal\/projects\//, { timeout: 8000 });
    await page.waitForTimeout(800);
    const projPage = await page.locator('body').innerText();

    rec('client: the project page shows how far along it is',
      projPage.includes('50% complete') && projPage.includes('Installation'), projPage.slice(0, 240));
    rec('client: every stage of their division is listed, in order',
      ['Planning', 'Piping', 'Installation', 'Testing', 'Finishing', 'Completed'].every((st) => projPage.includes(st)));
    rec('client: the published update is there, in the words the PM chose',
      projPage.includes('Ducting is about 80% done on your floor.'));
    rec('client: nothing internal is on the page',
      !projPage.includes('CoolTech Fabricators')
      && !projPage.includes('Start AHU positioning')
      && !/challan/i.test(projPage),
      projPage.slice(0, 240));
    rec('client: the stage they are at is marked as current',
      (await page.locator('.portal-step.is-current').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, '8-project-detail.png'), fullPage: true });

    /* ---- photographs of the work ---- */
    // Two pictures on the published update, one on an unpublished one.
    const png = `data:image/png;base64,${PNG.toString('base64')}`;
    const putPhotos = await api('POST', '/api/projects/prj_demo/updates/0/photos', {
      token: admin,
      body: { photos: [
        { data: png, caption: 'Ducting run above the false ceiling' },
        { data: png, caption: 'AHU platform ready' },
      ] },
    });
    rec('PM: photographs can be attached to a published update',
      putPhotos.status === 201 && putPhotos.json.photos.length === 2, String(putPhotos.status));
    rec('PM: a photograph listing never carries the bytes',
      (putPhotos.json.photos || []).every((ph) => !('data' in ph)));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const withPhotos = await page.locator('body').innerText();
    rec('client: the captions are on the page',
      withPhotos.includes('Ducting run above the false ceiling') && withPhotos.includes('AHU platform ready'),
      withPhotos.slice(0, 200));
    rec('client: both photographs render', (await page.locator('.portal-photo img').count()) === 2);
    await page.screenshot({ path: path.join(SHOTS, '9-project-photos.png'), fullPage: true });

    // Tapping one opens it full size.
    await page.locator('.portal-photo').first().click();
    await page.waitForTimeout(700);
    rec('client: a photograph opens full size', (await page.locator('.portal-lightbox').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, '10-photo-full.png'), fullPage: false });
    await page.locator('.portal-lightbox button:has-text("Close")').click();
    await page.waitForTimeout(400);

    // A photograph on an update nobody published must not be reachable.
    // A fresh update is written for it, left unshared (the default).
    const internal = await api('POST', '/api/projects/prj_demo/updates', {
      token: admin, body: { actionDone: 'Snagging walk with the vendor' },
    });
    const internalIdx = (internal.json.project.executionUpdates || []).length - 1;
    const hiddenShot = await api('POST', `/api/projects/prj_demo/updates/${internalIdx}/photos`, {
      token: admin, body: { photos: [{ data: png, caption: 'Internal snag list' }] },
    });
    rec('PM: a photograph can go on an update that is not published',
      hiddenShot.status === 201, String(hiddenShot.status));
    const clientToken = await page.evaluate(() => localStorage.getItem('mep_portal_token'));
    const peek = await api('GET', `/api/portal/projects/prj_demo/photos/${hiddenShot.json.photos[0].id}`, { token: clientToken });
    rec('client: a photograph on an unpublished update is not found, even with its id',
      peek.status === 404, String(peek.status));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    rec('client: its caption is not on the page either',
      !(await page.locator('body').innerText()).includes('Internal snag list'));

    // Taking the update back removes it from the client's page.
    await api('PATCH', '/api/projects/prj_demo/updates/0/share', { token: admin, body: { shared: false } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const afterHide = await page.locator('body').innerText();
    rec('client: un-publishing an update takes it off their page',
      !afterHide.includes('Ducting is about 80% done'), afterHide.slice(0, 160));
    rec('client: and its photographs close with it',
      (await page.locator('.portal-photo').count()) === 0
      && !afterHide.includes('Ducting run above the false ceiling'));

    // And unlinking removes the project itself.
    await api('PUT', `/api/customer-accounts/${myAccount.id}/projects`, { token: staff, body: { projectIds: [] } });
    await page.goto(`${BASE}/portal/projects/prj_demo`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const afterUnlink = await page.locator('body').innerText();
    rec('client: unlinking ends their access to the project page',
      !afterUnlink.includes('Poonawalla KP87') || /not found/i.test(afterUnlink),
      afterUnlink.slice(0, 160));

    /* ---- what must not work ---- */
    await page.goto(`${BASE}/service-calls`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
    const staffScreen = await page.locator('body').innerText();
    rec('client: a staff screen sends them to the staff login, not into the app',
      page.url().includes('/login') && !page.url().includes('/portal') && !staffScreen.includes('Service Calls'),
      page.url());

    const token = await page.evaluate(() => localStorage.getItem('mep_portal_token'));
    const asStaff = await api('GET', '/api/service-calls', { token });
    rec('client: their token is refused by the staff API', asStaff.status === 401, String(asStaff.status));

    const otherCall = list.find((c) => String(c.id) !== String(callId));
    if (otherCall) {
      const peek = await api('GET', `/api/portal/complaints/${otherCall.id}`, { token });
      rec('client: another client’s complaint is not found, whatever the id', peek.status === 404, String(peek.status));
    }

    rec('no page errors', errors.length === 0, errors.join(' | '));
    await staffCtx.close();
    await ctx.close();
  } catch (err) {
    rec('the run reached the end', false, err.message);
  } finally {
    await browser.close();
    const fail = results.filter((ok) => !ok).length;
    console.log(`\nTOTAL ${results.length}  PASS ${results.length - fail}  FAIL ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
