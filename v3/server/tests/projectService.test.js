// Phase 5 — Project / ProjectPackage services.
//
// Focus: the rules specific to this phase (division validity, entitlement-driven division access,
// sub-trade-belongs-to-division, the explicit conversion path, no duplicate packages) and proof
// that ownership / immutability / audit are INHERITED from the Phase 4 record service rather than
// re-implemented here.
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({ _id: 'a1' }) }));
jest.mock('../src/models/RecordCorrection', () => ({ create: jest.fn().mockResolvedValue({ _id: 'c1' }), deleteOne: jest.fn() }));
jest.mock('../src/models/Project', () => ({ findById: jest.fn(), find: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock('../src/models/ProjectPackage', () => ({ findById: jest.fn(), findOne: jest.fn(), find: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn() }));

const AuditLog = require('../src/models/AuditLog');
const Project = require('../src/models/Project');
const ProjectPackage = require('../src/models/ProjectPackage');
const projectService = require('../src/services/projectService');
const packageService = require('../src/services/projectPackageService');
const { RECORD_STATES } = require('../src/config/constants');
const { getResourcePolicy } = require('../src/config/recordPolicy');

function lean(value) { return { lean: () => Promise.resolve(value) }; }

function makeReq({ entitlements = { divisions: ['SOLAR', 'MEP', 'HVAC'], enforceEntitlements: true }, ...rest } = {}) {
  return {
    user: { _id: 'u-a', co: 'co-a', name: 'Asha' },
    method: 'POST',
    originalUrl: '/api/v3/projects',
    headers: {},
    entitlements,
    ownershipDecision: { allowed: true, requiresCorrection: false },
    ...rest,
  };
}

function legacyProject(overrides = {}) {
  return { _id: 'proj-1', co: 'co-a', code: 'PRJ-1', name: 'Site A', div: 'HVAC', status: 'active', ...overrides };
}
function v3Project(overrides = {}) {
  return {
    _id: 'proj-2', co: 'co-a', code: 'PRJ-2', name: 'Site B',
    divisions: ['MEP', 'HVAC'], packageArchitecture: true,
    recordState: RECORD_STATES.DRAFT, createdByUserId: 'u-a', ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  AuditLog.create.mockResolvedValue({ _id: 'a1' });
  Project.create.mockImplementation(async (doc) => ({ _id: 'proj-new', ...doc }));
  Project.findByIdAndUpdate.mockImplementation(async (id, update) => ({ _id: id, ...update.$set }));
  ProjectPackage.create.mockImplementation(async (doc) => ({ _id: `pkg-${doc.division}`, ...doc }));
  ProjectPackage.findOne.mockReturnValue(lean(null));
  ProjectPackage.find.mockReturnValue(lean([]));
});

describe('§5 — divisions are SOLAR / MEP / HVAC only, resolved dynamically', () => {
  test('accepts the three valid divisions', () => {
    expect(projectService.assertValidDivisions(['SOLAR', 'MEP', 'HVAC'], { divisions: '*' }))
      .toEqual(['SOLAR', 'MEP', 'HVAC']);
  });

  test.each(['Other', 'OTHER', 'MEP/HVAC', 'Solar', 'plumbing', ''])(
    'rejects the invalid division %p',
    (division) => {
      expect(() => projectService.assertValidDivisions([division], { divisions: '*' }))
        .toThrow(/Unknown division/);
    },
  );

  test('a combined "MEP/HVAC" value is rejected outright — the two are never merged', () => {
    expect(() => projectService.assertValidDivisions(['MEP/HVAC'], { divisions: '*' }))
      .toThrow(/Unknown division/);
  });

  test('an empty division list is rejected', () => {
    expect(() => projectService.assertValidDivisions([], { divisions: '*' })).toThrow(/at least one/i);
  });

  test('a duplicated division is rejected', () => {
    expect(() => projectService.assertValidDivisions(['MEP', 'MEP'], { divisions: '*' })).toThrow(/Duplicate/);
  });

  test('§13 — a division the company has not purchased is refused via the LIVE entitlement set', () => {
    expect(() => projectService.assertValidDivisions(['HVAC'], { divisions: ['SOLAR'], enforceEntitlements: true }))
      .toThrow(/not entitled to division: HVAC/);
  });

  test('entitlements are consulted dynamically — no plan name is ever referenced', () => {
    // The same call passes or fails purely on the resolved entitlement set.
    expect(() => projectService.assertValidDivisions(['HVAC'], { divisions: ['SOLAR', 'HVAC'], enforceEntitlements: true }))
      .not.toThrow();
  });

  test('enforcement off (legacy company) does not block, matching Phase 3 enforcement modes', () => {
    expect(() => projectService.assertValidDivisions(['HVAC'], { divisions: [], enforceEntitlements: false }))
      .not.toThrow();
  });
});

describe('sub-trades must belong to their own division', () => {
  test('an MEP sub-trade is valid on an MEP project', () => {
    expect(projectService.assertValidSubTrades(['ELECTRICAL'], ['MEP'])).toEqual(['ELECTRICAL']);
  });

  test('an HVAC sub-trade on an MEP-only project is rejected', () => {
    expect(() => projectService.assertValidSubTrades(['VRF'], ['MEP']))
      .toThrow(/does not belong to division/);
  });

  test('an MEP sub-trade on an HVAC-only project is rejected', () => {
    expect(() => projectService.assertValidSubTrades(['ELECTRICAL'], ['HVAC']))
      .toThrow(/does not belong to division/);
  });

  test('a multi-division project accepts sub-trades from each of its divisions', () => {
    expect(projectService.assertValidSubTrades(['ELECTRICAL', 'VRF'], ['MEP', 'HVAC']))
      .toEqual(['ELECTRICAL', 'VRF']);
  });

  test('an unknown sub-trade is rejected', () => {
    expect(() => projectService.assertValidSubTrades(['TELEPORTATION'], ['MEP'])).toThrow(/does not belong/);
  });

  test('package-level validation is single-division and stricter still', () => {
    expect(() => packageService.assertPackageSubTrades(['VRF'], 'MEP')).toThrow(/does not belong to division MEP/);
    expect(packageService.assertPackageSubTrades(['VRF'], 'HVAC')).toEqual(['VRF']);
  });
});

describe('createProject — a v3-native multi-division project materializes real packages', () => {
  test('creates one ProjectPackage per division, each with a single division', async () => {
    const { project, packages } = await projectService.createProject({
      req: makeReq(), payload: { name: 'Tower A', code: 'TWR', divisions: ['MEP', 'HVAC'] },
    });

    expect(project.packageArchitecture).toBe(true);
    expect(packages).toHaveLength(2);
    expect(packages.map((p) => p.division).sort()).toEqual(['HVAC', 'MEP']);
    // Two separate rows — never one combined MEP/HVAC package.
    expect(packages[0].division).not.toBe(packages[1].division);
  });

  test('the creator becomes the owner of the project and of every package (Phase 4 §7)', async () => {
    const { project, packages } = await projectService.createProject({
      req: makeReq(), payload: { name: 'Tower A', divisions: ['SOLAR'] },
    });
    expect(project.createdByUserId).toBe('u-a');
    expect(project.co).toBe('co-a');
    expect(packages[0].createdByUserId).toBe('u-a');
  });

  test('createdByName is stamped as a display cache only', async () => {
    const { project } = await projectService.createProject({
      req: makeReq(), payload: { name: 'Tower A', divisions: ['SOLAR'] },
    });
    expect(project.createdByName).toBe('Asha');
  });

  test('the governance state starts at DRAFT on `recordState`, leaving `status` operational', async () => {
    const { project, packages } = await projectService.createProject({
      req: makeReq(), payload: { name: 'Tower A', divisions: ['SOLAR'] },
    });
    expect(project.recordState).toBe(RECORD_STATES.DRAFT);
    expect(project.status).toBeUndefined();          // never overwritten with a governance value
    expect(packages[0].status).toBe('planning');     // operational default
    expect(packages[0].recordState).toBe(RECORD_STATES.DRAFT);
  });

  test('a CREATE audit entry is written for the project and each package', async () => {
    await projectService.createProject({ req: makeReq(), payload: { name: 'T', divisions: ['MEP', 'HVAC'] } });
    const creates = AuditLog.create.mock.calls.map((c) => c[0]);
    expect(creates.filter((e) => e.resource === 'Project' && e.action === 'CREATE')).toHaveLength(1);
    expect(creates.filter((e) => e.resource === 'ProjectPackage' && e.action === 'CREATE')).toHaveLength(2);
  });

  test('an unentitled division stops creation before anything is written', async () => {
    await expect(projectService.createProject({
      req: makeReq({ entitlements: { divisions: ['SOLAR'], enforceEntitlements: true } }),
      payload: { name: 'T', divisions: ['HVAC'] },
    })).rejects.toMatchObject({ code: 'DIVISION_NOT_ENTITLED', status: 403 });
    expect(Project.create).not.toHaveBeenCalled();
  });
});

describe('§4 — legacy projects are never forced into packages', () => {
  test('getProjectView presents a legacy project as ONE VIRTUAL package with no row written', async () => {
    Project.findById.mockReturnValue(lean(legacyProject()));
    const view = await projectService.getProjectView('proj-1');

    expect(view.virtual).toBe(true);
    expect(view.packages).toHaveLength(1);
    expect(view.packages[0].virtual).toBe(true);
    expect(ProjectPackage.create).not.toHaveBeenCalled();
    expect(ProjectPackage.find).not.toHaveBeenCalled();   // not even queried — nothing exists
  });

  test('a converted project reads its REAL package rows', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    ProjectPackage.find.mockReturnValue(lean([{ _id: 'pkg-1', division: 'MEP' }]));
    const view = await projectService.getProjectView('proj-2');
    expect(view.virtual).toBe(false);
    expect(view.packages).toHaveLength(1);
  });

  test('adding a package to a still-legacy project is REFUSED — convert explicitly first', async () => {
    Project.findById.mockReturnValue(lean(legacyProject()));
    await expect(packageService.createPackage({
      req: makeReq(), projectId: 'proj-1', payload: { division: 'HVAC', code: 'P-HVAC' },
    })).rejects.toMatchObject({ code: 'CONVERSION_REQUIRED', status: 409 });
    expect(ProjectPackage.create).not.toHaveBeenCalled();
  });
});

describe('convertToPackageArchitecture — the one sanctioned, explicit, audited path', () => {
  test('converts a legacy single-division project without copying its history', async () => {
    const project = legacyProject({ chk: [{ title: 'x' }], updates: [{ text: 'y' }], engs: ['Asha'], pm: 'Ravi' });
    Project.findById.mockReturnValue(lean(project));

    const { packages } = await projectService.convertToPackageArchitecture({ req: makeReq(), id: 'proj-1' });

    expect(packages).toHaveLength(1);
    expect(packages[0].division).toBe('HVAC');
    // The new package carries NONE of the legacy operational history.
    expect(packages[0].chk).toBeUndefined();
    expect(packages[0].updates).toBeUndefined();
    expect(packages[0].engs).toBeUndefined();
    expect(packages[0].pm).toBeUndefined();
  });

  test('marks the project converted and records who did it and when', async () => {
    Project.findById.mockReturnValue(lean(legacyProject()));
    const { project } = await projectService.convertToPackageArchitecture({ req: makeReq(), id: 'proj-1' });
    expect(project.packageArchitecture).toBe(true);
    expect(project.convertedByUserId).toBe('u-a');
    expect(project.convertedAt).toBeInstanceOf(Date);
  });

  test('writes an audit entry — conversion is never silent', async () => {
    Project.findById.mockReturnValue(lean(legacyProject()));
    await projectService.convertToPackageArchitecture({ req: makeReq(), id: 'proj-1' });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'Project',
      before: expect.objectContaining({ packageArchitecture: false }),
      after: expect.objectContaining({ packageArchitecture: true }),
    }));
  });

  test('converting to MULTI-division creates one package per division, MEP and HVAC separate', async () => {
    Project.findById.mockReturnValue(lean(legacyProject({ div: 'MEP' })));
    const { packages } = await projectService.convertToPackageArchitecture({
      req: makeReq(), id: 'proj-1', divisions: ['MEP', 'HVAC'],
    });
    expect(packages.map((p) => p.division).sort()).toEqual(['HVAC', 'MEP']);
  });

  test('a conversion that would DROP the existing division is refused — history is never orphaned', async () => {
    Project.findById.mockReturnValue(lean(legacyProject({ div: 'MEP' })));
    await expect(projectService.convertToPackageArchitecture({
      req: makeReq(), id: 'proj-1', divisions: ['HVAC'],
    })).rejects.toMatchObject({ code: 'DIVISION_REMOVAL_FORBIDDEN' });
  });

  test("a legacy project with div 'Other' is REFUSED, not auto-converted (migration review)", async () => {
    Project.findById.mockReturnValue(lean(legacyProject({ div: 'Other' })));
    await expect(projectService.convertToPackageArchitecture({ req: makeReq(), id: 'proj-1' }))
      .rejects.toMatchObject({ code: 'MIGRATION_REVIEW_REQUIRED' });
    expect(ProjectPackage.create).not.toHaveBeenCalled();
  });

  test('converting an already-converted project is refused', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    await expect(projectService.convertToPackageArchitecture({ req: makeReq(), id: 'proj-2' }))
      .rejects.toMatchObject({ code: 'ALREADY_CONVERTED', status: 409 });
  });

  test('conversion still validates against live entitlements', async () => {
    Project.findById.mockReturnValue(lean(legacyProject({ div: 'MEP' })));
    await expect(projectService.convertToPackageArchitecture({
      req: makeReq({ entitlements: { divisions: ['MEP'], enforceEntitlements: true } }),
      id: 'proj-1', divisions: ['MEP', 'HVAC'],
    })).rejects.toMatchObject({ code: 'DIVISION_NOT_ENTITLED' });
  });
});

