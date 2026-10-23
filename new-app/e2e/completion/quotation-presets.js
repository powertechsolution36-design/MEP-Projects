'use strict';
/**
 * Built-in quotation starting points, in the browser at phone size
 * (owner request, 23 Oct 2026).
 *
 *   1. cd new-app/frontend && npm run build
 *   2. node e2e/completion/server.js        (port 4100; restart before each run)
 *   3. node e2e/completion/quotation-presets.js
 *
 * Checks what the backend tests cannot: that picking an offer type actually
 * fills the form in, that switching type replaces the rows rather than mixing
 * them, that no price is ever prefilled, and that "Start from blank" clears up.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4100';
const SHOTS = path.join(__dirname, 'shots-quotation-presets');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('label:has-text("Username") input').fill('sales');
    await page.locator('label:has-text("Password") input').fill('password123');
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 15000 });

    await page.goto(`${BASE}/quotations/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // Everything the user can see, including what is typed into inputs.
    const shown = async () => {
      const values = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value).join('\n'));
      return `${values}\n${await page.locator('body').innerText()}`;
    };

    const types = await page.locator('.offer-type-name').allInnerTexts();
    rec('the four offer types are offered, plus a blank start',
      JSON.stringify(types) === JSON.stringify(['Split AC offer', 'Ducted AC offer', 'VRF AC offer', 'Solar on-grid offer', 'Start from blank']),
      JSON.stringify(types));
    await page.screenshot({ path: path.join(SHOTS, '1-types.png'), fullPage: true });

    // Ducted: headings, sub-rows and its own accessory list.
    await page.locator('.offer-type:has-text("Ducted AC offer")').click();
    await page.waitForTimeout(400);
    const ducted = await shown();
    rec('ducted fills in its own rows, headings included',
      ducted.includes('OUTDOOR UNITS') && ducted.includes('INDOOR UNITS') && ducted.includes('24 G') && ducted.includes('Jet Nozzle'));
    rec('picking a type sets its division',
      (await page.locator('label:has-text("Division") select').first().inputValue()) === 'HVAC');
    rec('no price is ever prefilled', !/\b42600\b|\b271980\b|\b844800\b/.test(ducted));
    await page.screenshot({ path: path.join(SHOTS, '2-ducted.png'), fullPage: true });

    // VRF must REPLACE the Ducted rows, not merge with them.
    await page.locator('.offer-type:has-text("VRF AC offer")').click();
    await page.waitForTimeout(400);
    const vrf = await shown();
    rec('switching to VRF replaces the rows rather than mixing them',
      vrf.includes('Copper Refnet Joints') && !vrf.includes('Jet Nozzle'));

    // Solar is a different division and a different table shape.
    await page.locator('.offer-type:has-text("Solar on-grid offer")').click();
    await page.waitForTimeout(400);
    const solar = await shown();
    rec('solar fills in its own equipment table',
      solar.includes('Deye 5kW ongrid Inverter') && solar.includes('Mono Crystalline - 550 Wp') && !solar.includes('Copper Refnet'));
    rec('solar switches the division too',
      (await page.locator('label:has-text("Division") select').first().inputValue()) === 'Solar');
    await page.screenshot({ path: path.join(SHOTS, '3-solar.png'), fullPage: true });

    // Blank must clear what a preset filled in.
    await page.locator('.offer-type:has-text("Start from blank")').click();
    await page.waitForTimeout(400);
    const blank = await shown();
    rec('"start from blank" clears a preset that was applied',
      !blank.includes('Deye 5kW ongrid Inverter') && !blank.includes('OUTDOOR UNITS'));

    rec('no page errors', errors.length === 0, errors.join(' | '));
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
