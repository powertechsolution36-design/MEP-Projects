'use strict';

/**
 * FIX-6-02 — unit coverage for the shared duplicate-key error translator.
 *
 * NOTE ON SCOPE: `wrapDuplicateKeyError` is consumed by
 * `src/repositories/businessRepositories.mongoose.js` and
 * `src/auth/repositories.mongoose.js`, both of which are the real,
 * Mongoose-backed repositories that are NOT exercised by this test suite
 * (the suite injects in-memory fakes everywhere else — see those files'
 * own header comments and tests/enquiryFakes.js / tests/auth/fakes.js).
 * There is no real MongoDB available in this environment (network egress
 * for a replica-set-capable mongod is blocked — see STEP_5 /
 * STEP_6 real-MongoDB sections), so an actual E11000 from a live driver
 * cannot be produced here. This test instead verifies the translator
 * function itself against a driver-shaped error object
 * (`{ code: 11000 }`), which is the documented MongoDB duplicate-key error
 * code regardless of driver version — the only thing this test suite CAN
 * verify without a live database.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ServiceError, wrapDuplicateKeyError } = require('../src/errors');

test('wrapDuplicateKeyError — translates a MongoDB E11000-shaped error into a friendly ServiceError (409, stable code)', () => {
  const rawMongoError = new Error('E11000 duplicate key error collection: mep.projects index: companyId_1_salesOrderId_1 dup key: { companyId: ObjectId("..."), salesOrderId: ObjectId("...") }');
  rawMongoError.code = 11000;

  assert.throws(
    () => wrapDuplicateKeyError(rawMongoError, 'A project already exists for this sales order.', 'PROJECT_ALREADY_EXISTS'),
    (err) => {
      assert.ok(err instanceof ServiceError, 'should throw a ServiceError, not the raw driver error');
      assert.equal(err.status, 409);
      assert.equal(err.code, 'PROJECT_ALREADY_EXISTS');
      assert.equal(err.message, 'A project already exists for this sales order.');
      // The raw driver message/index name/ObjectId values must never leak.
      assert.ok(!/E11000|index:|dup key/.test(err.message), 'must not leak raw Mongo internals in the message');
      return true;
    }
  );
});

test('wrapDuplicateKeyError — also translates legacy code 11001 (documented alternate duplicate-key code)', () => {
  const rawMongoError = new Error('insertDocument :: caused by :: 11001 E11000 duplicate key error index');
  rawMongoError.code = 11001;

  assert.throws(
    () => wrapDuplicateKeyError(rawMongoError, 'That username is already taken in this company.', 'USERNAME_ALREADY_EXISTS'),
    (err) => err instanceof ServiceError && err.status === 409 && err.code === 'USERNAME_ALREADY_EXISTS'
  );
});

test('wrapDuplicateKeyError — re-throws any non-duplicate-key error completely unchanged', () => {
  const otherError = new Error('connection reset');
  otherError.code = 'ECONNRESET';

  assert.throws(
    () => wrapDuplicateKeyError(otherError, 'A project already exists for this sales order.', 'PROJECT_ALREADY_EXISTS'),
    (err) => err === otherError
  );
});
