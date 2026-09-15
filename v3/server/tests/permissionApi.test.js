// Phase 6.0 — API-level tests for permission administration, and the end-to-end proof that dynamic
// permissions are actually enforced by the real middleware chain.
//
// Covers spec §J.9 (protected admin routes), §J.10 (unauthorized access), §J.11 (Phase 1-5
// authorization regression through the real chain), §J.14 (entitlement regression) and §D/§H.
//
// Everything runs through a REAL Express app and the REAL chain — "UI hiding must never be used as
// the security mechanism" (spec §E).
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({ _id: 'a1' }) }));
jest.mock('../src/models/Permission', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../src/models/RolePermission', () => ({
  find: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), deleteOne: jest.fn(),
}));
jest.mock('../src/models/UserPermissionOverride', () => ({
  find: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), deleteOne: jest.fn(),
}));
jest.mock('../src/db/connection', () => ({
  isConnected: jest.fn(() => true),
  getV3Connection: jest.fn(() => ({})),   // no startSession -> auditService uses its sequential path
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const AuditLog = require('../src/models/AuditLog');
const Permission = require('../src/models/Permission');
const RolePermission = require('../src/models/RolePermission');
const UserPermissionOverride = require('../src/models/UserPermissionOverride');
const { app: realApp } = require('../src/app/app');
const { buildProtectedRoute } = require('../src/middleware/chain');
const { errorHandler, notFound } = require('../src/middleware/errorHandler');
const { PERMISSIONS, DESIGNATIONS, AUDIT_ACTIONS } = require('../src/config/constants');
const { CATALOG, PERMISSION_ADMIN, DEFAULT_ROLE_PERMISSIONS } = require('../src/config/permissionCatalog');

const CO_A = 'co-a';
const CO_B = 'co-b';

function query(value) {
  const p = Promise.resolve(value);
  p.lean = () => Promise.resolve(value);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Fixtures. Legacy `permissions[]` arrays are used to grant the administration codes, which is
// exactly how a real deployment bootstraps its first administrator before any matrix exists.
// ---------------------------------------------------------------------------------------------
const USERS = {
  'u-admin': {
    _id: 'u-admin', co: CO_A, name: 'Admin', role: 'admin', designation: DESIGNATIONS.COMPANY_ADMIN,
    department: 'ADMIN', disabled: false,
    permissions: [PERMISSION_ADMIN.VIEW, PERMISSION_ADMIN.MANAGE],
  },
  'u-readonly-admin': {
    _id: 'u-readonly-admin', co: CO_A, name: 'Auditor', role: 'admin', designation: DESIGNATIONS.COMPANY_ADMIN,
    department: 'ADMIN', disabled: false,
    permissions: [PERMISSION_ADMIN.VIEW],          // may look, may not change
  },
  'u-engineer': {
    _id: 'u-engineer', co: CO_A, name: 'Eng', role: 'engineer', designation: DESIGNATIONS.ENGINEER,
    department: 'MEP', division: 'MEP', disabled: false,
    permissions: [PERMISSIONS.VIEW, PERMISSIONS.EDIT, PERMISSIONS.CREATE],   // an ordinary employee
  },
  'u-target': {
    _id: 'u-target', co: CO_A, name: 'Target', role: 'engineer', designation: DESIGNATIONS.ENGINEER,
    department: 'MEP', disabled: false, permissions: [PERMISSIONS.VIEW],
  },
  'u-other-co': {
    _id: 'u-other-co', co: CO_B, name: 'Outsider', role: 'engineer', designation: DESIGNATIONS.ENGINEER,
    disabled: false, permissions: [],
  },
  'u-super': {
    _id: 'u-super', co: CO_A, name: 'Super', role: 'super', designation: DESIGNATIONS.SUPER_ADMIN,
    disabled: false, permissions: [],
  },
};

// Per-test dynamic assignment rows.
let roleRows = [];
let userRows = [];

function tokenFor(id) { return jwt.sign({ id }, env.JWT_SECRET); }
const authHeader = (id) => ({ Authorization: `Bearer ${tokenFor(id)}` });

beforeEach(() => {
  jest.clearAllMocks();
  roleRows = [];
  userRows = [];

  // One implementation serves both call shapes: auth()'s `.select('-pw').lean()` and the admin
  // service's `.lean()`.
  User.findById.mockImplementation((id) => {
    const doc = USERS[String(id)] || null;
    return {
      select: () => ({ lean: () => Promise.resolve(doc) }),
      lean: () => Promise.resolve(doc),
    };
  });

  Company.findById.mockReturnValue(query({
    _id: CO_A,
    entitlements: { modules: '*', divisions: ['MEP', 'HVAC'], enforceEntitlements: true },
  }));

  Permission.find.mockImplementation((filter = {}) => {
    let rows = CATALOG.map((c) => ({ ...c, active: true, systemManaged: true }));
    if (filter.code?.$in) rows = rows.filter((r) => filter.code.$in.includes(r.code));
    if (filter.active === true) rows = rows.filter((r) => r.active);
    return query(rows);
  });

  RolePermission.find.mockImplementation((f) => query(
    roleRows.filter((r) => String(r.co) === String(f.co) && r.designation === f.designation),
  ));
  RolePermission.findOne.mockImplementation((f) => query(
    roleRows.find((r) => String(r.co) === String(f.co) && r.designation === f.designation
      && r.permissionCode === f.permissionCode) || null,
  ));
  RolePermission.create.mockImplementation(async (doc) => {
    const row = { _id: `rp-${roleRows.length + 1}`, ...doc };
    roleRows.push(row);
    return row;
  });
  RolePermission.findOneAndUpdate.mockImplementation((f, update) => {
    const row = roleRows.find((r) => String(r.co) === String(f.co) && r.designation === f.designation
      && r.permissionCode === f.permissionCode);
    if (row) Object.assign(row, update.$set);
    return query(row || null);
  });

  UserPermissionOverride.find.mockImplementation((f) => query(
    userRows.filter((r) => String(r.co) === String(f.co) && String(r.userId) === String(f.userId)),
  ));
  UserPermissionOverride.findOne.mockImplementation((f) => query(
    userRows.find((r) => String(r.co) === String(f.co) && String(r.userId) === String(f.userId)
      && r.permissionCode === f.permissionCode) || null,
  ));
  UserPermissionOverride.create.mockImplementation(async (doc) => {
    const row = { _id: `upo-${userRows.length + 1}`, ...doc };
    userRows.push(row);
    return row;
  });
  UserPermissionOverride.findOneAndUpdate.mockImplementation((f, update) => {
    const row = userRows.find((r) => String(r.co) === String(f.co) && String(r.userId) === String(f.userId)
      && r.permissionCode === f.permissionCode);
    if (row) Object.assign(row, update.$set);
    return query(row || null);
  });
});

// =============================================================================================
describe('§J.9 / §D — GET /api/v3/permissions (the catalog)', () => {
  test('an administrator with permissions.view gets the catalog', async () => {
    const res = await request(realApp).get('/api/v3/permissions').set(authHeader('u-admin'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(CATALOG.length);
    expect(res.body.permissions.map((p) => p.code)).toContain(PERMISSIONS.EDIT);
  });

  test('§J.10 — an ordinary employee is refused, despite holding VIEW/EDIT/CREATE', async () => {
    const res = await request(realApp).get('/api/v3/permissions').set(authHeader('u-engineer'));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/permissions\.view/);
  });

  test('§J.10 — an unauthenticated request is 401, never 403', async () => {
    const res = await request(realApp).get('/api/v3/permissions');
    expect(res.status).toBe(401);
  });

  test('Super Admin passes the permission layer (API_ARCHITECTURE.md §7, unchanged)', async () => {
    const res = await request(realApp).get('/api/v3/permissions').set(authHeader('u-super'));
    expect(res.status).toBe(200);
  });
});

// =============================================================================================
describe('§J.9 — GET/PUT /api/v3/roles/:role/permissions', () => {
  test('reads an unconfigured role and reports it as not configured', async () => {
    const res = await request(realApp).get(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`).set(authHeader('u-admin'));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.permissions).toEqual([]);
    expect(res.body.templateDefaults).toEqual(DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.ENGINEER]);
  });

  test('a legacy v2 role name is normalized to its frozen designation', async () => {
    // v2's `sales` role maps to sales_executive — never to sales_manager.
    const res = await request(realApp).get('/api/v3/roles/sales/permissions').set(authHeader('u-admin'));
    expect(res.status).toBe(200);
    expect(res.body.designation).toBe(DESIGNATIONS.SALES_EXECUTIVE);
  });

  test('an unknown role is refused', async () => {
    const res = await request(realApp).get('/api/v3/roles/wizard/permissions').set(authHeader('u-admin'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNKNOWN_ROLE');
  });

  test('§J.3 — PUT writes explicit grant and revoke rows', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({
        permissions: [
          { code: PERMISSIONS.EDIT, granted: true },
          { code: PERMISSIONS.DELETE, granted: false },
        ],
        reason: 'Engineers may edit but never delete',
      });

    expect(res.status).toBe(200);
    expect(res.body.changedCount).toBe(2);
    expect(roleRows).toHaveLength(2);
    expect(roleRows.find((r) => r.permissionCode === PERMISSIONS.EDIT).granted).toBe(true);
    expect(roleRows.find((r) => r.permissionCode === PERMISSIONS.DELETE).granted).toBe(false);
  });

  test('§F — every change writes an immutable AuditLog entry', async () => {
    await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.EDIT, granted: true }], reason: 'grant edit' });

    const actions = AuditLog.create.mock.calls.map((c) => c[0].action);
    expect(actions).toContain(AUDIT_ACTIONS.PERMISSION_GRANTED);
    expect(actions).toContain(AUDIT_ACTIONS.ROLE_PERMISSION_UPDATED);
  });

  test('§F — a revoke is audited as PERMISSION_REVOKED', async () => {
    await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.DELETE, granted: false }], reason: 'no deletes' });

    expect(AuditLog.create.mock.calls.map((c) => c[0].action)).toContain(AUDIT_ACTIONS.PERMISSION_REVOKED);
  });

  test('is idempotent — re-applying the same state changes and audits nothing', async () => {
    const body = { permissions: [{ code: PERMISSIONS.EDIT, granted: true }], reason: 'grant edit' };
    await request(realApp).put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`).set(authHeader('u-admin')).send(body);
    AuditLog.create.mockClear();

    const second = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`).set(authHeader('u-admin')).send(body);

    expect(second.body.changedCount).toBe(0);
    expect(roleRows).toHaveLength(1);
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  test('§B — a request that both grants and revokes the same code is refused, never merged', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({
        permissions: [
          { code: PERMISSIONS.EDIT, granted: true },
          { code: PERMISSIONS.EDIT, granted: false },
        ],
        reason: 'contradictory',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONFLICTING_PERMISSION_ENTRIES');
    expect(roleRows).toHaveLength(0);       // nothing written
  });

  test('§C — a code outside the catalog is refused', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: 'made.up.permission', granted: true }], reason: 'nope' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNKNOWN_PERMISSION');
    expect(roleRows).toHaveLength(0);
  });

  test('grant vs revoke is never inferred — a missing `granted` is refused', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.EDIT }], reason: 'ambiguous' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GRANTED_REQUIRED');
  });

  test('§J.10 — permissions.view alone cannot WRITE the matrix', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-readonly-admin'))
      .send({ permissions: [{ code: PERMISSIONS.EDIT, granted: true }], reason: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/permissions\.manage/);
    expect(roleRows).toHaveLength(0);
  });

  test('§J.10 — an ordinary employee cannot write the matrix', async () => {
    const res = await request(realApp)
      .put(`/api/v3/roles/${DESIGNATIONS.ENGINEER}/permissions`)
      .set(authHeader('u-engineer'))
      .send({ permissions: [{ code: PERMISSIONS.DELETE, granted: true }], reason: 'self-promotion' });

    expect(res.status).toBe(403);
    expect(roleRows).toHaveLength(0);
  });

  test('§J.15 — applyDefaults writes the frozen template, keeping the two Sales roles distinct', async () => {
    await request(realApp).put(`/api/v3/roles/${DESIGNATIONS.SALES_MANAGER}/permissions`)
      .set(authHeader('u-admin')).send({ applyDefaults: true, reason: 'bootstrap' });
    await request(realApp).put(`/api/v3/roles/${DESIGNATIONS.SALES_EXECUTIVE}/permissions`)
      .set(authHeader('u-admin')).send({ applyDefaults: true, reason: 'bootstrap' });

    const managerCodes = roleRows.filter((r) => r.designation === DESIGNATIONS.SALES_MANAGER).map((r) => r.permissionCode);
    const executiveCodes = roleRows.filter((r) => r.designation === DESIGNATIONS.SALES_EXECUTIVE).map((r) => r.permissionCode);

    expect(managerCodes).toEqual(expect.arrayContaining([PERMISSIONS.APPROVE, PERMISSIONS.ASSIGN]));
    expect(executiveCodes).not.toContain(PERMISSIONS.APPROVE);
    expect(executiveCodes).not.toContain(PERMISSIONS.ASSIGN);
    expect(roleRows.every((r) => r.source === 'template')).toBe(true);
  });
});

// =============================================================================================
describe('§J.9 / §H — PUT /api/v3/users/:id/permissions', () => {
  test('§J.4 / §J.5 — writes per-user grant and revoke rows', async () => {
    const res = await request(realApp)
      .put('/api/v3/users/u-target/permissions')
      .set(authHeader('u-admin'))
      .send({
        permissions: [
          { code: PERMISSIONS.APPROVE, granted: true },
          { code: PERMISSIONS.EDIT, granted: false },
        ],
        reason: 'Standing in for the supervisor this month',
      });

    expect(res.status).toBe(200);
    expect(res.body.changedCount).toBe(2);
    expect(userRows.find((r) => r.permissionCode === PERMISSIONS.APPROVE).granted).toBe(true);
    expect(userRows.find((r) => r.permissionCode === PERMISSIONS.EDIT).granted).toBe(false);
    expect(userRows.every((r) => String(r.co) === CO_A)).toBe(true);
  });

  test('a per-person exception always requires a written reason', async () => {
    const res = await request(realApp)
      .put('/api/v3/users/u-target/permissions')
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.APPROVE, granted: true }] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REASON_REQUIRED');
    expect(userRows).toHaveLength(0);
  });

  test('§J.8 — a target user in another company is refused', async () => {
    const res = await request(realApp)
      .put('/api/v3/users/u-other-co/permissions')
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.APPROVE, granted: true }], reason: 'cross-tenant attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CROSS_COMPANY_DENIED');
    expect(userRows).toHaveLength(0);
  });

  test('an unknown target user is 404', async () => {
    const res = await request(realApp)
      .put('/api/v3/users/nobody/permissions')
      .set(authHeader('u-admin'))
      .send({ permissions: [{ code: PERMISSIONS.APPROVE, granted: true }], reason: 'who?' });
    expect(res.status).toBe(404);
  });

  test('§J.10 — an ordinary employee cannot grant themselves anything', async () => {
    const res = await request(realApp)
      .put('/api/v3/users/u-engineer/permissions')
      .set(authHeader('u-engineer'))
      .send({ permissions: [{ code: PERMISSIONS.DELETE, granted: true }], reason: 'self-promotion' });

    expect(res.status).toBe(403);
    expect(userRows).toHaveLength(0);
  });

  test('GET returns the resolved read model, separating dynamic from legacy grants', async () => {
    userRows.push({ co: CO_A, userId: 'u-target', permissionCode: PERMISSIONS.APPROVE, granted: true });
    const res = await request(realApp).get('/api/v3/users/u-target/permissions').set(authHeader('u-admin'));

    expect(res.status).toBe(200);
    expect(res.body.dynamic.granted).toContain(PERMISSIONS.APPROVE);
    expect(res.body.legacyCompatibilityGrants).toEqual([PERMISSIONS.VIEW]);
    expect(res.body.effective).toEqual([PERMISSIONS.APPROVE, PERMISSIONS.VIEW].sort());
  });

  test('§J.8 — GET for a user in another company is refused', async () => {
    const res = await request(realApp).get('/api/v3/users/u-other-co/permissions').set(authHeader('u-admin'));
    expect(res.status).toBe(403);
  });
});

// =============================================================================================
// End-to-end enforcement through the REAL chain, on a representative protected route.
// =============================================================================================
describe('§E / §J.11 — dynamic permissions are enforced by the real middleware chain', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.put('/widgets/:id', ...buildProtectedRoute({
      resource: 'Widget',
      permission: PERMISSIONS.EDIT,
      loadRecord: (req) => Promise.resolve({
        _id: 'w1', co: CO_A, createdByUserId: req.user._id, status: 'DRAFT',
      }),
    }), (req, res) => res.json({ ok: true }));

    // A read route assembled BY HAND (the Phase 5 pattern) rather than through buildProtectedRoute —
    // it must still get dynamic enforcement, which is why requirePermission() resolves for itself.
    const { auth } = require('../src/middleware/auth');
    const { enforceTenantScope, loadEntitlements } = require('../src/middleware/tenant');
    const { requirePermission } = require('../src/middleware/authorization');
    app.get('/widgets', auth, enforceTenantScope, loadEntitlements, requirePermission(PERMISSIONS.VIEW),
      (req, res) => res.json({ ok: true }));

    // §J.14 — entitlement regression: division scope still runs, and still runs BEFORE ownership.
    app.put('/solar-widgets/:id', ...buildProtectedRoute({
      resource: 'Widget', permission: PERMISSIONS.EDIT, division: () => 'SOLAR',
      loadRecord: (req) => Promise.resolve({ _id: 'w2', co: CO_A, createdByUserId: req.user._id, status: 'DRAFT' }),
    }), (req, res) => res.json({ ok: true }));

    app.use(notFound);
    app.use(errorHandler);
    return app;
  }

  test('§J.11 — the legacy permissions[] array still authorizes when no matrix exists', async () => {
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(200);
  });

  test('§J.6 — a dynamic REVOKE blocks the request even though the legacy array grants it', async () => {
    userRows.push({ co: CO_A, userId: 'u-engineer', permissionCode: PERMISSIONS.EDIT, granted: false });
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Missing permission/);
  });

  test('a role-level REVOKE blocks it too', async () => {
    roleRows.push({ co: CO_A, designation: DESIGNATIONS.ENGINEER, permissionCode: PERMISSIONS.EDIT, granted: false });
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(403);
  });

  test('a per-user GRANT restores what the role revokes', async () => {
    roleRows.push({ co: CO_A, designation: DESIGNATIONS.ENGINEER, permissionCode: PERMISSIONS.EDIT, granted: false });
    userRows.push({ co: CO_A, userId: 'u-engineer', permissionCode: PERMISSIONS.EDIT, granted: true });
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(200);
  });

  test('a dynamic GRANT authorizes a user whose legacy array lacks the code', async () => {
    userRows.push({ co: CO_A, userId: 'u-target', permissionCode: PERMISSIONS.EDIT, granted: true });
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-target')).send({ x: 1 });
    expect(res.status).toBe(200);
  });

  test('a hand-assembled route chain gets dynamic enforcement too', async () => {
    userRows.push({ co: CO_A, userId: 'u-engineer', permissionCode: PERMISSIONS.VIEW, granted: false });
    const res = await request(buildApp()).get('/widgets').set(authHeader('u-engineer'));
    expect(res.status).toBe(403);
  });

  test('§J.8 — an override row from another company does not authorize here', async () => {
    userRows.push({ co: CO_B, userId: 'u-target', permissionCode: PERMISSIONS.EDIT, granted: true });
    const res = await request(buildApp()).put('/widgets/w1').set(authHeader('u-target')).send({ x: 1 });
    expect(res.status).toBe(403);
  });

  test('§J.14 — entitlement/division scope is unaffected: an unentitled division is still 403', async () => {
    // The company fixture is entitled to MEP + HVAC only, so SOLAR is refused regardless of any
    // permission grant.
    userRows.push({ co: CO_A, userId: 'u-engineer', permissionCode: PERMISSIONS.EDIT, granted: true });
    const res = await request(buildApp()).put('/solar-widgets/w2').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(403);
  });

  test('§I — a permission grant never becomes ownership of someone else\'s record', async () => {
    const app = express();
    app.use(express.json());
    app.put('/others/:id', ...buildProtectedRoute({
      resource: 'Widget', permission: PERMISSIONS.EDIT,
      loadRecord: () => Promise.resolve({ _id: 'w9', co: CO_A, createdByUserId: 'someone-else', status: 'DRAFT' }),
    }), (req, res) => res.json({ ok: true }));
    app.use(notFound);
    app.use(errorHandler);

    userRows.push({ co: CO_A, userId: 'u-engineer', permissionCode: PERMISSIONS.EDIT, granted: true });
    const res = await request(app).put('/others/w9').set(authHeader('u-engineer')).send({ x: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not the record owner/i);
  });
});
