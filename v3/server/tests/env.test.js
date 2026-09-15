// Unit tests for validateEnv() (PHASE 1 STEP: environment validation). Never asserts on the actual
// secret values themselves — only that missing/invalid config is rejected before the server would
// ever open a socket or a DB connection.
const { validateEnv } = require('../src/config/env');

function base() {
  return {
    NODE_ENV: 'development',
    PORT: 4002,
    MONGO_URI: 'mongodb://127.0.0.1:27017/mep_projects',
    JWT_SECRET: 'a-long-enough-dev-secret',
    JWT_EXPIRES: '30d',
    CORS_ORIGIN: '*',
  };
}

describe('validateEnv', () => {
  test('a well-formed development config passes', () => {
    expect(() => validateEnv(base())).not.toThrow();
  });

  test('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...base(), NODE_ENV: 'production-ish' })).toThrow(/NODE_ENV/);
  });

  test('rejects a non-numeric / out-of-range PORT', () => {
    expect(() => validateEnv({ ...base(), PORT: NaN })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base(), PORT: 99999 })).toThrow(/PORT/);
  });

  test('rejects a MONGO_URI that is not a mongodb connection string', () => {
    expect(() => validateEnv({ ...base(), MONGO_URI: 'postgres://localhost/db' })).toThrow(/MONGO_URI/);
  });

  test('rejects a missing or too-short JWT_SECRET', () => {
    expect(() => validateEnv({ ...base(), JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...base(), JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  test('rejects the development JWT_SECRET default when NODE_ENV is production', () => {
    expect(() => validateEnv({
      ...base(), NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-me', CORS_ORIGIN: 'https://mep-projects.spereon.codes',
    })).toThrow(/JWT_SECRET/);
  });

  test('rejects CORS_ORIGIN of "*" in production', () => {
    expect(() => validateEnv({
      ...base(), NODE_ENV: 'production', JWT_SECRET: 'a-real-production-secret-value', CORS_ORIGIN: '*',
    })).toThrow(/CORS_ORIGIN/);
  });

  test('a well-formed production config passes', () => {
    expect(() => validateEnv({
      ...base(), NODE_ENV: 'production', JWT_SECRET: 'a-real-production-secret-value', CORS_ORIGIN: 'https://mep-projects.spereon.codes',
    })).not.toThrow();
  });

  test('the error message never contains the actual secret value', () => {
    try {
      validateEnv({ ...base(), JWT_SECRET: 'abcxyz' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).not.toMatch(/abcxyz/);
    }
  });
});
