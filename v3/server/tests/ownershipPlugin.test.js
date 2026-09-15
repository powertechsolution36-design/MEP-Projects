// Phase 4 — the mandatory ownership metadata block + soft-delete triad applied as ONE reusable
// Mongoose plugin (V3 PHASE 4 spec §2 / §10; DATABASE_ARCHITECTURE.md rev 12 addendum).
const mongoose = require('mongoose');
const {
  ownershipPlugin, applyNotDeletedFilter, MIN_DELETION_REASON_LENGTH,
} = require('../src/models/plugins/ownershipPlugin');
const { RECORD_STATES } = require('../src/config/constants');

function buildSchema(definition = {}, options = {}) {
  const schema = new mongoose.Schema({ title: String, ...definition });
  schema.plugin(ownershipPlugin, options);
  return schema;
}

describe('§2 — required ownership fields on every business collection', () => {
  const schema = buildSchema();

  test.each([
    'co', 'createdByUserId', 'createdByName', 'updatedByUserId', 'status',
  ])('declares %s', (path) => {
    expect(schema.path(path)).toBeDefined();
  });

  test('createdAt / updatedAt come from the timestamps option', () => {
    expect(schema.get('timestamps')).toBe(true);
  });

  test('createdByUserId defaults to null — a migrated row with no reliable creator is never given one', () => {
    expect(schema.path('createdByUserId').defaultValue).toBeNull();
    expect(schema.path('migrationReviewRequired')).toBeDefined();
  });

  test('status defaults to DRAFT and is constrained to the frozen state enum', () => {
    expect(schema.path('status').defaultValue).toBe(RECORD_STATES.DRAFT);
    expect(schema.path('status').enumValues).toEqual(expect.arrayContaining(Object.values(RECORD_STATES)));
  });

  test('a path the model already declared is never overwritten by the plugin', () => {
    const custom = new mongoose.Schema({ status: { type: String, default: 'CUSTOM_DEFAULT' } });
    custom.plugin(ownershipPlugin);
    expect(custom.path('status').defaultValue).toBe('CUSTOM_DEFAULT');
  });
});

describe('§10 — soft delete', () => {
  const schema = buildSchema();

  test.each(['deleted', 'deletedAt', 'deletedByUserId', 'deletionReason'])('declares %s', (path) => {
    expect(schema.path(path)).toBeDefined();
  });

  test('deleted defaults to false', () => {
    expect(schema.path('deleted').defaultValue).toBe(false);
  });

  test('softDeleteFields requires a substantive deletion reason (destructive action guard)', () => {
    expect(() => schema.statics.softDeleteFields({ _id: 'u1' }, 'oops')).toThrow(/at least/i);
    expect(() => schema.statics.softDeleteFields({ _id: 'u1' })).toThrow(/reason/i);
  });

  test('softDeleteFields stamps the full triad plus the updater', () => {
    const reason = 'x'.repeat(MIN_DELETION_REASON_LENGTH);
    const fields = schema.statics.softDeleteFields({ _id: 'u1' }, reason);
    expect(fields.deleted).toBe(true);
    expect(fields.deletedAt).toBeInstanceOf(Date);
    expect(fields.deletedByUserId).toBe('u1');
    expect(fields.deletionReason).toBe(reason);
    expect(fields.updatedByUserId).toBe('u1');
  });

  test('restoreFields clears the whole triad', () => {
    const fields = schema.statics.restoreFields({ _id: 'u2' });
    expect(fields).toMatchObject({ deleted: false, deletedAt: null, deletedByUserId: null, deletionReason: null });
  });
});

describe('§10 — normal queries exclude deleted records unless explicitly asked', () => {
  function fakeQuery({ filter = {}, options = {} } = {}) {
    const q = {
      _filter: { ...filter },
      _options: { ...options },
      getFilter() { return this._filter; },
      getOptions() { return this._options; },
      where(clause) { Object.assign(this._filter, clause); return this; },
    };
    return q;
  }

  test('an ordinary query gains deleted: { $ne: true }', () => {
    const q = applyNotDeletedFilter(fakeQuery());
    expect(q.getFilter()).toEqual({ deleted: { $ne: true } });
  });

  test('an administrative/audit view opts in with includeDeleted and is left alone', () => {
    const q = applyNotDeletedFilter(fakeQuery({ options: { includeDeleted: true } }));
    expect(q.getFilter()).toEqual({});
  });

  test('a query already filtering on deleted is not overridden', () => {
    const q = applyNotDeletedFilter(fakeQuery({ filter: { deleted: true } }));
    expect(q.getFilter()).toEqual({ deleted: true });
  });

  test('the pre-hooks are registered for every read/update entry point', () => {
    const schema = buildSchema();
    const hooked = schema.s.hooks._pres;
    for (const hook of ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany']) {
      expect(hooked.get(hook)?.length).toBeGreaterThan(0);
    }
  });
});

describe('ownership is permanent — stamping helpers', () => {
  const schema = buildSchema();

  test('stampCreate makes the creator the authoritative owner', () => {
    const doc = schema.statics.stampCreate({ title: 'T' }, { _id: 'u1', co: 'co-a', name: 'Asha' });
    expect(doc.createdByUserId).toBe('u1');
    expect(doc.co).toBe('co-a');
    expect(doc.createdByName).toBe('Asha'); // display cache only
    expect(doc.updatedByUserId).toBe('u1');
  });

  test('stampUpdate can NEVER rewrite ownership, company, or createdAt', () => {
    const payload = {
      title: 'changed',
      createdByUserId: 'attacker',
      createdByName: 'Attacker',
      co: 'co-b',
      createdAt: new Date('2020-01-01'),
    };
    const out = schema.statics.stampUpdate(payload, { _id: 'u2' });
    expect(out.createdByUserId).toBeUndefined();
    expect(out.createdByName).toBeUndefined();
    expect(out.co).toBeUndefined();
    expect(out.createdAt).toBeUndefined();
    expect(out.title).toBe('changed');
    expect(out.updatedByUserId).toBe('u2');
  });
});
