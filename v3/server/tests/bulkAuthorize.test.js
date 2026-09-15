// Tests for src/utils/bulkAuthorize.js — every bulk item must be authorized identically to an
// individual request; no batch-level shortcut.
const { bulkAuthorize, requireAllOrNothing } = require('../src/utils/bulkAuthorize');

function engineer(overrides = {}) {
  return { _id: 'u-eng', co: 'co-a', role: 'engineer', designation: 'engineer', division: 'SOLAR', permissions: [], ...overrides };
}

describe('bulkAuthorize', () => {
  test('authorizes each item independently — a mixed batch reports per-item allow/deny, never an all-or-nothing shortcut by default', () => {
    const user = engineer();
    const items = [
      { id: 1, context: { record: { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
      { id: 2, context: { record: { co: 'co-a', createdByUserId: 'someone-else', status: 'DRAFT' }, action: 'edit', overridePermissionCode: 'x.override' } },
      { id: 3, context: { record: { co: 'co-b', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
    ];
    const result = bulkAuthorize(user, null, items);
    expect(result.allowedItems.map((i) => i.id)).toEqual([1]);
    expect(result.deniedItems.map((i) => i.id)).toEqual([2, 3]);
    expect(result.allAllowed).toBe(false);
  });

  test('a role that would pass MOST items still gets each individual item checked — no batch bypass for company_admin without override', () => {
    const admin = { _id: 'u-admin', co: 'co-a', role: 'admin', designation: 'company_admin', permissions: [] };
    const items = [
      { id: 1, context: { record: { co: 'co-a', createdByUserId: 'u-admin', status: 'DRAFT' }, action: 'edit' } },
      { id: 2, context: { record: { co: 'co-a', createdByUserId: 'someone-else', status: 'DRAFT' }, action: 'edit', overridePermissionCode: 'x.override' } },
    ];
    const result = bulkAuthorize(admin, null, items);
    expect(result.allowedItems.map((i) => i.id)).toEqual([1]);
    expect(result.deniedItems.map((i) => i.id)).toEqual([2]);
  });

  test('all items passing -> allAllowed true', () => {
    const user = engineer();
    const items = [
      { id: 1, context: { record: { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
      { id: 2, context: { record: { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
    ];
    expect(bulkAuthorize(user, null, items).allAllowed).toBe(true);
  });
});

describe('requireAllOrNothing', () => {
  test('throws BULK_FORBIDDEN with the list of denied items if any single item fails', () => {
    const user = engineer();
    const items = [
      { id: 1, context: { record: { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
      { id: 2, context: { record: { co: 'co-b', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } },
    ];
    expect(() => requireAllOrNothing(user, null, items)).toThrow(expect.objectContaining({ code: 'BULK_FORBIDDEN' }));
  });

  test('returns all items when every one is authorized', () => {
    const user = engineer();
    const items = [{ id: 1, context: { record: { co: 'co-a', createdByUserId: 'u-eng', status: 'DRAFT' }, action: 'edit' } }];
    expect(requireAllOrNothing(user, null, items)).toEqual(items);
  });
});
