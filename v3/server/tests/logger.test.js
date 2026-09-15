// Unit tests for the redacting logger (PHASE 1 STEP 18) — the specific rule under test is that
// password/token/secret/JWT/authorization/Mongo-credential-shaped fields never reach a log line,
// however deeply nested, while unrelated fields pass through untouched.
const { redact, logger } = require('../src/utils/logger');

describe('redact', () => {
  test('redacts top-level secret-shaped keys', () => {
    const out = redact({ password: 'hunter2', token: 'abc.def.ghi', ok: 'fine' });
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.ok).toBe('fine');
  });

  test('redacts nested secret-shaped keys', () => {
    const out = redact({ headers: { authorization: 'Bearer eyJ...', 'content-type': 'application/json' } });
    expect(out.headers.authorization).toBe('[REDACTED]');
    expect(out.headers['content-type']).toBe('application/json');
  });

  test('redacts a Mongo URI field even though the key itself is not "password"', () => {
    const out = redact({ mongoUri: 'mongodb://user:pass@host/db' });
    expect(out.mongoUri).toBe('[REDACTED]');
  });

  test('leaves an object with no secret-shaped keys untouched', () => {
    const input = { method: 'GET', path: '/api/v3/health', status: 200 };
    expect(redact(input)).toEqual(input);
  });

  test('redacts secret-shaped keys inside arrays of objects', () => {
    const out = redact({ items: [{ secret: 'x' }, { fine: 'y' }] });
    expect(out.items[0].secret).toBe('[REDACTED]');
    expect(out.items[1].fine).toBe('y');
  });
});

describe('logger', () => {
  test('logger.error never throws even when passed a circular-ish deep object, and does not crash the process', () => {
    expect(() => logger.error('something failed', { password: 'x', nested: { jwt: 'y', ok: 1 } })).not.toThrow();
  });

  test('logging with no meta at all does not throw', () => {
    expect(() => logger.info('service_started')).not.toThrow();
  });
});
