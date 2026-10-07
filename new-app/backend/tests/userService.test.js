'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../src/services/userService');
const authService = require('../src/auth/authService');
const { hashPassword, verifyPassword } = require('../src/auth/passwordHasher');
const { createInMemoryStore } = require('./auth/fakes');

// No live database is opened anywhere in this file — every repository is an
// in-memory fake (tests/auth/fakes.js) implementing the exact same
// interface as src/auth/repositories.mongoose.js, per this engagement's
// standing "no live database in tests" convention.

const CONFIG = { authTokenSecret: 'test-secret', authTokenExpiry: '15m' };

function deps(store) {
  return {
    companyRepo: store.companyRepo,
    userWriteRepo: store.userWriteRepo,
    passwordHasher: { hashPassword, verifyPassword },
  };
}

function authDeps(store) {
  return {
    userRepo: store.userRepo,
    sessionRepo: store.sessionRepo,
    passwordHasher: { hashPassword, verifyPassword },
    config: CONFIG,
  };
}

function auth(overrides) {
  return { userId: 'admin1', companyId: 'co1', role: 'admin', name: 'Company Admin', ...overrides };
}

async function seedStore() {
  const passwordHash = await hashPassword('admin-pass');
  const store = createInMemoryStore(
    [{ id: 'admin1', companyId: 'co1', name: 'Company Admin', username: 'admin1', role: 'admin', passwordHash, active: true }],
    [
      { id: 'co1', name: 'Powertech Solution', divisions: ['HVAC', 'Solar', 'MEP'] },
      { id: 'co2', name: 'Other Co', divisions: ['HVAC'] },
    ]
  );
  return store;
}

/* ================= authorization ================= */

test('FIX-3.8-01 — only admin may list/create/edit/delete Users (PWA: only admin\'s MENUS has "users")', async () => {
  const store = await seedStore();
  const nonAdminRoles = ['sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance'];
  for (const role of nonAdminRoles) {
    const actor = auth({ userId: `u_${role}`, role });
    await assert.rejects(() => userService.listUsers(actor, deps(store)), /FORBIDDEN|not permitted/);
    await assert.rejects(
      () => userService.createUser({ name: 'X', username: 'x1', password: 'pw123456', role: 'sales' }, actor, deps(store)),
      /FORBIDDEN|not permitted/
    );
  }
  // admin itself is allowed
  const list = await userService.listUsers(auth(), deps(store));
  assert.equal(list.length, 1);
});

/* ================= create ================= */

test('createUser — creates a hashed-password user, never returns the plaintext or the hash', async () => {
  const store = await seedStore();
  const user = await userService.createUser(
    { name: 'Priya Sales', username: 'priya', password: 'plain-text-pw', role: 'sales' },
    auth(),
    deps(store)
  );
  assert.equal(user.role, 'sales');
  assert.equal(user.companyId, 'co1');
  assert.deepEqual(Object.keys(user).sort(), ['active', 'companyId', 'id', 'name', 'role', 'username'].sort());

  const persisted = store.users.find((u) => u.id === user.id);
  assert.notEqual(persisted.passwordHash, 'plain-text-pw');
  assert.equal(await verifyPassword('plain-text-pw', persisted.passwordHash), true);
});

test('createUser — name, username, password, role are all required (PWA FACT: saveUser requires name+username; password/role required by this backend\'s hashing/role-model)', async () => {
  const store = await seedStore();
  await assert.rejects(() => userService.createUser({ username: 'x', password: 'pw123456', role: 'sales' }, auth(), deps(store)), /Name is required/);
  await assert.rejects(() => userService.createUser({ name: 'X', password: 'pw123456', role: 'sales' }, auth(), deps(store)), /Username is required/);
  await assert.rejects(() => userService.createUser({ name: 'X', username: 'x', role: 'sales' }, auth(), deps(store)), /Password is required/);
  await assert.rejects(() => userService.createUser({ name: 'X', username: 'x', password: 'pw123456' }, auth(), deps(store)), /Role is required/);
});

test('createUser — role "super" cannot be assigned (PWA FACT: mUser\'s role <select> explicitly skips "super")', async () => {
  const store = await seedStore();
  await assert.rejects(
    () => userService.createUser({ name: 'X', username: 'x', password: 'pw123456', role: 'super' }, auth(), deps(store)),
    /cannot be assigned/
  );
});

