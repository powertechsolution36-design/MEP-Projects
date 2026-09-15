// Phase 4 — server-side immutable system-field protection (V3 PHASE 4 spec §12 / §16).
const {
  inspectImmutableFields, stripImmutableFields, assertNoImmutableFieldChange, protectImmutableFields,
} = require('../src/middleware/immutableFields');
const { defineResourcePolicy, clearResourcePolicies } = require('../src/config/recordPolicy');

const RESOURCE = 'Quotation';
const stored = {
  _id: 'rec-1', co: 'co-a', createdByUserId: 'u-a', createdAt: new Date('2026-01-01'),
  amount: 1000, status: 'DRAFT',
};

afterEach(() => clearResourcePolicies());

describe('§16 — the minimum protected set', () => {
  test.each(['_id', 'co', 'companyId', 'createdByUserId', 'createdAt'])(
    'an attempt to change %s is detected',
    (field) => {
      const { changed } = inspectImmutableFields({ [field]: 'something-else' }, stored, RESOURCE);
      expect(changed).toContain(field);
    },
  );

  test('an ordinary field change is never flagged', () => {
    const { present, changed } = inspectImmutableFields({ amount: 2000 }, stored, RESOURCE);
    expect(present).toEqual([]);
    expect(changed).toEqual([]);
  });

  test('echoing back an UNCHANGED protected value is not treated as a change', () => {
    // A client that GETs a record and PUTs the whole thing back must not be rejected.
    const { present, changed } = inspectImmutableFields(
      { _id: 'rec-1', co: 'co-a', createdByUserId: 'u-a', amount: 2000 }, stored, RESOURCE,
    );
    expect(present).toEqual(expect.arrayContaining(['_id', 'co', 'createdByUserId']));
    expect(changed).toEqual([]);
  });

  test('an ObjectId and its string form compare equal', () => {
    const oid = { toString: () => 'u-a' };
    const { changed } = inspectImmutableFields({ createdByUserId: oid }, stored, RESOURCE);
    expect(changed).toEqual([]);
  });

  test('with no stored record to compare against, a protected key is treated as a change', () => {
    const { changed } = inspectImmutableFields({ createdByUserId: 'u-x' }, null, RESOURCE);
    expect(changed).toContain('createdByUserId');
  });
});

describe('§12 — history fields cannot be rewritten by an ordinary update', () => {
  test.each(['approvalHistory', 'auditTrail', 'ledgerEntries', 'postedAt', 'reversedAt'])(
    'changing %s is flagged',
    (field) => {
      const { changed } = inspectImmutableFields({ [field]: 'tampered' }, stored, RESOURCE);
      expect(changed).toContain(field);
    },
  );

  test('a module-declared immutable field is protected too', () => {
    defineResourcePolicy('StockLedgerLine', { immutableFields: ['postedQty'] });
    const { changed } = inspectImmutableFields({ postedQty: 99 }, { postedQty: 5 }, 'StockLedgerLine');
    expect(changed).toContain('postedQty');
  });
});

describe('stripImmutableFields / assertNoImmutableFieldChange', () => {
  test('strip removes every protected key from the payload in place', () => {
    const payload = { amount: 10, createdByUserId: 'u-x', co: 'co-b', _id: 'other' };
    const removed = stripImmutableFields(payload, RESOURCE);
    expect(payload).toEqual({ amount: 10 });
    expect(removed).toEqual(expect.arrayContaining(['createdByUserId', 'co', '_id']));
  });

  test('assert throws a 422-shaped error naming the offending fields', () => {
    expect.assertions(4);
    try {
      assertNoImmutableFieldChange({ createdByUserId: 'u-x' }, stored, RESOURCE);
    } catch (err) {
      expect(err.code).toBe('IMMUTABLE_FIELD');
      expect(err.status).toBe(422);
      expect(err.details.fields).toContain('createdByUserId');
      expect(err.message).toMatch(/createdByUserId/);
    }
  });

  test('assert does not throw for an ordinary update', () => {
    expect(() => assertNoImmutableFieldChange({ amount: 5 }, stored, RESOURCE)).not.toThrow();
  });
});

describe('protectImmutableFields() middleware', () => {
  function run(middleware, req) {
    return new Promise((resolve) => {
      const res = {
        statusCode: null, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; resolve({ res: this, nexted: false }); return this; },
      };
      middleware(req, res, () => resolve({ res, nexted: true }));
    });
  }

  test('strip mode (default) drops protected keys and continues', async () => {
    const req = { body: { amount: 10, createdByUserId: 'u-x' }, record: stored };
    const { nexted } = await run(protectImmutableFields({ resource: RESOURCE }), req);
    expect(nexted).toBe(true);
    expect(req.body).toEqual({ amount: 10 });
    expect(req.strippedImmutableFields).toContain('createdByUserId');
  });

  test('reject mode returns 422 with the frozen error contract', async () => {
    const req = { body: { createdByUserId: 'u-x' }, record: stored };
    const { res, nexted } = await run(protectImmutableFields({ resource: RESOURCE, mode: 'reject' }), req);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(422);
    expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
    expect(res.body.error.message).toMatch(/createdByUserId/);
  });

  test('reject mode still allows an unchanged echo-back', async () => {
    const req = { body: { co: 'co-a', amount: 99 }, record: stored };
    const { nexted } = await run(protectImmutableFields({ resource: RESOURCE, mode: 'reject' }), req);
    expect(nexted).toBe(true);
    expect(req.body).toEqual({ amount: 99 });
  });

  test('a request with no body passes straight through', async () => {
    const { nexted } = await run(protectImmutableFields({ resource: RESOURCE }), { record: stored });
    expect(nexted).toBe(true);
  });
});
