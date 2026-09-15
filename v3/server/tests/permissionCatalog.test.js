// Phase 6.0 — permission CATALOG definition + SEED behaviour.
//
// Covers spec §J.1 (catalog creation), §J.2 (idempotent seed), §J.15 (Sales Manager vs Sales
// Executive distinction) and §J.16 (the record-policy override codes are really in the catalog).
jest.mock('../src/models/Permission', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
}));
// Mocked so the "seed never writes an assignment row" guarantee can be asserted behaviourally.
jest.mock('../src/models/RolePermission', () => ({ create: jest.fn(), updateOne: jest.fn(), find: jest.fn() }));
jest.mock('../src/models/UserPermissionOverride', () => ({ create: jest.fn(), updateOne: jest.fn(), find: jest.fn() }));

const Permission = require('../src/models/Permission');
const {
  CATALOG, CATALOG_CODES, CATEGORIES, PERMISSION_ADMIN, DEFAULT_ROLE_PERMISSIONS, templateCodes,
} = require('../src/config/permissionCatalog');
const { seedPermissionCatalog, assertCatalogIntegrity } = require('../src/seeds/permissionCatalogSeed');
const { PERMISSIONS, DESIGNATIONS, DESIGNATION_VALUES } = require('../src/config/constants');
const { getResourcePolicy } = require('../src/config/recordPolicy');
require('../src/config/projectPolicy');   // registers Project / ProjectPackage policies

// Dual-mode query stub: awaitable directly AND via .lean(), matching how the codebase calls models.
function query(value) {
  const p = Promise.resolve(value);
  p.lean = () => Promise.resolve(value);
  return p;
}

describe('catalog definition — nothing invented', () => {
  test('contains all ten frozen PERMISSIONS constants', () => {
    for (const code of Object.values(PERMISSIONS)) {
      expect(CATALOG_CODES).toContain(code);
    }
  });

  test('every generic entry is categorized as generic and carries its action', () => {
    for (const code of Object.values(PERMISSIONS)) {
      const entry = CATALOG.find((c) => c.code === code);
      expect(entry.category).toBe(CATEGORIES.GENERIC);
      expect(entry.action).toBe(code);
    }
  });

  test('§J.16 — the override codes match what getResourcePolicy() actually resolves', () => {
    // If these ever drifted, an administrator could grant `Project.override` while
    // middleware/ownership.js checked a different string — the override would silently never apply.
    for (const resource of ['Project', 'ProjectPackage']) {
      const policyCode = getResourcePolicy(resource).overridePermission;
      expect(CATALOG_CODES).toContain(policyCode);
      expect(CATALOG.find((c) => c.code === policyCode).category).toBe(CATEGORIES.OVERRIDE);
    }
  });

  test('contains the two administration codes that protect the admin endpoints themselves', () => {
    expect(CATALOG_CODES).toContain(PERMISSION_ADMIN.VIEW);
    expect(CATALOG_CODES).toContain(PERMISSION_ADMIN.MANAGE);
  });

  test('has no duplicate codes', () => {
    expect(new Set(CATALOG_CODES).size).toBe(CATALOG_CODES.length);
  });

  test('every entry has the { code, name, category } shape the admin UI needs', () => {
    for (const entry of CATALOG) {
      expect(typeof entry.code).toBe('string');
      expect(typeof entry.name).toBe('string');
      expect(Object.values(CATEGORIES)).toContain(entry.category);
    }
  });

  test('catalog integrity holds — every template code exists as a catalog code', () => {
    expect(assertCatalogIntegrity()).toBe(true);
    for (const code of templateCodes()) expect(CATALOG_CODES).toContain(code);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS — the frozen role hierarchy (spec §G)', () => {
  test('every frozen designation has a template row', () => {
    for (const designation of DESIGNATION_VALUES) {
      expect(DEFAULT_ROLE_PERMISSIONS[designation]).toBeDefined();
    }
  });

  test('§J.15 — Sales Manager and Sales Executive are NOT equivalent', () => {
    const manager = DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.SALES_MANAGER];
    const executive = DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.SALES_EXECUTIVE];
    expect(manager).not.toEqual(executive);
  });

  test('§J.15 — the Sales Manager holds the team authorities the executive does not', () => {
    const manager = DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.SALES_MANAGER];
    const executive = DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.SALES_EXECUTIVE];
    // ACCESS_MATRIX.md rev 4 §12A vs §12B.
    for (const code of [PERMISSIONS.APPROVE, PERMISSIONS.REJECT, PERMISSIONS.ASSIGN, PERMISSIONS.EXPORT]) {
      expect(manager).toContain(code);
      expect(executive).not.toContain(code);
    }
  });

  test('§J.15 — but the executive still holds their own-record authorities', () => {
    const executive = DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.SALES_EXECUTIVE];
    for (const code of [PERMISSIONS.VIEW, PERMISSIONS.CREATE, PERMISSIONS.EDIT, PERMISSIONS.SUBMIT]) {
      expect(executive).toContain(code);
    }
  });

  test('no non-admin designation gets DELETE — the matrix marks business delete admin-only', () => {
    const adminDesignations = [DESIGNATIONS.SUPER_ADMIN, DESIGNATIONS.COMPANY_ADMIN];
    for (const [designation, codes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (adminDesignations.includes(designation)) continue;
      expect(codes).not.toContain(PERMISSIONS.DELETE);
    }
  });

  test('engineer/technician get no APPROVE — approval is a separate authority (spec §I)', () => {
    for (const designation of [DESIGNATIONS.ENGINEER, DESIGNATIONS.TECHNICIAN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[designation]).not.toContain(PERMISSIONS.APPROVE);
    }
  });

  test('viewer is read + export only', () => {
    expect(DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.VIEWER]).toEqual([PERMISSIONS.VIEW, PERMISSIONS.EXPORT]);
  });

  test('only the two admin designations may administer the permission system itself', () => {
    for (const [designation, codes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const isAdmin = [DESIGNATIONS.SUPER_ADMIN, DESIGNATIONS.COMPANY_ADMIN].includes(designation);
      expect(codes.includes(PERMISSION_ADMIN.MANAGE)).toBe(isAdmin);
    }
  });

  test('the template is frozen — a caller cannot mutate the shared default set', () => {
    expect(Object.isFrozen(DEFAULT_ROLE_PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ROLE_PERMISSIONS[DESIGNATIONS.ENGINEER])).toBe(true);
  });
});

