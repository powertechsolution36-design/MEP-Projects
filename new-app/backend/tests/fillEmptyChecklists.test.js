'use strict';

/**
 * The backfill script that gives already-created projects the standard
 * points (owner request, 18 Nov 2026).
 *
 * The script itself talks to MongoDB, which these tests do not. What they
 * cover is the part that decides WHAT it writes — the query that picks the
 * projects, and the shape of a point — because those are what could damage
 * real work if they were wrong.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fill-empty-checklists.js'), 'utf8');
const { LEGACY_CHECKLIST_FALLBACK } = require('../src/models/shared/legacyChecklists');

test('it writes nothing unless it is asked to', () => {
  assert.ok(SOURCE.includes("const APPLY = process.argv.includes('--apply');"));
  // Every write is behind that flag.
  const writes = SOURCE.split('\n').filter((l) => l.includes('updateOne('));
  assert.equal(writes.length, 1, 'exactly one write in the whole script');
  const before = SOURCE.slice(0, SOURCE.indexOf('updateOne('));
  assert.ok(before.lastIndexOf('if (APPLY)') > before.lastIndexOf('for (const p of empty)'),
    'and it sits inside the APPLY branch');
});

test('it only looks at projects that have no checklist at all', () => {
  assert.ok(SOURCE.includes("{ checklist: { $exists: false } }"));
  assert.ok(SOURCE.includes("{ checklist: { $size: 0 } }"));
  // A project with points — however few — must not be in the net.
  assert.ok(!/\$size:\s*[1-9]/.test(SOURCE));
});

test('it writes only the checklist and its name, never anything else', () => {
  const set = SOURCE.slice(SOURCE.indexOf('{ $set:'), SOURCE.indexOf('{ $set:') + 120);
  assert.ok(set.includes('checklist:'));
  assert.ok(set.includes('checklistTemplateName:'));
  assert.ok(!set.includes('stage'), 'the stage is not the backfill’s business');
  assert.ok(!set.includes('status'));
});

test('it touches one collection and one only', () => {
  const collections = [...SOURCE.matchAll(/\.collection\('([a-zA-Z]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(collections)], ['projects']);
});

test('the standard points it would write are the real ones', () => {
  assert.equal(LEGACY_CHECKLIST_FALLBACK.HVAC.length, 13);
  assert.equal(LEGACY_CHECKLIST_FALLBACK.Solar.length, 13);
  assert.ok(LEGACY_CHECKLIST_FALLBACK.MEP.length > 0);
  for (const [division, points] of Object.entries(LEGACY_CHECKLIST_FALLBACK)) {
    for (const p of points) {
      assert.ok(p.text && p.text.trim(), `${division}: every point says something`);
      assert.ok(p.signResponsibility, `${division}: every point says who signs it`);
    }
  }
});

test('a point is written fresh — nothing done, signed, dated or approved', () => {
  const fresh = SOURCE.slice(SOURCE.indexOf('const freshPoint'), SOURCE.indexOf('async function main'));
  for (const pair of ['done: false', 'completedDate: null', 'pmSigned: false', "remark: ''", 'photos: []', 'targetDate: null', 'approval: null']) {
    assert.ok(fresh.includes(pair), `a fresh point sets ${pair}`);
  }
});

test('a division with no standard list is reported, not guessed at', () => {
  assert.ok(SOURCE.includes('no standard list for this division, left alone'));
});
