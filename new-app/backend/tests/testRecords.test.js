'use strict';

/**
 * Telling a test record from a real one (owner request, 31 Oct 2026).
 *
 * The owner asked for everything with "test" in it to go. Taken literally
 * that deletes real completed visits, because engineers write "tested and
 * working" and the checklist itself says "Cooling Testing". So the finder
 * sorts every match into NAMED (the client, site or project is called test)
 * and MENTION (the word appears only in free text), and only NAMED is
 * offered for deletion.
 *
 * That one distinction is what stands between a tidy-up and losing somebody's
 * service history, so it is tested here rather than trusted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { classify, mask } = require('../scripts/find-test-records');

const CONTRACT_NAMES = ['customer', 'site', 'contactPerson'];
const CALL_NAMES = ['customer', 'site'];

test('test records: a client actually called test is NAMED', () => {
  assert.equal(classify({ customer: 'test', site: 'test' }, CONTRACT_NAMES).kind, 'named');
  assert.equal(classify({ customer: 'TEST' }, CONTRACT_NAMES).kind, 'named');
  assert.equal(classify({ customer: 'Test Client 1' }, CONTRACT_NAMES).kind, 'named');
  assert.equal(classify({ customer: 'Acme', site: 'test site' }, CONTRACT_NAMES).kind, 'named');
});

test('test records: a real visit whose report says "tested" is only a MENTION', () => {
  const realVisit = {
    customer: 'Intervalve Poonawalla',
    site: 'KP87 plant',
    complaintDescription: 'Indoor unit leaking water',
    report: {
      serviceDescription: 'Cleared the drain line and tested the unit for an hour',
      checklistResults: { 'Cooling Testing': 'Done', 'Gas Pressure': 'Done' },
    },
  };
  const { kind, hits } = classify(realVisit, CALL_NAMES);
  assert.equal(kind, 'mention', 'this is somebody’s real work and must never be offered for deletion');
  assert.ok(hits.length >= 1, 'it is still reported, so a person can see it');
  assert.ok(hits.every((h) => !CALL_NAMES.includes(h.path)));
});

test('test records: the word inside an ordinary word does not make a record NAMED', () => {
  // "latest", "contest", "Testa" — the finder is case-insensitive and
  // substring-based by the owner's choice, so these land in MENTION unless
  // they are in a name field. A client genuinely called Testa Engineering
  // WOULD be flagged as NAMED — which is exactly why a person reads the list
  // before anything is deleted.
  assert.equal(classify({ customer: 'Acme', remark: 'latest invoice sent' }, CONTRACT_NAMES).kind, 'mention');
  assert.equal(classify({ customer: 'Testa Engineering' }, CONTRACT_NAMES).kind, 'named');
});

test('test records: a record with no "test" anywhere is not reported at all', () => {
  assert.equal(classify({ customer: 'Moto Central', site: 'Navapeth', remark: 'AMC payment' }, CONTRACT_NAMES).kind, 'none');
});

test('test records: it looks inside nested fields and arrays, not only the top level', () => {
  const doc = {
    customer: 'Acme',
    partsWork: [{ part: 'Thermostat', action: 'Replaced', remark: 'test piece fitted' }],
  };
  const { kind, hits } = classify(doc, CONTRACT_NAMES);
  assert.equal(kind, 'mention');
  assert.equal(hits[0].path, 'partsWork[0].remark');
});

test('test records: secrets and images are never read, let alone printed', () => {
  const doc = {
    customer: 'test',
    passwordHash: '$2b$10$testhashtesthash',
    clientSignatureImage: 'data:image/png;base64,testtesttest',
    data: 'testtesttest',
    token: 'test-token',
  };
  const { hits } = classify(doc, CONTRACT_NAMES);
  assert.deepEqual(hits.map((h) => h.path), ['customer'], 'only the name is read');
});

test('test records: a phone number is masked before it is printed', () => {
  assert.equal(mask('9422011111'), '94••••11');
  assert.ok(!mask('9422011111').includes('220'), 'the middle of the number does not reach the screen');
});
