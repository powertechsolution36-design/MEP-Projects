// Phase 5 — legacy compatibility adapter (V3_MIGRATION_MAP.md "Legacy Compatibility Shims";
// DATABASE_ARCHITECTURE.md "Migration compatibility rule"; ACCESS_MATRIX.md PART 7).
//
// The rules under test are the ones that protect LIVE v2 production data:
//   * a single-division legacy project is presented as ONE VIRTUAL package, never materialized;
//   * legacy operational history is referenced, never duplicated;
//   * a legacy `div` that does not map to a v3 division is NEVER guessed and NEVER expanded to all
//     three — it surfaces migrationReviewRequired instead.
const {
  resolveLegacyDivision, projectDivisions, isLegacyProject, toVirtualPackage, presentProject,
  legacyHistoryIsReadOnly, LEGACY_HISTORY_FIELDS,
} = require('../src/compat/legacyProjectPackageAdapter');

// Mirrors the REAL v2 model at v2/server/src/models/Project.js — including its mixed-case 'Solar'
// and non-division 'Other' enum values, which are exactly why this adapter exists.
function legacyProject(overrides = {}) {
  return {
    _id: 'proj-legacy',
    co: 'co-a',
    code: 'PRJ-001',
    name: 'Poona Stud Farm HVAC',
    client: 'Client A',
    div: 'HVAC',
    status: 'active',
    value: 500000,
    pm: 'Ravi Kumar',                       // legacy NAME string, not a user id
    engs: ['Asha', 'Vikram'],               // legacy NAME strings
    chk: [{ title: 'Site survey', done: true }],
    updates: [{ by: 'Ravi', text: 'Started' }],
    dc: [{ type: 'DC', ref: 'DC-1' }],
    ...overrides,
  };
}

describe('resolveLegacyDivision — v2 enum is [MEP, HVAC, Solar, Other]', () => {
  test('MEP and HVAC map straight through and stay separate', () => {
    expect(resolveLegacyDivision('MEP')).toMatchObject({ division: 'MEP', migrationReviewRequired: false });
    expect(resolveLegacyDivision('HVAC')).toMatchObject({ division: 'HVAC', migrationReviewRequired: false });
  });

  test("mixed-case legacy 'Solar' normalizes to the v3 uppercase SOLAR", () => {
    expect(resolveLegacyDivision('Solar')).toMatchObject({ division: 'SOLAR', migrationReviewRequired: false });
  });

  test("'Other' is NOT a division — review required, nothing granted", () => {
    const result = resolveLegacyDivision('Other');
    expect(result.division).toBeNull();
    expect(result.migrationReviewRequired).toBe(true);
    expect(result.legacyValue).toBe('Other');
  });

  test.each([null, undefined, ''])('a missing div (%p) requires review rather than a default', (value) => {
    expect(resolveLegacyDivision(value)).toMatchObject({ division: null, migrationReviewRequired: true });
  });

  test('an unrecognized value is never coerced into a division', () => {
    expect(resolveLegacyDivision('PLUMBING')).toMatchObject({ division: null, migrationReviewRequired: true });
  });
});

describe('projectDivisions — never the forbidden [SOLAR, MEP, HVAC] fallback', () => {
  test('an unresolvable legacy project gets an EMPTY division list, not all three', () => {
    const { divisions, migrationReviewRequired } = projectDivisions(legacyProject({ div: 'Other' }));
    expect(divisions).toEqual([]);
    expect(divisions).not.toEqual(['SOLAR', 'MEP', 'HVAC']);
    expect(migrationReviewRequired).toBe(true);
  });

  test('a legacy single-division project yields exactly its own division', () => {
    expect(projectDivisions(legacyProject({ div: 'MEP' })).divisions).toEqual(['MEP']);
  });

  test('a v3 project uses its own divisions[] verbatim', () => {
    const project = { divisions: ['SOLAR', 'MEP'], packageArchitecture: true };
    expect(projectDivisions(project).divisions).toEqual(['SOLAR', 'MEP']);
  });

  test('a null project is review-required, never silently empty-but-fine', () => {
    expect(projectDivisions(null).migrationReviewRequired).toBe(true);
  });
});

