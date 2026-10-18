'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../src/config/env');
const authService = require('../src/auth/authService');
const { hashPassword, verifyPassword } = require('../src/auth/passwordHasher');
const { createInMemoryStore } = require('./auth/fakes');

// Session length: PWA parity. The PWA keeps its session until its backend
// rejects the token, and those backends (v2/server, v3/server) default to
// JWT_EXPIRES='30d'. The value stays configurable per environment.
test('config: AUTH_TOKEN_EXPIRY defaults to the PWA backends\' 30d and can be overridden', () => {
  assert.equal(getConfig({}).authTokenExpiry, '30d');
  assert.equal(getConfig({ AUTH_TOKEN_EXPIRY: '12h' }).authTokenExpiry, '12h');
  assert.equal(getConfig({ AUTH_TOKEN_EXPIRY: '' }).authTokenExpiry, '30d');
});

test('config: database name defaults to the new app\'s own mep_new_app (never a V2/V3/other database)', () => {
  const c = getConfig({});
  assert.equal(c.dbName, 'mep_new_app');
  for (const forbidden of ['mep_projects', 'employee-management', 'GLAMPOWER']) assert.notEqual(c.dbName, forbidden);
  assert.equal(c.port, 4000);
});

test('config: the default expiry drives both the token exp claim and the server-side session record', async () => {
  const passwordHash = await hashPassword('pw-123456');
  const store = createInMemoryStore(
    [{ id: 'u1', companyId: 'c1', name: 'A', username: 'a1', role: 'admin', passwordHash, active: true }],
    [{ id: 'c1', name: 'C1', divisions: ['HVAC'] }]
  );
  const config = { ...getConfig({}), authTokenSecret: 'test-secret' };
  const deps = { userRepo: store.userRepo, sessionRepo: store.sessionRepo, passwordHasher: { hashPassword, verifyPassword }, config };
  const before = Date.now();
  const result = await authService.login({ companyId: 'c1', username: 'a1', password: 'pw-123456' }, deps);
  const claims = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString());
  const DAY = 86400;
  assert.ok(Math.abs(claims.exp - claims.iat - 30 * DAY) <= 1, `token lifetime ${claims.exp - claims.iat}s`);
  const exp = new Date(result.expiresAt).getTime();
  assert.ok(Math.abs(exp - before - 30 * DAY * 1000) < 60000, 'session record expires with the token');
  // and the session is still verified (and revocable) on every request
  const who = await authService.verifySession(result.token, deps);
  assert.equal(who.userId, 'u1');
  await authService.logout(who.sessionId, deps);
  await assert.rejects(() => authService.verifySession(result.token, deps));
});

test('database guard: the new app refuses the other applications\' databases (mep_projects, employee-management, GLAMPOWER)', async () => {
  const { assertAllowedDatabaseName, connectToDatabase } = require('../src/db/connection');
  assert.equal(assertAllowedDatabaseName('mep_new_app'), 'mep_new_app');
  for (const bad of ['mep_projects', 'MEP_PROJECTS', 'employee-management', 'employee_management', 'GLAMPOWER', 'glampower', '']) {
    assert.throws(() => assertAllowedDatabaseName(bad), /another application|No database name/, bad || '(empty)');
  }
  // connectToDatabase refuses before any network connection is attempted.
  const saved = { uri: process.env.MONGODB_URI, db: process.env.MONGODB_DB_NAME };
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/never-used';
  process.env.MONGODB_DB_NAME = 'GLAMPOWER';
  try {
    await assert.rejects(() => connectToDatabase(), /belongs to another application/);
  } finally {
    if (saved.uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = saved.uri;
    if (saved.db === undefined) delete process.env.MONGODB_DB_NAME; else process.env.MONGODB_DB_NAME = saved.db;
  }
});

test('server start-up refuses to run without AUTH_TOKEN_SECRET (before any database connection)', async () => {
  const { start } = require('../src/server');
  const saved = process.env.AUTH_TOKEN_SECRET;
  delete process.env.AUTH_TOKEN_SECRET;
  try {
    await assert.rejects(() => start(), /AUTH_TOKEN_SECRET is not set/);
  } finally {
    if (saved !== undefined) process.env.AUTH_TOKEN_SECRET = saved;
  }
});