test('createUser — a PM role is rejected if the company does not subscribe to that division (PWA FACT: mUser\'s role <select> filters via hasDiv)', async () => {
  const store = await seedStore();
  const co2Admin = auth({ userId: 'admin2', companyId: 'co2' });
  await assert.rejects(
    () => userService.createUser({ name: 'X', username: 'x', password: 'pw123456', role: 'solar_pm' }, co2Admin, deps(store)),
    /requires the company to subscribe/
  );
  // hvac_pm is fine for co2 (subscribes to HVAC)
  const user = await userService.createUser({ name: 'X', username: 'x', password: 'pw123456', role: 'hvac_pm' }, co2Admin, deps(store));
  assert.equal(user.role, 'hvac_pm');
});

test('createUser — duplicate username within the SAME company is rejected; the SAME username in a DIFFERENT company is fine', async () => {
  const store = await seedStore();
  await userService.createUser({ name: 'A', username: 'dupe', password: 'pw123456', role: 'sales' }, auth(), deps(store));
  await assert.rejects(
    () => userService.createUser({ name: 'B', username: 'dupe', password: 'pw123456', role: 'finance' }, auth(), deps(store)),
    /already taken/
  );
  const otherCoAdmin = auth({ userId: 'admin2', companyId: 'co2' });
  const ok = await userService.createUser({ name: 'C', username: 'dupe', password: 'pw123456', role: 'hvac_pm' }, otherCoAdmin, deps(store));
  assert.equal(ok.username, 'dupe');
});

/* ================= list / get ================= */

test('listUsers / getUser — tenant isolation: a company only ever sees its own users', async () => {
  const store = await seedStore();
  const otherCoAdmin = auth({ userId: 'admin2', companyId: 'co2' });
  await userService.createUser({ name: 'C', username: 'carol', password: 'pw123456', role: 'hvac_pm' }, otherCoAdmin, deps(store));

  const co1Users = await userService.listUsers(auth(), deps(store));
  assert.deepEqual(co1Users.map((u) => u.username).sort(), ['admin1']);

  const co2Users = await userService.listUsers(otherCoAdmin, deps(store));
  assert.deepEqual(co2Users.map((u) => u.username).sort(), ['carol']);

  const carol = co2Users[0];
  await assert.rejects(() => userService.getUser(carol.id, auth(), deps(store)), /not found/i); // co1 admin can't read co2's user
  const found = await userService.getUser(carol.id, otherCoAdmin, deps(store));
  assert.equal(found.username, 'carol');
});

/* ================= update / role reassignment ================= */

test('updateUser — edits name/username, reassigns role (subject to the same division check), and can change the password', async () => {
  const store = await seedStore();
  const created = await userService.createUser({ name: 'Sam', username: 'sam', password: 'pw123456', role: 'sales' }, auth(), deps(store));

  const renamed = await userService.updateUser(created.id, { name: 'Samuel' }, auth(), deps(store));
  assert.equal(renamed.name, 'Samuel');

  const reassigned = await userService.updateUser(created.id, { role: 'hvac_pm' }, auth(), deps(store));
  assert.equal(reassigned.role, 'hvac_pm');

  await assert.rejects(() => userService.updateUser(created.id, { role: 'super' }, auth(), deps(store)), /cannot be assigned/);

  const before = store.users.find((u) => u.id === created.id).passwordHash;
  await userService.updateUser(created.id, { password: 'new-password-1' }, auth(), deps(store));
  const after = store.users.find((u) => u.id === created.id).passwordHash;
  assert.notEqual(before, after);
  assert.equal(await verifyPassword('new-password-1', after), true);
});

test('updateUser — omitting the password field leaves the existing hash untouched (PWA-analog of "didn\'t touch the password field")', async () => {
  const store = await seedStore();
  const created = await userService.createUser({ name: 'Sam', username: 'sam', password: 'pw123456', role: 'sales' }, auth(), deps(store));
  const beforeHash = store.users.find((u) => u.id === created.id).passwordHash;
  await userService.updateUser(created.id, { name: 'Samuel' }, auth(), deps(store));
  const afterHash = store.users.find((u) => u.id === created.id).passwordHash;
  assert.equal(beforeHash, afterHash);
});