describe('createPackage — one package per division per project', () => {
  beforeEach(() => Project.findById.mockReturnValue(lean(v3Project())));

  test('creates an MEP package on a project that has MEP', async () => {
    const pkg = await packageService.createPackage({
      req: makeReq(), projectId: 'proj-2', payload: { division: 'MEP', code: 'P-MEP' },
    });
    expect(pkg.division).toBe('MEP');
    expect(pkg.projectId).toBe('proj-2');
  });

  test('a SECOND package for the same division is refused', async () => {
    ProjectPackage.findOne.mockReturnValue(lean({ _id: 'pkg-existing', division: 'MEP' }));
    await expect(packageService.createPackage({
      req: makeReq(), projectId: 'proj-2', payload: { division: 'MEP', code: 'P-MEP-2' },
    })).rejects.toMatchObject({ code: 'DUPLICATE_PACKAGE', status: 409 });
  });

  test('a division the PROJECT does not have is refused', async () => {
    await expect(packageService.createPackage({
      req: makeReq(), projectId: 'proj-2', payload: { division: 'SOLAR', code: 'P-SOL' },
    })).rejects.toMatchObject({ code: 'DIVISION_NOT_ON_PROJECT' });
  });

  test('a division the COMPANY is not entitled to is refused', async () => {
    await expect(packageService.createPackage({
      req: makeReq({ entitlements: { divisions: ['MEP'], enforceEntitlements: true } }),
      projectId: 'proj-2', payload: { division: 'HVAC', code: 'P-HVAC' },
    })).rejects.toMatchObject({ code: 'DIVISION_NOT_ENTITLED', status: 403 });
  });

  test('a package code is required — identity is not optional (§12)', async () => {
    await expect(packageService.createPackage({
      req: makeReq(), projectId: 'proj-2', payload: { division: 'MEP' },
    })).rejects.toMatchObject({ code: 'CODE_REQUIRED' });
  });

  test('a missing parent project is 404', async () => {
    Project.findById.mockReturnValue(lean(null));
    await expect(packageService.createPackage({
      req: makeReq(), projectId: 'nope', payload: { division: 'MEP', code: 'X' },
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('§7 / §8 — Phase 4 guarantees are inherited, not re-implemented', () => {
  test('the resource policies point the governance checks at `recordState`', () => {
    expect(getResourcePolicy('Project').stateField).toBe('recordState');
    expect(getResourcePolicy('ProjectPackage').stateField).toBe('recordState');
  });

  test('legacy history fields are declared immutable to any v3 update', () => {
    const immutable = getResourcePolicy('Project').immutableFields;
    for (const field of ['chk', 'updates', 'dc', 'engs', 'pm', 'div']) {
      expect(immutable).toContain(field);
    }
  });

  test('the platform-wide ownership fields are immutable here too', () => {
    const immutable = getResourcePolicy('Project').immutableFields;
    expect(immutable).toEqual(expect.arrayContaining(['co', 'createdByUserId', 'createdAt', '_id']));
  });

  test("a package's parent, division and code are immutable — it cannot be re-pointed", () => {
    const immutable = getResourcePolicy('ProjectPackage').immutableFields;
    expect(immutable).toEqual(expect.arrayContaining(['projectId', 'division', 'code']));
  });

  test('an update trying to rewrite legacy history is rejected by the shared immutable-field guard', async () => {
    Project.findById.mockReturnValue(lean(legacyProject({ recordState: RECORD_STATES.DRAFT, createdByUserId: 'u-a' })));
    await expect(projectService.updateProject({
      req: makeReq(), id: 'proj-1', payload: { chk: [{ title: 'forged' }] },
    })).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
  });

  test('an update trying to reassign ownership is rejected', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    await expect(projectService.updateProject({
      req: makeReq(), id: 'proj-2', payload: { createdByUserId: 'u-attacker' },
    })).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
  });

  test('a mutating call with NO ownership decision is a hard error, never a silent allow', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    const req = makeReq();
    delete req.ownershipDecision;
    await expect(projectService.updateProject({ req, id: 'proj-2', payload: { name: 'x' } }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_NOT_EVALUATED' });
  });

  test('a LOCKED project cannot be edited even by its creator', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ recordState: RECORD_STATES.LOCKED })));
    await expect(projectService.updateProject({ req: makeReq(), id: 'proj-2', payload: { name: 'x' } }))
      .rejects.toMatchObject({ code: 'RECORD_LOCKED', status: 403 });
  });

  test('deleting a project is a SOFT delete requiring a substantive reason', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    const after = await projectService.deleteProject({
      req: makeReq(), id: 'proj-2', reason: 'Duplicate project created in error during data entry',
    });
    expect(after.deleted).toBe(true);
    expect(after.deletedByUserId).toBe('u-a');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
  });

  test('a short deletion reason is refused', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    await expect(projectService.deleteProject({ req: makeReq(), id: 'proj-2', reason: 'oops' }))
      .rejects.toMatchObject({ code: 'DELETION_REASON_REQUIRED' });
  });

  test('a SUBMITTED project cannot be deleted, though it can still be edited (Phase 4 §11)', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ recordState: RECORD_STATES.SUBMITTED })));
    await expect(projectService.deleteProject({
      req: makeReq(), id: 'proj-2', reason: 'Cancelled by the client before mobilization',
    })).rejects.toMatchObject({ code: 'DELETE_NOT_PERMITTED' });

    await expect(projectService.updateProject({ req: makeReq(), id: 'proj-2', payload: { name: 'ok' } }))
      .resolves.toBeDefined();
  });

  test('submit moves `recordState`, never the operational `status`', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    const after = await projectService.submitProject({ req: makeReq(), id: 'proj-2' });
    expect(after.recordState).toBe(RECORD_STATES.SUBMITTED);
    expect(after.status).toBeUndefined();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBMIT' }));
  });

  test('a division cannot be silently removed from a project by a field update', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    await expect(projectService.updateProject({
      req: makeReq(), id: 'proj-2', payload: { divisions: ['MEP'] },
    })).rejects.toMatchObject({ code: 'DIVISION_REMOVAL_FORBIDDEN' });
  });

  test('a division CAN be added to a project it is entitled to', async () => {
    Project.findById.mockReturnValue(lean(v3Project()));
    await expect(projectService.updateProject({
      req: makeReq(), id: 'proj-2', payload: { divisions: ['MEP', 'HVAC', 'SOLAR'] },
    })).resolves.toBeDefined();
  });

  test('a virtual legacy package can never be written through', async () => {
    ProjectPackage.findById.mockReturnValue(lean({ _id: 'v', virtual: true, division: 'HVAC' }));
    await expect(packageService.updatePackage({ req: makeReq(), id: 'v', payload: { name: 'x' } }))
      .rejects.toMatchObject({ code: 'VIRTUAL_PACKAGE_READONLY', status: 409 });
  });
});
