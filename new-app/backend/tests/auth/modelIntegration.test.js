'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Company, User, AuthSession } = require('../../src/models');

const oid = () => new mongoose.Types.ObjectId();

// 1. Company model validation (auth-relevant slice — full coverage already
// lives in tests/validation.test.js and tests/models.test.js; not duplicated here).
test('1. Company model requires the fields needed to bootstrap a tenant', () => {
  const c = new Company({});
  const err = c.validateSync();
  assert.ok(err);
  for (const f of ['name', 'divisions', 'since']) assert.ok(err.errors[f]);

  const ok = new Company({ name: 'Acme', divisions: ['HVAC'], status: 'Trial', since: new Date() });
  assert.ok(!ok.validateSync());
});

// 2. User model validation (auth-relevant slice)
test('2. User model requires passwordHash (never a plaintext password field) and a valid role', () => {
  const u = new User({});
  const err = u.validateSync();
  assert.ok(err.errors.passwordHash);
  assert.equal(User.schema.path('password'), undefined);
  assert.equal(User.schema.path('pw'), undefined);

  const ok = new User({ companyId: oid(), name: 'A', role: 'admin', username: 'a', passwordHash: 'h' });
  assert.ok(!ok.validateSync());
});

test('User.active defaults to true (schema-documented, not a PWA fact)', () => {
  const u = new User({ companyId: oid(), name: 'A', role: 'admin', username: 'a', passwordHash: 'h' });
  assert.equal(u.active, true);
});

test('users {companyId, username} unique index backs the approved NEW BACKEND username rule', () => {
  const idx = User.schema.indexes().find(([keys]) => JSON.stringify(keys) === JSON.stringify({ companyId: 1, username: 1 }));
  assert.ok(idx);
  assert.equal(idx[1].unique, true);
});

// AuthSession — new, additive collection for this task only.
test('AuthSession requires userId/role/issuedAt/expiresAt and is not one of the 15 approved collections', () => {
  const s = new AuthSession({});
  const err = s.validateSync();
  assert.ok(err);
  for (const f of ['userId', 'role', 'issuedAt', 'expiresAt']) assert.ok(err.errors[f]);
  assert.equal(AuthSession.collection.collectionName, 'authSessions');

  const ok = new AuthSession({ userId: oid(), role: 'admin', issuedAt: new Date(), expiresAt: new Date() });
  assert.ok(!ok.validateSync());
});