test('updateUser — renaming to a username already taken by ANOTHER user in the same company is rejected; renaming to your own current username is a no-op success', async () => {
  const store = await seedStore();
  const a = await userService.createUser({ name: 'A', username: 'alice', password: 'pw123456', role: 'sales' }, auth(), deps(store));
  await userService.createUser({ name: 'B', username: 'bob', password: 'pw123456', role: 'finance' }, auth(), deps(store));
  await assert.rejects(() => userService.updateUser(a.id, { username: 'bob' }, auth(), deps(store)), /already taken/);
  const unchanged = await userService.updateUser(a.id, { username: 'alice' }, auth(), deps(store));
  assert.equal(unchanged.username, 'alice');
});

test('updateUser — tenant isolation: admin cannot edit another company\'s user', async () => {
  const store = await seedStore();
  const otherCoAdmin = auth({ userId: 'admin2', companyId: 'co2' });
  const carol = await userService.createUser({ name: 'C', username: 'carol', password: 'pw123456', role: 'hvac_pm' }, otherCoAdmin, deps(store));
  await assert.rejects(() => userService.updateUser(carol.id, { name: 'Hacked' }, auth(), deps(store)), /not found/i);
});

/* ================= delete ================= */

test('deleteUser — hard delete, no cascade (PWA FACT: delUser is unconditional array-filter, no other collection touched)', async () => {
  const store = await seedStore();
  const created = await userService.createUser({ name: 'Sam', username: 'sam', password: 'pw123456', role: 'sales' }, auth(), deps(store));
  const result = await userService.deleteUser(created.id, auth(), deps(store));
  assert.deepEqual(result, { deleted: true, id: created.id });
  assert.equal(store.users.find((u) => u.id === created.id), undefined);
});

test('deleteUser — an admin cannot remove their own login (server-side enforcement of the PWA\'s UI-only "u.id!==U.id" intent)', async () => {
  const store = await seedStore();
  await assert.rejects(() => userService.deleteUser('admin1', auth(), deps(store)), /cannot remove your own login/);
  assert.ok(store.users.find((u) => u.id === 'admin1')); // still present
});

test('deleteUser — tenant isolation: admin cannot delete another company\'s user', async () => {
  const store = await seedStore();
  const otherCoAdmin = auth({ userId: 'admin2', companyId: 'co2' });
  const carol = await userService.createUser({ name: 'C', username: 'carol', password: 'pw123456', role: 'hvac_pm' }, otherCoAdmin, deps(store));
  await assert.rejects(() => userService.deleteUser(carol.id, auth(), deps(store)), /not found/i);
  assert.ok(store.users.find((u) => u.id === carol.id));
});

/* ================= login integration ================= */

test('a newly-created user can log in with the password they were created with, and gets the correct role/company session', async () => {
  const store = await seedStore();
  await userService.createUser({ name: 'Priya Sales', username: 'priya', password: 'correct-horse', role: 'sales' }, auth(), deps(store));

  const result = await authService.login({ companyId: 'co1', username: 'priya', password: 'correct-horse' }, authDeps(store));
  assert.ok(result.token);
  assert.equal(result.user.role, 'sales');
  assert.equal(result.user.companyId, 'co1');

  await assert.rejects(
    () => authService.login({ companyId: 'co1', username: 'priya', password: 'wrong-password' }, authDeps(store)),
    authService.AuthError
  );
});

test('a user whose password was changed via updateUser can log in with the NEW password, not the old one', async () => {
  const store = await seedStore();
  const created = await userService.createUser({ name: 'Priya Sales', username: 'priya', password: 'old-pass-1', role: 'sales' }, auth(), deps(store));
  await userService.updateUser(created.id, { password: 'new-pass-2' }, auth(), deps(store));

  await assert.rejects(
    () => authService.login({ companyId: 'co1', username: 'priya', password: 'old-pass-1' }, authDeps(store)),
    authService.AuthError
  );
  const result = await authService.login({ companyId: 'co1', username: 'priya', password: 'new-pass-2' }, authDeps(store));
  assert.equal(result.user.username, 'priya');
});

test('a deleted user can no longer log in', async () => {
  const store = await seedStore();
  const created = await userService.createUser({ name: 'Priya Sales', username: 'priya', password: 'pw123456', role: 'sales' }, auth(), deps(store));
  await userService.deleteUser(created.id, auth(), deps(store));
  await assert.rejects(
    () => authService.login({ companyId: 'co1', username: 'priya', password: 'pw123456' }, authDeps(store)),
    authService.AuthError
  );
});
