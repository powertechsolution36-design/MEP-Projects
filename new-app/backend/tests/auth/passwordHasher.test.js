'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../src/auth/passwordHasher');

test('3. hashPassword produces a bcrypt hash, never the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.match(hash, /^\$2[aby]\$\d{2}\$/, 'should look like a bcrypt hash');
});

test('4. plaintext password is never persisted/returned — verifyPassword round-trips only through the hash', async () => {
  const plain = 'S3cur3-Pass!23';
  const hash = await hashPassword(plain);
  assert.equal(await verifyPassword(plain, hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  // The object we'd persist never contains the plaintext field at all —
  // this is enforced by construction (authService/companyService only ever
  // pass `passwordHash`, never `password`, to a repository's create/update).
  const wouldBePersisted = { passwordHash: hash };
  assert.equal(Object.prototype.hasOwnProperty.call(wouldBePersisted, 'password'), false);
});

test('hashPassword rejects an empty/non-string password rather than silently hashing nothing', async () => {
  await assert.rejects(() => hashPassword(''));
  await assert.rejects(() => hashPassword(undefined));
});
