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

test('it only fills projects that have no checklist at all', () => {
  // "Empty" is: no checklist array, or one with nothing in it. Nothing else.
  assert.ok(SOURCE.includes('const isEmpty = (p) => !Array.isArray(p.checklist) || p.checklist.length === 0;'));
  assert.ok(SOURCE.includes('const empty = all.filter(isEmpty);'));
  // And the thing it writes to is that set, not the whole list.
  assert.ok(SOURCE.includes('for (const p of empty)'));
  assert.ok(!/for \(const p of all\)[\s\S]{0,400}updateOne/.test(SOURCE),
    'the report loop over every project must not write');
});

/* ------------------------------------------------------------------ *
 * The report, run against real shapes
 * ------------------------------------------------------------------ */

// Requiring the script does not connect to anything: main() runs only when
// the file IS the command.
const { describeProjects, isEmpty } = require('../scripts/fill-empty-checklists');

const project = (over = {}) => ({ name: 'A site', division: 'HVAC', checklist: [], ...over });
const pts = (n) => Array.from({ length: n }, (_, i) => ({ text: `P${i}`, signResponsibility: 'ENGINEER' }));

test('an empty project is the one this script fills', () => {
  const { empty, odd, lines } = describeProjects([
    project({ name: 'Nothing on it', checklist: [] }),
    project({ name: 'No array at all', checklist: undefined }),
  ]);
  assert.equal(empty.length, 2);
  assert.equal(odd.length, 0);
  assert.ok(lines.every((l) => /EMPTY — this script fills it/.test(l)));
});

test('a project with the standard thirteen reads as ok and is left alone', () => {
  const { empty, odd, lines } = describeProjects([project({ name: 'Full', checklist: pts(13) })]);
  assert.equal(empty.length, 0);
  assert.equal(odd.length, 0);
  assert.match(lines[0], / 13 pts  Full \[HVAC\] — ok$/);
});

test('a project with FEWER points is flagged as a template winning, not filled', () => {
  // Owner, 19 Nov 2026: "not all projects showing". This is the other cause,
  // and the report has to tell it apart or the next hour is spent guessing.
  const { empty, odd, lines } = describeProjects([
    project({ name: 'Three only', checklist: pts(3), checklistTemplateName: 'Our HVAC list' }),
  ]);
  assert.equal(empty.length, 0, 'it is NOT filled — ticked work would be lost');
  assert.equal(odd.length, 1);
  assert.match(lines[0], /3 points from template "Our HVAC list", not the 13 standard/);
});

test('MEP is measured against its own eighteen, not HVAC’s thirteen', () => {
  const { odd } = describeProjects([
    project({ name: 'MEP full', division: 'MEP', checklist: pts(18) }),
    project({ name: 'MEP short', division: 'MEP', checklist: pts(13) }),
  ]);
  assert.deepEqual(odd.map((p) => p.name), ['MEP short']);
});

test('a project with no division is reported rather than crashing the run', () => {
  const { lines, odd } = describeProjects([project({ name: 'Orphan', division: undefined, checklist: pts(2) })]);
  assert.match(lines[0], /\[no division\]/);
  assert.equal(odd.length, 1, 'nothing standard to measure it against, so it is flagged');
});

test('isEmpty is exactly "no array, or an empty one"', () => {
  assert.equal(isEmpty({}), true);
  assert.equal(isEmpty({ checklist: null }), true);
  assert.equal(isEmpty({ checklist: [] }), true);
  assert.equal(isEmpty({ checklist: pts(1) }), false);
});

test('the report says where the OTHER fix lives', () => {
  assert.ok(SOURCE.includes('Checklist Template screen'));
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
