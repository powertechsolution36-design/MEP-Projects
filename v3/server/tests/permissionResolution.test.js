// Phase 6.0 — DYNAMIC PERMISSION RESOLUTION: precedence, company isolation, and the integration
// points that must not weaken (ownership override, approval authority, record-policy overrides).
//
// Covers spec §J.3-§J.8, §J.12, §J.13, §J.16 and §I.
jest.mock('../src/models/RolePermission', () => ({ find: jest.fn() }));
jest.mock('../src/models/UserPermissionOverride', () => ({ find: jest.fn() }));
jest.mock('../src/db/connection', () => ({
  isConnected: jest.fn(() => true),
  getV3Connection: jest.fn(() => ({})),
}));

const RolePermission = require('../src/models/RolePermission');
const UserPermissionOverride = require('../src/models/UserPermissionOverride');
const { isConnected } = require('../src/db/connection');
const {
  resolveEffectivePermissions, describeUserPermissions, PermissionResolutionError, SOURCES,
} = require('../src/services/permissionResolutionService');
const { hasPermission } = require('../src/services/permissionService');
const { ensurePermissionsLoaded, loadPermissions } = require('../src/middleware/permissions');
const { checkOwnership } = require('../src/middleware/ownership');
const { PERMISSIONS, RECORD_STATES, DESIGNATIONS } = require('../src/config/constants');

const CO_A = 'co-a';
const CO_B = 'co-b';

function query(value) {
  const p = Promise.resolve(value);
  p.lean = () => Promise.resolve(value);
  return p;
}

/** Arranges the two collections' rows, asserting company scope is always part of the query. */
function arrange({ roleRows = [], userRows = [] } = {}) {
  RolePermission.find.mockImplementation((filter) => {
    expect(filter).toHaveProperty('co');            // company isolation, at the driver level
    return query(roleRows.filter((r) => String(r.co) === String(filter.co) && r.designation === filter.designation));
  });
  UserPermissionOverride.find.mockImplementation((filter) => {
    expect(filter).toHaveProperty('co');
    return query(userRows.filter((r) => String(r.co) === String(filter.co) && String(r.userId) === String(filter.userId)));
  });
}

const roleRow = (designation, code, granted, co = CO_A) => ({ co, designation, permissionCode: code, granted });
const userRow = (userId, code, granted, co = CO_A) => ({ co, userId, permissionCode: code, granted });

beforeEach(() => {
  jest.clearAllMocks();
  isConnected.mockReturnValue(true);
});

