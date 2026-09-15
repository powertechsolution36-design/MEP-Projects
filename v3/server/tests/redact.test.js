// Phase 4 — sensitive-data redaction for PERSISTED snapshots (V3 PHASE 4 spec §19).
// "The audit/correction layer must never persist: password, pw, JWT, token, secret, authorization
// header, credit card data, database credentials. Add tests for nested sensitive values."
const { redact, isSensitiveKey, findSensitivePaths, REDACTED } = require('../src/utils/redact');

describe('§19 — every named sensitive key is recognized', () => {
  const NAMED = [
    'password', 'pw', 'pwd', 'jwt', 'token', 'accessToken', 'refreshToken',
    'secret', 'clientSecret', 'authorization', 'Authorization',
    'creditCard', 'credit_card', 'cardNumber', 'card-number', 'cvv',
    'dbPassword', 'DATABASE_URL', 'mongoUri', 'MONGO_URI', 'connectionString',
    'apiKey', 'API_KEY', 'privateKey',
  ];
  test.each(NAMED)('"%s" is treated as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });
});

describe('short keys match exactly, never as a substring', () => {
  test('"pw" is sensitive but "pwaEnabled" is not', () => {
    expect(isSensitiveKey('pw')).toBe(true);
    expect(isSensitiveKey('pwaEnabled')).toBe(false);
  });

  test('"auth" is sensitive but "authorId" / "authorName" are not', () => {
    expect(isSensitiveKey('auth')).toBe(true);
    expect(isSensitiveKey('authorId')).toBe(false);
    expect(isSensitiveKey('authorName')).toBe(false);
  });

  test('ordinary business fields are never redacted', () => {
    for (const key of ['amount', 'quantity', 'projectId', 'division', 'status', 'createdByUserId', 'passengerCount']) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe('nested sensitive values (explicitly required by §19)', () => {
  test('redacts at depth 1', () => {
    const out = redact({ user: { name: 'Asha', password: 'hunter2' } });
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.name).toBe('Asha');
  });

  test('redacts deeply nested values several levels down', () => {
    const out = redact({ a: { b: { c: { d: { authorization: 'Bearer eyJhbGciOi...' } } } } });
    expect(out.a.b.c.d.authorization).toBe(REDACTED);
  });

  test('redacts inside arrays of objects', () => {
    const out = redact({ integrations: [{ name: 'x', apiKey: 'k1' }, { name: 'y', apiKey: 'k2' }] });
    expect(out.integrations[0].apiKey).toBe(REDACTED);
    expect(out.integrations[1].apiKey).toBe(REDACTED);
    expect(out.integrations[0].name).toBe('x');
  });

  test('redacts a whole nested object held under a sensitive key', () => {
    const out = redact({ credentials: { user: 'root', pass: 'x' } });
    expect(out.credentials).toBe(REDACTED);
  });

  test('findSensitivePaths reports nothing left over after redaction, at any depth', () => {
    const payload = {
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      db: { mongoUri: 'mongodb://u:p@h/db' },
      billing: { cards: [{ cardNumber: '4111111111111111', cvv: '123', last4: '1111' }] },
      nested: { deep: { deeper: { jwt: 'a.b.c' } } },
    };
    expect(findSensitivePaths(payload).length).toBeGreaterThan(0);
    expect(findSensitivePaths(redact(payload))).toEqual([]);
  });
});

describe('snapshot fidelity — a redacted before/after must still be a usable audit record', () => {
  test('non-sensitive values survive untouched', () => {
    const input = { amount: 1500, division: 'HVAC', items: [1, 2, 3], ok: true, none: null };
    expect(redact(input)).toEqual(input);
  });

  test('Date values are preserved, not flattened to {}', () => {
    const when = new Date('2026-01-15T10:00:00.000Z');
    const out = redact({ postedAt: when, amount: 10 });
    expect(out.postedAt).toBeInstanceOf(Date);
    expect(out.postedAt.toISOString()).toBe(when.toISOString());
  });

  test('an ObjectId-like value is preserved rather than walked', () => {
    const oid = { toHexString: () => 'abc123', _bsontype: 'ObjectId' };
    expect(redact({ _id: oid })._id).toBe(oid);
  });

  test('a Mongoose-style document is snapshotted via toObject()', () => {
    const doc = { toObject: () => ({ amount: 5, token: 'secret-value' }) };
    const out = redact(doc);
    expect(out.amount).toBe(5);
    expect(out.token).toBe(REDACTED);
  });

  test('a circular structure does not hang or throw', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(a).self).toBe('[CIRCULAR]');
  });

  test('primitives and null pass through unchanged', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
  });
});