describe('toVirtualPackage — presentation, never materialization', () => {
  test('a legacy single-division project is presented as one virtual package', () => {
    const pkg = toVirtualPackage(legacyProject());
    expect(pkg.virtual).toBe(true);
    expect(pkg.readOnly).toBe(true);
    expect(pkg.division).toBe('HVAC');
    expect(pkg.projectId).toBe('proj-legacy');
  });

  test('the virtual package has NO _id — it is not a row and can never be mistaken for one', () => {
    expect(toVirtualPackage(legacyProject())._id).toBeUndefined();
  });

  test('legacy history is referenced under legacyHistory, never copied into package fields', () => {
    const project = legacyProject();
    const pkg = toVirtualPackage(project);
    expect(pkg.legacyHistory.chk).toEqual(project.chk);
    expect(pkg.legacyHistory.updates).toEqual(project.updates);
    expect(pkg.legacyHistory.dc).toEqual(project.dc);
  });

  test("legacy pm/engs NAME strings are surfaced under legacy* keys, never as the package's user-id fields", () => {
    const pkg = toVirtualPackage(legacyProject());
    expect(pkg.legacyPmName).toBe('Ravi Kumar');
    expect(pkg.legacyEngNames).toEqual(['Asha', 'Vikram']);
    // The real FK fields stay empty — a name string must never reach an authorization check.
    expect(pkg.projectMgr).toBeNull();
    expect(pkg.engs).toEqual([]);
  });

  test('the virtual package is frozen — nothing can write through the presentation', () => {
    const pkg = toVirtualPackage(legacyProject());
    expect(Object.isFrozen(pkg)).toBe(true);
  });

  test('a project needing migration review yields NO virtual package', () => {
    expect(toVirtualPackage(legacyProject({ div: 'Other' }))).toBeNull();
  });

  test('an already-converted project yields no virtual package — it has real rows', () => {
    expect(toVirtualPackage(legacyProject({ packageArchitecture: true }))).toBeNull();
  });
});

describe('presentProject — the v3 read model', () => {
  test('a legacy project presents one virtual package and reports virtual: true', () => {
    const view = presentProject(legacyProject());
    expect(view.virtual).toBe(true);
    expect(view.packageArchitecture).toBe(false);
    expect(view.packages).toHaveLength(1);
    expect(view.packages[0].virtual).toBe(true);
  });

  test('a converted project presents its REAL rows and reports virtual: false', () => {
    const project = { _id: 'p1', co: 'co-a', divisions: ['SOLAR', 'MEP'], packageArchitecture: true };
    const rows = [{ _id: 'pkg-1', division: 'SOLAR' }, { _id: 'pkg-2', division: 'MEP' }];
    const view = presentProject(project, rows);
    expect(view.virtual).toBe(false);
    expect(view.packageArchitecture).toBe(true);
    expect(view.packages).toBe(rows);
  });

  test('an unresolvable legacy project presents ZERO packages and flags migration review', () => {
    const view = presentProject(legacyProject({ div: 'Other' }));
    expect(view.packages).toEqual([]);
    expect(view.migrationReviewRequired).toBe(true);
  });

  test('MEP and HVAC legacy projects never present a combined division', () => {
    expect(presentProject(legacyProject({ div: 'MEP' })).packages[0].division).toBe('MEP');
    expect(presentProject(legacyProject({ div: 'HVAC' })).packages[0].division).toBe('HVAC');
  });
});

describe('legacy history is read-only to v3', () => {
  test('the protected legacy field list covers every v2-owned operational field', () => {
    for (const field of ['chk', 'updates', 'dc', 'engs', 'pm', 'div']) {
      expect(LEGACY_HISTORY_FIELDS).toContain(field);
    }
  });

  test('legacy history is read-only both before and after conversion', () => {
    expect(legacyHistoryIsReadOnly()).toBe(true);
  });

  test('isLegacyProject distinguishes the two architectures', () => {
    expect(isLegacyProject(legacyProject())).toBe(true);
    expect(isLegacyProject(legacyProject({ packageArchitecture: true }))).toBe(false);
  });
});
