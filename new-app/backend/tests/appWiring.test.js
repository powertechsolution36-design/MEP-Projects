'use strict';

/**
 * Every repository reaches the real server (guard added 31 Oct 2026).
 *
 * WHY THIS EXISTS. Project photographs and portal invite links were written,
 * tested against the dev server, reviewed and deployed — and did not work in
 * production, because `projectPhotoRepo` and `portalInviteRepo` were wired
 * into src/devServer.js and never into src/app.js. Nothing failed at start-up
 * and no test noticed: the service code reads `deps.projectPhotoRepo`, which
 * was simply `undefined`, so the first client to use the feature got a 500.
 *
 * A repository that exists but is not handed to the production app is a
 * feature that only works on a developer's machine. This test makes that a
 * failure here rather than a discovery in the field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositories = require('../src/repositories/businessRepositories.mongoose');

const APP = path.join(__dirname, '..', 'src', 'app.js');
const DEV = path.join(__dirname, '..', 'src', 'devServer.js');

/** The names src/app.js actually puts into businessDeps. */
function depsNamesIn(source) {
  const start = source.indexOf('const businessDeps = {');
  assert.ok(start > -1, 'src/app.js should build a businessDeps object');
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, 'businessDeps should be a closed object literal');
  return new Set(
    source.slice(start, end)
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => /^[A-Za-z_$][\w$]*$/.test(line))
  );
}

test('wiring: every business repository is handed to the production app', () => {
  const source = fs.readFileSync(APP, 'utf8');
  const wired = depsNamesIn(source);

  const missing = Object.keys(repositories).filter((name) => name.endsWith('Repo') && !wired.has(name));
  assert.deepEqual(
    missing,
    [],
    `these repositories are exported but never reach src/app.js, so every feature using one answers 500 in production: ${missing.join(', ')}`
  );
});

test('wiring: the dev server offers the same repositories as the real one', () => {
  const dev = fs.readFileSync(DEV, 'utf8');
  const app = fs.readFileSync(APP, 'utf8');
  const wired = depsNamesIn(app);

  // The reverse of the bug above: something available only in production
  // would mean the tests exercise a different application from the one that
  // ships. The dev server builds its deps from a fake store, so the check is
  // by name rather than by object.
  const notInDev = [...wired].filter((name) => name.endsWith('Repo') && !new RegExp(`\\b${name}\\b`).test(dev));
  assert.deepEqual(notInDev, [], `wired into src/app.js but absent from the dev server: ${notInDev.join(', ')}`);
});
