'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompanyWithAdmin } = require('../../src/services/companyService');
const { hashPassword, verifyPassword } = require('../../src/auth/passwordHasher');
const { createInMemoryStore } = require('./fakes');

function deps(store) {
  return {
    companyRepo: store.companyRepo,
    userWriteRepo: store.userWriteRepo,
    passwordHasher: { hashPassword, verifyPassword },
  };
}

test('createCompanyWithAdmin creates a company and exactly one admin user with a hashed password', async () => {
  const store = createInMemoryStore();
  const result = await createCompanyWithAdmin(
    {
      company: { name: 'Acme HVAC', divisions: ['HVAC'] },
      admin: { name: 'Site Admin', username: 'admin1', password: 'plain-text-password' },
    },
    deps(store)
  );

  assert.ok(result.company.id);
  assert.equal(result.company.name, 'Acme HVAC');
  assert.equal(result.admin.role, 'admin');
  assert.equal(result.admin.companyId, result.company.id);

  // The plaintext password must never appear anywhere in the returned admin object.
  assert.deepEqual(Object.keys(result.admin).sort(), ['active', 'companyId', 'id', 'name', 'role', 'username'].sort());

  // What was actually persisted has a bcrypt hash, not the plaintext.
  const persisted = store.users.find((u) => u.id === result.admin.id);
  assert.notEqual(persisted.passwordHash, 'plain-text-password');
  assert.equal(await verifyPassword('plain-text-password', persisted.passwordHash), true);
});

test('createCompanyWithAdmin rejects a duplicate username within the SAME company', async () => {
  const store = createInMemoryStore();
  await createCompanyWithAdmin(
    { company: { name: 'Acme', divisions: ['HVAC'] }, admin: { name: 'A', username: 'admin1', password: 'x' } },
    deps(store)
  );
  const company = store.companies[0];
  // Simulate a second admin-creation attempt reusing the same username in the same company.
  await assert.rejects(
    () =>
      require('../../src/services/companyService').createCompanyWithAdmin(
        { company: { name: 'Acme (dup attempt)' }, admin: { name: 'B', username: 'admin1', password: 'y' } },
        {
          ...deps(store),
          companyRepo: { create: async () => company, findById: store.companyRepo.findById }, // force same company id
        }
      ),
    /already taken/
  );
});

test('createCompanyWithAdmin requires company name and admin name/username/password', async () => {
  const store = createInMemoryStore();
  await assert.rejects(() => createCompanyWithAdmin({ company: {}, admin: { name: 'A', username: 'a', password: 'x' } }, deps(store)));
  await assert.rejects(() =>
    createCompanyWithAdmin({ company: { name: 'Acme' }, admin: { name: 'A', username: 'a' } }, deps(store))
  );
});
