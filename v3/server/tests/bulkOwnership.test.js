// Phase 4 — bulk operations may never escape per-record ownership (V3 PHASE 4 spec §13).
//
// The exact scenario the spec names:
//     record 1 -> authorized
//     record 2 -> unauthorized
//     record 3 -> authorized
// the system must not assume the entire batch is authorized.
const {
  bulkAuthorize, requireAllOrNothing, assertPerItemContext, BulkAuthorizationError,
} = require('../src/utils/bulkAuthorize');
const { PERMISSIONS, RECORD_STATES } = require('../src/config/constants');

const CO_A = 'co-a';
const USER = { _id: 'u-a', co: CO_A, role: 'engineer', designation: 'engineer', permissions: [PERMISSIONS.EDIT, PERMISSIONS.DELETE] };

function rec(id, overrides = {}) {
  return { _id: id, co: CO_A, createdByUserId: 'u-a', status: RECORD_STATES.DRAFT, ...overrides };
}
function item(id, record) {
  return { id, context: { record, action: 'edit' } };
}

describe('§13 — each item is authorized individually', () => {
  test('the spec scenario: allowed / denied / allowed is partitioned, never blanket-approved', () => {
    const items = [
      item('r1', rec('r1')),
      item('r2', rec('r2', { createdByUserId: 'u-someone-else' })),
      item('r3', rec('r3')),
    ];
    const result = bulkAuthorize(USER, PERMISSIONS.EDIT, items, { action: 'edit' });

    expect(result.allAllowed).toBe(false);
    expect(result.allowedItems.map((i) => i.id)).toEqual(['r1', 'r3']);
    expect(result.deniedItems).toEqual([{ id: 'r2', reason: expect.stringMatching(/owner/i) }]);
  });

  test('a batch where every item is owned passes cleanly', () => {
    const items = [item('r1', rec('r1')), item('r2', rec('r2'))];
    expect(bulkAuthorize(USER, PERMISSIONS.EDIT, items, { action: 'edit' }).allAllowed).toBe(true);
  });

  test('a cross-company item is denied even inside an otherwise-valid batch', () => {
    const items = [item('r1', rec('r1')), item('r2', rec('r2', { co: 'co-b' }))];
    const result = bulkAuthorize(USER, PERMISSIONS.EDIT, items, { action: 'edit' });
    expect(result.deniedItems[0]).toMatchObject({ id: 'r2', reason: expect.stringMatching(/cross-company/i) });
  });

  test('a locked item is denied even inside an otherwise-valid batch', () => {
    const items = [item('r1', rec('r1')), item('r2', rec('r2', { status: RECORD_STATES.FINALIZED }))];
    const result = bulkAuthorize(USER, PERMISSIONS.EDIT, items, { action: 'edit' });
    expect(result.deniedItems.map((d) => d.id)).toEqual(['r2']);
  });

  test('bulk DELETE obeys the stricter delete policy per item', () => {
    const items = [
      item('r1', rec('r1')),                                          // DRAFT — deletable
      item('r2', rec('r2', { status: RECORD_STATES.SUBMITTED })),     // restricted
    ];
    const result = bulkAuthorize(USER, PERMISSIONS.DELETE, items.map((i) => ({ ...i, context: { ...i.context, action: 'delete' } })), { action: 'delete' });
    expect(result.allowedItems.map((i) => i.id)).toEqual(['r1']);
    expect(result.deniedItems.map((d) => d.id)).toEqual(['r2']);
  });

  test('a manager cannot bulk-edit other people\'s records without an explicit override grant', () => {
    const manager = { _id: 'u-mgr', co: CO_A, role: 'hvac_dm', designation: 'hvac_manager', permissions: [PERMISSIONS.EDIT] };
    const items = [item('r1', rec('r1')), item('r2', rec('r2'))];
    const result = bulkAuthorize(manager, PERMISSIONS.EDIT, items, { action: 'edit' });
    expect(result.allowedItems).toEqual([]);
    expect(result.deniedItems).toHaveLength(2);
  });
});

describe('§13 — a shared context can never stand in for per-item authorization', () => {
  test('an item with no record context is refused outright', () => {
    expect(() => assertPerItemContext([{ id: 'r1', context: {} }], 'edit'))
      .toThrow(BulkAuthorizationError);
  });

  test('two items pointing at the SAME record object are refused as a shared-context batch', () => {
    const shared = rec('r1');
    expect(() => bulkAuthorize(USER, PERMISSIONS.EDIT, [
      { id: 'r1', context: { record: shared } },
      { id: 'r2', context: { record: shared } },
    ], { action: 'edit' })).toThrow(/shared context|reuses/i);
  });

  test('the refusal carries a machine-readable code and the offending index', () => {
    expect.assertions(2);
    try {
      assertPerItemContext([item('r1', rec('r1')), { id: 'r2', context: {} }], 'edit');
    } catch (err) {
      expect(err.code).toBe('BULK_SHARED_CONTEXT');
      expect(err.details.index).toBe(1);
    }
  });

  test('a non-array payload is refused', () => {
    expect(() => assertPerItemContext(null, 'edit')).toThrow(/must be an array/i);
  });

  test('a NON-mutation bulk operation (e.g. a read/report) is not forced to carry records', () => {
    expect(() => assertPerItemContext([{ id: 'r1', context: { division: 'HVAC' } }], 'VIEW')).not.toThrow();
  });
});

describe('requireAllOrNothing — for batches that must never partially apply', () => {
  test('one unauthorized item rejects the whole batch before anything is touched', () => {
    const items = [item('r1', rec('r1')), item('r2', rec('r2', { createdByUserId: 'u-x' })), item('r3', rec('r3'))];
    expect.assertions(3);
    try {
      requireAllOrNothing(USER, PERMISSIONS.EDIT, items, { action: 'edit' });
    } catch (err) {
      expect(err.code).toBe('BULK_FORBIDDEN');
      expect(err.deniedItems).toHaveLength(1);
      expect(err.message).toMatch(/1 of 3/);
    }
  });

  test('a fully-authorized batch returns every item', () => {
    const items = [item('r1', rec('r1')), item('r2', rec('r2'))];
    expect(requireAllOrNothing(USER, PERMISSIONS.EDIT, items, { action: 'edit' })).toHaveLength(2);
  });
});
