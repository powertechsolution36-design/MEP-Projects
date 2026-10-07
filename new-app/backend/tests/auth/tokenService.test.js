'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signAccessToken, verifyAccessToken } = require('../../src/auth/tokenService');

const SECRET = 'test-secret-do-not-use-in-real-env';

test('9. signAccessToken/verifyAccessToken round-trip the session claims', () => {
  const token = signAccessToken({ sub: 'user_1', companyId: 'company_1', role: 'admin', sid: 'session_1' }, SECRET, '15m');
  const claims = verifyAccessToken(token, SECRET);
  assert.equal(claims.sub, 'user_1');
  assert.equal(claims.companyId, 'company_1');
  assert.equal(claims.role, 'admin');
  assert.equal(claims.sid, 'session_1');
  assert.ok(claims.exp > claims.iat, 'exp should be after iat');
});

test('10. an expired token is rejected (no real waiting required)', () => {
  // A negative expiresIn produces a token whose `exp` is already in the past.
  const token = signAccessToken({ sub: 'user_1', companyId: null, role: 'super', sid: 'session_1' }, SECRET, -10);
  assert.throws(() => verifyAccessToken(token, SECRET), /jwt expired/i);
});

test('a token signed with a different secret is rejected', () => {
  const token = signAccessToken({ sub: 'user_1', companyId: 'c1', role: 'admin', sid: 's1' }, SECRET, '15m');
  assert.throws(() => verifyAccessToken(token, 'a-completely-different-secret'));
});

test('signing without a secret is refused rather than silently using a default', () => {
  assert.throws(() => signAccessToken({ sub: 'u' }, '', '15m'));
  assert.throws(() => verifyAccessToken('whatever', ''));
});
