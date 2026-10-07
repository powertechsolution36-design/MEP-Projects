'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authService = require('../../src/auth/authService');
const { hashPassword, verifyPassword } = require('../../src/auth/passwordHasher');
const { createInMemoryStore } = require('./fakes');

// No live database is opened anywhere in this file — every repository is an
// in-memory fake (see ./fakes.js) implementing the exact same interface as
// src/auth/repositories.mongoose.js.

const CONFIG = { authTokenSecret: 'test-secret', authTokenExpiry: '15m' };

async function seedStore() {
  const passwordHash = await hashPassword('correct-password');
  const store = createInMemoryStore(
    [
      { id: 'user_a1', companyId: 'company_a', name: 'Alice', username: 'alice', role: 'admin', passwordHash, active: true },
      { id: 'user_a2', companyId: 'company_a', name: 'Bob (inactive)', username: 'bob', role: 'finance', passwordHash, active: false },
      { id: 'user_b1', companyId: 'company_b', name: 'Carol', username: 'alice', role: 'admin', passwordHash, active: true }, // same username, different company
      { id: 'user_super', companyId: null, name: 'Root', username: 'root', role: 'super', passwordHash, active: true },
    ],
    [
      { id: 'company_a', name: 'Company A', divisions: ['HVAC'] },
      { id: 'company_b', name: 'Company B', divisions: ['Solar'] },
    ]
  );
  return store;
}

function deps(store) {
  return {
    userRepo: store.userRepo,
    sessionRepo: store.sessionRepo,
    passwordHasher: { hashPassword, verifyPassword },
    config: CONFIG,
  };
}

test('5. login success with correct company + username + password', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  assert.ok(result.token);
  assert.equal(result.user.username, 'alice');
  assert.equal(result.user.companyId, 'company_a');
  assert.equal(result.user.passwordHash, undefined, 'safe user must never include passwordHash');
});

test('6. wrong password is rejected with the generic message', async () => {
  const store = await seedStore();
  await assert.rejects(
    () => authService.login({ companyId: 'company_a', username: 'alice', password: 'totally-wrong' }, deps(store)),
    (err) => err instanceof authService.AuthError && err.message === authService.GENERIC_INVALID_CREDENTIALS
  );
});

test('7. unknown user is rejected with the SAME generic message (no user-enumeration leak)', async () => {
  const store = await seedStore();
  await assert.rejects(
    () => authService.login({ companyId: 'company_a', username: 'nobody', password: 'whatever' }, deps(store)),
    (err) => err instanceof authService.AuthError && err.message === authService.GENERIC_INVALID_CREDENTIALS
  );
});

test('8. inactive user is rejected (after password verifies) with a specific message', async () => {
  const store = await seedStore();
  await assert.rejects(
    () => authService.login({ companyId: 'company_a', username: 'bob', password: 'correct-password' }, deps(store)),
    (err) => err instanceof authService.AuthError && err.code === 'ACCOUNT_INACTIVE'
  );
});

test('9/11. successful login creates a session, and verifySession resolves the identity (/auth/me path)', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  const identity = await authService.verifySession(result.token, deps(store));
  assert.equal(identity.userId, 'user_a1');
  assert.equal(identity.companyId, 'company_a');
  assert.equal(identity.role, 'admin');
  assert.ok(identity.sessionId);
});

test('10. an expired session is rejected even if somehow presented', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  const identity = await authService.verifySession(result.token, deps(store));
  const raw = store.sessionRepo._getRaw(identity.sessionId);
  raw.expiresAt = new Date(Date.now() - 1000); // force expiry
  await assert.rejects(() => authService.verifySession(result.token, deps(store)), authService.AuthError);
});

test('12. verifySession rejects a missing/garbage token (unauthenticated /auth/me)', async () => {
  const store = await seedStore();
  await assert.rejects(() => authService.verifySession('not-a-real-token', deps(store)), authService.AuthError);
  await assert.rejects(() => authService.verifySession('', deps(store)), authService.AuthError);
});

test('13. logout revokes the session — a subsequent verifySession on the same token fails', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  const identity = await authService.verifySession(result.token, deps(store));
  await authService.logout(identity.sessionId, deps(store));
  await assert.rejects(() => authService.verifySession(result.token, deps(store)), authService.AuthError);
});

test('logout is idempotent — logging out twice is not an error', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  const identity = await authService.verifySession(result.token, deps(store));
  await authService.logout(identity.sessionId, deps(store));
  await assert.doesNotReject(() => authService.logout(identity.sessionId, deps(store)));
});

test('14/15. company isolation — a user cannot log in against a different company than their own', async () => {
  const store = await seedStore();
  // "bob" only exists in company_a; presenting company_b must not authenticate him.
  await assert.rejects(
    () => authService.login({ companyId: 'company_b', username: 'bob', password: 'correct-password' }, deps(store)),
    (err) => err instanceof authService.AuthError && err.message === authService.GENERIC_INVALID_CREDENTIALS
  );
  // company_a's own "bob" login still fails too, but for a DIFFERENT reason (inactive) —
  // proving this isn't a cross-company false negative, it's a real per-company lookup.
  await assert.rejects(
    () => authService.login({ companyId: 'company_a', username: 'bob', password: 'correct-password' }, deps(store)),
    (err) => err.code === 'ACCOUNT_INACTIVE'
  );
  // Both companies happen to also have a user named "alice" — logging in under
  // company_b resolves to company_b's OWN alice (Carol), never company_a's Alice
  // — the companyId in the request scopes the lookup, it does not let a client
  // pick which company's account to authenticate as by username alone.
  const result = await authService.login({ companyId: 'company_b', username: 'alice', password: 'correct-password' }, deps(store));
  assert.equal(result.user.id, 'user_b1');
  assert.equal(result.user.companyId, 'company_b');
  assert.notEqual(result.user.id, 'user_a1');
});

test('16. username uniqueness is enforced within a company (via userWriteRepo.existsByCompanyAndUsername)', async () => {
  const store = await seedStore();
  const exists = await store.userWriteRepo.existsByCompanyAndUsername('company_a', 'alice');
  assert.equal(exists, true);
  const existsOther = await store.userWriteRepo.existsByCompanyAndUsername('company_a', 'brand-new-name');
  assert.equal(existsOther, false);
});

test('17. the same username is allowed across two different companies', async () => {
  const store = await seedStore();
  const resultA = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  const resultB = await authService.login({ companyId: 'company_b', username: 'alice', password: 'correct-password' }, deps(store));
  assert.notEqual(resultA.user.id, resultB.user.id);
  assert.equal(resultA.user.companyId, 'company_a');
  assert.equal(resultB.user.companyId, 'company_b');
});

test('20. the safe auth response never includes the password hash', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: 'company_a', username: 'alice', password: 'correct-password' }, deps(store));
  assert.deepEqual(Object.keys(result.user).sort(), ['active', 'companyId', 'id', 'name', 'role', 'username'].sort());
});

test('super logs in without a companyId, scoped to role=super accounts only', async () => {
  const store = await seedStore();
  const result = await authService.login({ companyId: null, username: 'root', password: 'correct-password' }, deps(store));
  assert.equal(result.user.role, 'super');
  assert.equal(result.user.companyId, null);
});