// =============================================================================================
describe('precedence — the exact documented order', () => {
  test('§J.3 — a RolePermission grant grants the code', async () => {
    arrange({ roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.EDIT, true)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.granted).toContain(PERMISSIONS.EDIT);
    expect(r.revoked).toEqual([]);
    expect(r.sources[PERMISSIONS.EDIT]).toBe(SOURCES.ROLE_GRANT);
  });

  test('§J.4 — a UserPermissionOverride grant grants the code', async () => {
    arrange({ userRows: [userRow('u1', PERMISSIONS.APPROVE, true)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.granted).toContain(PERMISSIONS.APPROVE);
    expect(r.sources[PERMISSIONS.APPROVE]).toBe(SOURCES.USER_GRANT);
  });

  test('§J.5 — a UserPermissionOverride revoke revokes the code', async () => {
    arrange({ userRows: [userRow('u1', PERMISSIONS.DELETE, false)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.revoked).toContain(PERMISSIONS.DELETE);
    expect(r.granted).not.toContain(PERMISSIONS.DELETE);
    expect(r.sources[PERMISSIONS.DELETE]).toBe(SOURCES.USER_REVOKE);
  });

  test('§J.6 / §I — role GRANT + user REVOKE => revoked (the revoke wins)', async () => {
    arrange({
      roleRows: [roleRow(DESIGNATIONS.PROJECT_MANAGER, PERMISSIONS.EDIT, true)],
      userRows: [userRow('u1', PERMISSIONS.EDIT, false)],
    });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.PROJECT_MANAGER });
    expect(r.revoked).toContain(PERMISSIONS.EDIT);
    expect(r.granted).not.toContain(PERMISSIONS.EDIT);
    expect(r.sources[PERMISSIONS.EDIT]).toBe(SOURCES.USER_REVOKE);
  });

  test('role REVOKE + user GRANT => granted (the more specific level wins)', async () => {
    arrange({
      roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.EXPORT, false)],
      userRows: [userRow('u1', PERMISSIONS.EXPORT, true)],
    });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.granted).toContain(PERMISSIONS.EXPORT);
    expect(r.revoked).not.toContain(PERMISSIONS.EXPORT);
    expect(r.sources[PERMISSIONS.EXPORT]).toBe(SOURCES.USER_GRANT);
  });

  test('a role-level revoke alone denies the code', async () => {
    arrange({ roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.SUBMIT, false)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.revoked).toContain(PERMISSIONS.SUBMIT);
    expect(r.sources[PERMISSIONS.SUBMIT]).toBe(SOURCES.ROLE_REVOKE);
  });

  test('§J.7 — two users with the SAME designation resolve differently under their own overrides', async () => {
    arrange({
      roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.EDIT, true)],
      userRows: [userRow('u-restricted', PERMISSIONS.EDIT, false), userRow('u-boosted', PERMISSIONS.APPROVE, true)],
    });

    const restricted = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u-restricted', designation: DESIGNATIONS.ENGINEER });
    const boosted = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u-boosted', designation: DESIGNATIONS.ENGINEER });

    expect(restricted.revoked).toContain(PERMISSIONS.EDIT);
    expect(boosted.granted).toEqual(expect.arrayContaining([PERMISSIONS.EDIT, PERMISSIONS.APPROVE]));
    expect(boosted.revoked).toEqual([]);
  });
});

// =============================================================================================
describe('§J.8 / §H — company isolation', () => {
  test('a role row belonging to another company never applies', async () => {
    arrange({ roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.DELETE, true, CO_B)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.granted).not.toContain(PERMISSIONS.DELETE);
  });

  test('a user override belonging to another company never applies', async () => {
    arrange({ userRows: [userRow('u1', PERMISSIONS.APPROVE, true, CO_B)] });
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r.granted).not.toContain(PERMISSIONS.APPROVE);
  });

  test('the same user id in two companies resolves independently', async () => {
    arrange({ userRows: [userRow('shared-id', PERMISSIONS.EDIT, true, CO_A), userRow('shared-id', PERMISSIONS.EDIT, false, CO_B)] });
    const inA = await resolveEffectivePermissions({ companyId: CO_A, userId: 'shared-id', designation: DESIGNATIONS.ENGINEER });
    const inB = await resolveEffectivePermissions({ companyId: CO_B, userId: 'shared-id', designation: DESIGNATIONS.ENGINEER });
    expect(inA.granted).toContain(PERMISSIONS.EDIT);
    expect(inB.revoked).toContain(PERMISSIONS.EDIT);
  });

  test('a resolution with no company scope is refused outright', async () => {
    arrange();
    await expect(resolveEffectivePermissions({ companyId: null, userId: 'u1', designation: DESIGNATIONS.ENGINEER }))
      .rejects.toThrow(PermissionResolutionError);
  });

  test('the middleware always scopes to the AUTHENTICATED company, never a client value', async () => {
    arrange({ userRows: [userRow('u1', PERMISSIONS.EDIT, true, CO_A)] });
    const req = {
      user: { _id: 'u1', co: CO_A, designation: DESIGNATIONS.ENGINEER, role: 'engineer' },
      // A malicious body/param can carry anything; it must never reach the resolution query.
      body: { co: CO_B, companyId: CO_B },
      tenantCompanyId: CO_A,
    };
    await ensurePermissionsLoaded(req);
    expect(UserPermissionOverride.find).toHaveBeenCalledWith(expect.objectContaining({ co: CO_A }));
  });
});