describe('seed — deterministic, idempotent, non-destructive (spec §C)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('§J.1 — an empty catalog is fully created', async () => {
    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});

    const result = await seedPermissionCatalog();

    expect(result.created).toHaveLength(CATALOG.length);
    expect(result.updated).toHaveLength(0);
    expect(Permission.create).toHaveBeenCalledTimes(CATALOG.length);
  });

  test('seeded rows are systemManaged and active', async () => {
    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});
    await seedPermissionCatalog();
    for (const call of Permission.create.mock.calls) {
      expect(call[0].systemManaged).toBe(true);
      expect(call[0].active).toBe(true);
    }
  });

  test('§J.2 — a second run creates nothing and reports everything unchanged', async () => {
    const byCode = new Map(CATALOG.map((c) => [c.code, { ...c, active: true, systemManaged: true }]));
    Permission.findOne.mockImplementation(({ code }) => query(byCode.get(code) || null));

    const result = await seedPermissionCatalog();

    expect(result.unchanged).toHaveLength(CATALOG.length);
    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(Permission.create).not.toHaveBeenCalled();
    expect(Permission.updateOne).not.toHaveBeenCalled();
  });

  test('§J.2 — running it twice in a row is stable (no duplicate codes created)', async () => {
    const store = new Map();
    Permission.findOne.mockImplementation(({ code }) => query(store.get(code) || null));
    Permission.create.mockImplementation(async (doc) => { store.set(doc.code, doc); return doc; });

    const first = await seedPermissionCatalog();
    const second = await seedPermissionCatalog();

    expect(first.created).toHaveLength(CATALOG.length);
    expect(second.created).toHaveLength(0);
    expect(store.size).toBe(CATALOG.length);          // no duplicates
    expect(new Set([...store.keys()]).size).toBe(CATALOG.length);
  });

  test('is deterministic — the same input yields the same ordered output', async () => {
    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});
    const a = await seedPermissionCatalog();
    jest.clearAllMocks();
    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});
    const b = await seedPermissionCatalog();
    expect(a.created).toEqual(b.created);
  });

  test('refreshes stale descriptive metadata on an existing row', async () => {
    const stale = { ...CATALOG[0], name: 'Old name', active: true };
    Permission.findOne.mockImplementation(({ code }) => query(code === CATALOG[0].code ? stale : { ...CATALOG.find((c) => c.code === code) }));
    Permission.updateOne.mockResolvedValue({});

    const result = await seedPermissionCatalog();

    expect(result.updated).toEqual([CATALOG[0].code]);
    expect(Permission.updateOne).toHaveBeenCalledTimes(1);
  });

  test('NON-DESTRUCTIVE — never reactivates a code an administrator deactivated', async () => {
    const deactivated = { ...CATALOG[0], active: false };
    Permission.findOne.mockImplementation(({ code }) => query(code === CATALOG[0].code ? deactivated : { ...CATALOG.find((c) => c.code === code) }));
    Permission.updateOne.mockResolvedValue({});

    await seedPermissionCatalog();

    // Descriptive fields all match, so the row is untouched entirely...
    expect(Permission.updateOne).not.toHaveBeenCalled();
    // ...and even when it IS touched, `active` is never in the update payload.
    for (const call of Permission.updateOne.mock.calls) {
      expect(call[1].$set).not.toHaveProperty('active');
      expect(call[1].$set).not.toHaveProperty('systemManaged');
    }
  });

  test('NON-DESTRUCTIVE — never deletes anything', async () => {
    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});
    await seedPermissionCatalog();
    expect(Permission.deleteOne).not.toHaveBeenCalled();
    expect(Permission.deleteMany).not.toHaveBeenCalled();
  });

  test('V3-ONLY — the seed writes no company-scoped assignment rows at all', async () => {
    // A bulk backfill of RolePermission/UserPermissionOverride rows would be an automatic migration
    // of every existing company, which the frozen migration philosophy forbids (spec §L) — a
    // company's matrix is only ever populated by an explicit, audited administrative action.
    // Asserted behaviourally: the assignment models are never touched during a full seed run.
    const RolePermission = require('../src/models/RolePermission');
    const UserPermissionOverride = require('../src/models/UserPermissionOverride');

    Permission.findOne.mockImplementation(() => query(null));
    Permission.create.mockResolvedValue({});
    await seedPermissionCatalog();

    for (const fn of [
      RolePermission.create, RolePermission.updateOne,
      UserPermissionOverride.create, UserPermissionOverride.updateOne,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