// =============================================================================================
describe('failure behaviour — a revoke is never silently lost', () => {
  test('with NO database connection, resolution returns null (Phase 1-5 legacy behaviour)', async () => {
    isConnected.mockReturnValue(false);
    const r = await resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER });
    expect(r).toBeNull();
    expect(RolePermission.find).not.toHaveBeenCalled();
  });

  test('connected but unreadable => throws, rather than degrading to "no revoke"', async () => {
    RolePermission.find.mockImplementation(() => { throw new Error('boom'); });
    UserPermissionOverride.find.mockImplementation(() => query([]));
    await expect(resolveEffectivePermissions({ companyId: CO_A, userId: 'u1', designation: DESIGNATIONS.ENGINEER }))
      .rejects.toThrow(/Permission resolution failed/);
  });

  test('the middleware surfaces a resolution failure as 500, never as a silent allow', async () => {
    RolePermission.find.mockImplementation(() => { throw new Error('boom'); });
    UserPermissionOverride.find.mockImplementation(() => query([]));
    const req = { user: { _id: 'u1', co: CO_A, designation: DESIGNATIONS.ENGINEER, role: 'engineer' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await loadPermissions(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('resolution is cached per request — a second call does not re-query', async () => {
    arrange({ roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.VIEW, true)] });
    const req = { user: { _id: 'u1', co: CO_A, designation: DESIGNATIONS.ENGINEER, role: 'engineer' } };
    await ensurePermissionsLoaded(req);
    await ensurePermissionsLoaded(req);
    expect(RolePermission.find).toHaveBeenCalledTimes(1);
  });

  test('Super Admin is short-circuited before any resolution query runs (spec §H)', async () => {
    arrange();
    const req = { user: { _id: 'su', co: CO_A, role: 'super', designation: DESIGNATIONS.SUPER_ADMIN } };
    await ensurePermissionsLoaded(req);
    expect(RolePermission.find).not.toHaveBeenCalled();
    expect(UserPermissionOverride.find).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('hasPermission() — synchronous, and unchanged for Phase 1-5 callers', () => {
  test('a user with no resolution behaves exactly as before (legacy array)', () => {
    const user = { role: 'engineer', permissions: [PERMISSIONS.EDIT] };
    expect(hasPermission(user, PERMISSIONS.EDIT)).toBe(true);
    expect(hasPermission(user, PERMISSIONS.DELETE)).toBe(false);
  });

  test('the legacy wildcard still works when nothing dynamic contradicts it', () => {
    expect(hasPermission({ role: 'engineer', permissions: ['*'] }, 'anything.at.all')).toBe(true);
  });

  test('§I — a dynamic revoke beats the legacy wildcard', () => {
    const user = {
      role: 'engineer',
      permissions: ['*'],
      _permissionResolution: { granted: [], revoked: [PERMISSIONS.DELETE] },
    };
    expect(hasPermission(user, PERMISSIONS.DELETE)).toBe(false);
    expect(hasPermission(user, PERMISSIONS.EDIT)).toBe(true);   // untouched codes still pass
  });

  test('§I — a dynamic revoke beats a legacy explicit grant', () => {
    const user = {
      role: 'engineer',
      permissions: [PERMISSIONS.EDIT],
      _permissionResolution: { granted: [], revoked: [PERMISSIONS.EDIT] },
    };
    expect(hasPermission(user, PERMISSIONS.EDIT)).toBe(false);
  });

  test('a dynamic grant works without any legacy array entry', () => {
    const user = { role: 'engineer', permissions: [], _permissionResolution: { granted: [PERMISSIONS.APPROVE], revoked: [] } };
    expect(hasPermission(user, PERMISSIONS.APPROVE)).toBe(true);
  });

  test('super still bypasses (API_ARCHITECTURE.md §7, unchanged)', () => {
    expect(hasPermission({ role: 'super' }, 'anything')).toBe(true);
  });

  test('a revoke cannot lock out Super Admin', () => {
    const user = { role: 'super', _permissionResolution: { granted: [], revoked: [PERMISSIONS.DELETE] } };
    expect(hasPermission(user, PERMISSIONS.DELETE)).toBe(true);
  });
});

// =============================================================================================
describe('§J.12 / §J.16 — ownership integration is strengthened, never weakened', () => {
  const RECORD = { _id: 'r1', co: CO_A, createdByUserId: 'owner', status: RECORD_STATES.DRAFT };

  test('a dynamically GRANTED override permission is honoured by checkOwnership', () => {
    const decision = checkOwnership({
      record: RECORD,
      user: {
        id: 'mgr', co: CO_A, role: 'hvac_dm', permissions: [],
        _permissionResolution: { granted: ['Project.override'], revoked: [] },
      },
      action: 'edit',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(true);
    // Still never a silent write — the correction path is mandatory (Phase 4, unchanged).
    expect(decision.requiresCorrection).toBe(true);
  });

  test('a dynamically REVOKED override permission is actually withdrawn', () => {
    const decision = checkOwnership({
      record: RECORD,
      user: {
        id: 'mgr', co: CO_A, role: 'hvac_dm',
        permissions: ['Project.override'],                        // legacy grant...
        _permissionResolution: { granted: [], revoked: ['Project.override'] },  // ...explicitly revoked
      },
      action: 'edit',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not the record owner/i);
  });

  test('ownership itself is still required — a permission grant is not ownership (spec §I)', () => {
    const decision = checkOwnership({
      record: RECORD,
      user: {
        id: 'someone-else', co: CO_A, role: 'engineer', permissions: [],
        _permissionResolution: { granted: [PERMISSIONS.EDIT, PERMISSIONS.DELETE], revoked: [] },
      },
      action: 'edit',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(false);
  });

  test('§J.13 / §I — an APPROVE grant never becomes edit authority', () => {
    const decision = checkOwnership({
      record: RECORD,
      user: {
        id: 'approver', co: CO_A, role: 'engineer', permissions: [],
        _permissionResolution: { granted: [PERMISSIONS.APPROVE], revoked: [] },
      },
      action: 'APPROVE',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/business action, not a record mutation/i);
  });

  test('a dynamic grant cannot unlock a FINALIZED record (state still governs)', () => {
    const decision = checkOwnership({
      record: { ...RECORD, status: RECORD_STATES.FINALIZED },
      user: {
        id: 'mgr', co: CO_A, role: 'hvac_dm', permissions: [],
        _permissionResolution: { granted: ['Project.override'], revoked: [] },
      },
      action: 'edit',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/locked/i);
  });

  test('a dynamic grant cannot cross a company boundary', () => {
    const decision = checkOwnership({
      record: { ...RECORD, co: CO_B },
      user: {
        id: 'mgr', co: CO_A, role: 'hvac_dm', permissions: [],
        _permissionResolution: { granted: ['Project.override'], revoked: [] },
      },
      action: 'edit',
      resource: 'Project',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cross-company/i);
  });
});

// =============================================================================================
describe('describeUserPermissions — the administration read model', () => {
  test('separates dynamic decisions from the legacy compatibility baseline', async () => {
    arrange({
      roleRows: [roleRow(DESIGNATIONS.ENGINEER, PERMISSIONS.EDIT, true)],
      userRows: [userRow('u1', PERMISSIONS.DELETE, false)],
    });
    const description = await describeUserPermissions({
      user: { _id: 'u1', designation: DESIGNATIONS.ENGINEER, permissions: [PERMISSIONS.VIEW, PERMISSIONS.DELETE] },
      companyId: CO_A,
    });

    expect(description.dynamic.granted).toContain(PERMISSIONS.EDIT);
    expect(description.dynamic.revoked).toContain(PERMISSIONS.DELETE);
    expect(description.legacyCompatibilityGrants).toEqual([PERMISSIONS.VIEW, PERMISSIONS.DELETE]);
    // The effective answer: legacy VIEW survives, dynamic EDIT is added, revoked DELETE is removed.
    expect(description.effective).toEqual([PERMISSIONS.EDIT, PERMISSIONS.VIEW].sort());
  });

  test('reports `dynamic: null` for a company that has not populated its matrix', async () => {
    isConnected.mockReturnValue(false);
    const description = await describeUserPermissions({
      user: { _id: 'u1', designation: DESIGNATIONS.ENGINEER, permissions: [PERMISSIONS.VIEW] },
      companyId: CO_A,
    });
    expect(description.dynamic).toBeNull();
    expect(description.effective).toEqual([PERMISSIONS.VIEW]);
  });
});
