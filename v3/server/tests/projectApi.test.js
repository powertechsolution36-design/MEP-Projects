// Phase 5 — API-level tests for /api/v3/projects and the frozen package sub-tree, through the REAL
// Express app and the REAL middleware chain.
//
// §6 is the point: every Project and ProjectPackage request must pass auth -> company scope ->
// entitlement -> division -> department -> project/package scope -> permission -> ownership ->
// record state -> validation -> audit. UI hiding is not security, so each of these is asserted at
// the HTTP boundary rather than at the service layer.
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));
jest.mock('../src/models/AuditLog', () => ({ create: jest.fn().mockResolvedValue({ _id: 'a1' }) }));
jest.mock('../src/models/RecordCorrection', () => ({ create: jest.fn().mockResolvedValue({ _id: 'c1' }), deleteOne: jest.fn() }));
jest.mock('../src/models/Project', () => ({ findById: jest.fn(), find: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock('../src/models/ProjectPackage', () => ({ findById: jest.fn(), findOne: jest.fn(), find: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const { app } = require('../src/app/app');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Project = require('../src/models/Project');
const ProjectPackage = require('../src/models/ProjectPackage');
const { PERMISSIONS, RECORD_STATES } = require('../src/config/constants');

const CO_A = 'co-a';
const CO_B = 'co-b';
const OWNER = 'u-owner';

function lean(value) { return { lean: () => Promise.resolve(value) }; }
function tokenFor(id) { return jwt.sign({ id }, env.JWT_SECRET); }
const auth = (id) => ({ Authorization: `Bearer ${tokenFor(id)}` });

function mockUser(id, overrides = {}) {
  User.findById.mockReturnValueOnce({
    select: () => ({ lean: () => Promise.resolve({ _id: id, co: CO_A, disabled: false, ...overrides }) }),
  });
}
function mockCompany(divisions = '*') {
  Company.findById.mockReturnValue(lean({
    _id: CO_A, entitlements: { modules: '*', divisions, enforceEntitlements: true },
  }));
}

function v3Project(overrides = {}) {
  return {
    _id: 'proj-1', co: CO_A, code: 'PRJ-1', name: 'Tower A',
    divisions: ['MEP', 'HVAC'], packageArchitecture: true,
    recordState: RECORD_STATES.DRAFT, createdByUserId: OWNER,
    accessList: undefined, ...overrides,
  };
}
function hvacPackage(overrides = {}) {
  return {
    _id: 'pkg-hvac', co: CO_A, projectId: 'proj-1', division: 'HVAC', code: 'P-HVAC',
    recordState: RECORD_STATES.DRAFT, createdByUserId: OWNER, status: 'planning', ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompany();
  Project.findById.mockReturnValue(lean(v3Project()));
  Project.find.mockReturnValue({ limit: () => lean([v3Project()]) });
  Project.create.mockImplementation(async (doc) => ({ _id: 'proj-new', ...doc }));
  Project.findByIdAndUpdate.mockImplementation(async (id, u) => ({ _id: id, ...u.$set }));
  ProjectPackage.findById.mockReturnValue(lean(hvacPackage()));
  ProjectPackage.findOne.mockReturnValue(lean(null));
  ProjectPackage.find.mockReturnValue(lean([hvacPackage()]));
  ProjectPackage.create.mockImplementation(async (doc) => ({ _id: 'pkg-new', ...doc }));
});

describe('§6 — authentication and permission gates', () => {
  test('an unauthenticated project read is 401, never 403', async () => {
    const res = await request(app).get('/api/v3/projects');
    expect(res.status).toBe(401);
  });

  test('an unauthenticated package read is 401', async () => {
    const res = await request(app).get('/api/v3/projects/proj-1/packages');
    expect(res.status).toBe(401);
  });

  test('a user without VIEW cannot list projects', async () => {
    mockUser('u-x', { role: 'engineer', permissions: [] });
    const res = await request(app).get('/api/v3/projects').set(auth('u-x'));
    expect(res.status).toBe(403);
  });

  test('a user without CREATE cannot create a project', async () => {
    mockUser('u-x', { role: 'engineer', permissions: [PERMISSIONS.VIEW] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-x'))
      .send({ name: 'T', divisions: ['MEP'] });
    expect(res.status).toBe(403);
    expect(Project.create).not.toHaveBeenCalled();
  });

  test('validation runs before the handler — a project with no name is 422', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a')).send({ divisions: ['MEP'] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a package request with NO division is 403, not 422 — authorization precedes validation', async () => {
    // The frozen chain (§6) runs division scope BEFORE validation, so a request that names no
    // division cannot be authorized in the first place. 403-before-422 is the correct ordering:
    // the request is refused before any of its content is inspected.
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-a')).send({});
    expect(res.status).toBe(403);
  });

  test('a package request WITH a division but no code reaches validation and is 422', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-a'))
      .send({ division: 'HVAC' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('§6 — tenant isolation (company scope)', () => {
  test('reading another company\'s project is 403', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ co: CO_B })));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).get('/api/v3/projects/proj-1').set(auth('u-a'));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cross-company/i);
  });

  test('reading another company\'s package is 403', async () => {
    ProjectPackage.findById.mockReturnValue(lean(hvacPackage({ co: CO_B })));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).get('/api/v3/projects/proj-1/packages/pkg-hvac').set(auth('u-a'));
    expect(res.status).toBe(403);
  });

  test('editing another company\'s project is 403 even for a Company Admin', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ co: CO_B })));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth('u-a')).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  test('a client-supplied companyId can never widen scope on create', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a'))
      .send({ name: 'T', divisions: ['MEP'], companyId: CO_B, co: CO_B });
    expect(res.status).toBe(201);
    expect(res.body.project.co).toBe(CO_A);
  });
});

describe('§5 / §13 — division rules at the API boundary', () => {
  test('a project in an unentitled division is refused 403', async () => {
    mockCompany(['SOLAR']);
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a'))
      .send({ name: 'T', divisions: ['HVAC'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DIVISION_NOT_ENTITLED');
  });

  test('an unknown division is refused 422', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a'))
      .send({ name: 'T', divisions: ['Other'] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_DIVISION');
  });

  test('a combined MEP/HVAC division is refused', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a'))
      .send({ name: 'T', divisions: ['MEP/HVAC'] });
    expect(res.status).toBe(422);
  });

  test('a multi-division project creates one package per division, MEP and HVAC separate', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a'))
      .send({ name: 'Tower', code: 'TWR', divisions: ['SOLAR', 'MEP', 'HVAC'] });
    expect(res.status).toBe(201);
    expect(res.body.packages.map((p) => p.division).sort()).toEqual(['HVAC', 'MEP', 'SOLAR']);
  });

  test('an MEP manager cannot create an HVAC package — divisions never merge', async () => {
    mockUser('u-mep', { role: 'mep_dm', designation: 'mep_manager', division: 'MEP', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-mep'))
      .send({ division: 'HVAC', code: 'P-HVAC' });
    expect(res.status).toBe(403);
  });

  test('an HVAC manager CAN create an HVAC package on a project that has HVAC', async () => {
    mockUser('u-hvac', { role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-hvac'))
      .send({ division: 'HVAC', code: 'P-HVAC' });
    expect(res.status).toBe(201);
    expect(res.body.package.division).toBe('HVAC');
  });

  test('an HVAC manager cannot create an MEP package', async () => {
    mockUser('u-hvac', { role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-hvac'))
      .send({ division: 'MEP', code: 'P-MEP' });
    expect(res.status).toBe(403);
  });

  test('a UI selectedDivision in the body is NOT an authorization input', async () => {
    // The MEP manager claims HVAC context; authorization still comes from their resolved division
    // and the record's real division, so the HVAC package request is still refused.
    mockUser('u-mep', { role: 'mep_dm', designation: 'mep_manager', division: 'MEP', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-mep'))
      .send({ division: 'HVAC', code: 'P-HVAC', selectedDivision: 'HVAC' });
    expect(res.status).toBe(403);
  });
});

describe('§7 — ownership at the API boundary', () => {
  test('the creator may edit their own DRAFT project', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth(OWNER)).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
  });

  test('another employee editing the creator\'s project is 403', async () => {
    mockUser('u-other', { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth('u-other')).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not the record owner/i);
  });

  test('a Manager editing the creator\'s project is 403 — no silent manager edit', async () => {
    mockUser('u-mgr', { role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth('u-mgr')).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  test('a Company Admin editing the creator\'s project is 403 — no generic admin bypass', async () => {
    mockUser('u-admin', { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth('u-admin')).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  test('a Manager with an EXPLICIT Project.override goes through the correction path instead', async () => {
    mockUser('u-mgr', {
      role: 'hvac_dm', designation: 'hvac_manager', division: 'HVAC',
      permissions: [PERMISSIONS.EDIT, 'Project.override'],
    });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth('u-mgr'))
      .send({ name: 'Corrected', _reason: 'Client renamed the site in the signed contract' });
    expect(res.status).toBe(200);
  });

  test('another employee deleting the creator\'s package is 403', async () => {
    mockUser('u-other', { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/api/v3/projects/proj-1/packages/pkg-hvac').set(auth('u-other'))
      .send({ deletionReason: 'Package created against the wrong project by mistake' });
    expect(res.status).toBe(403);
  });

  test('createdByUserId cannot be reassigned through an update', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth(OWNER))
      .send({ name: 'ok', createdByUserId: 'u-attacker' });
    expect(res.status).toBe(200);
    const update = Project.findByIdAndUpdate.mock.calls[0][1].$set;
    expect(update.createdByUserId).toBeUndefined();
  });
});

describe('§8 — record state at the API boundary', () => {
  test('a LOCKED project cannot be edited, creator included', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ recordState: RECORD_STATES.LOCKED })));
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).put('/api/v3/projects/proj-1').set(auth(OWNER)).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/locked/i);
  });

  test('a SUBMITTED project cannot be deleted but can still be edited', async () => {
    Project.findById.mockReturnValue(lean(v3Project({ recordState: RECORD_STATES.SUBMITTED })));
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.DELETE, PERMISSIONS.EDIT] });
    const del = await request(app).delete('/api/v3/projects/proj-1').set(auth(OWNER))
      .send({ deletionReason: 'Cancelled by the client before mobilization began' });
    expect(del.status).toBe(403);

    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.EDIT] });
    const put = await request(app).put('/api/v3/projects/proj-1').set(auth(OWNER)).send({ name: 'ok' });
    expect(put.status).toBe(200);
  });

  test('submit is a business action authorized by SUBMIT, not by ownership', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.SUBMIT] });
    const res = await request(app).post('/api/v3/projects/proj-1/submit').set(auth(OWNER)).send({});
    expect(res.status).toBe(200);
    expect(res.body.project.recordState).toBe(RECORD_STATES.SUBMITTED);
  });

  test('a delete with no substantive reason is 422', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/api/v3/projects/proj-1').set(auth(OWNER)).send({ deletionReason: 'no' });
    expect(res.status).toBe(422);
  });

  test('a delete is always SOFT — the row is flagged, never removed', async () => {
    mockUser(OWNER, { role: 'engineer', permissions: [PERMISSIONS.DELETE] });
    const res = await request(app).delete('/api/v3/projects/proj-1').set(auth(OWNER))
      .send({ deletionReason: 'Duplicate project raised during the data entry backlog' });
    expect(res.status).toBe(200);
    expect(res.body.project.deleted).toBe(true);
  });
});

describe('§4 — legacy projects through the API', () => {
  const legacy = { _id: 'proj-legacy', co: CO_A, code: 'OLD-1', name: 'Legacy Site', div: 'HVAC', status: 'active', chk: [{ title: 'x' }] };

  test('a legacy project reads back as ONE VIRTUAL package with nothing materialized', async () => {
    Project.findById.mockReturnValue(lean(legacy));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).get('/api/v3/projects/proj-legacy/packages').set(auth('u-a'));
    expect(res.status).toBe(200);
    expect(res.body.virtual).toBe(true);
    expect(res.body.packages).toHaveLength(1);
    expect(res.body.packages[0].division).toBe('HVAC');
    expect(ProjectPackage.create).not.toHaveBeenCalled();
  });

  test("a legacy project with div 'Other' surfaces migration review and grants no division", async () => {
    Project.findById.mockReturnValue(lean({ ...legacy, div: 'Other' }));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).get('/api/v3/projects/proj-legacy').set(auth('u-a'));
    expect(res.status).toBe(200);
    expect(res.body.migrationReviewRequired).toBe(true);
    expect(res.body.divisions).toEqual([]);
    expect(res.body.packages).toEqual([]);
  });

  test('conversion is explicit, and never copies legacy history into the new package', async () => {
    Project.findById.mockReturnValue(lean({ ...legacy, createdByUserId: OWNER, recordState: RECORD_STATES.DRAFT }));
    mockUser(OWNER, { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).post('/api/v3/projects/proj-legacy/convert-to-packages').set(auth(OWNER))
      .send({ reason: 'Adding an MEP scope to this HVAC project' });
    expect(res.status).toBe(201);
    expect(res.body.packages[0].division).toBe('HVAC');
    expect(res.body.packages[0].chk).toBeUndefined();
    expect(res.body.project.packageArchitecture).toBe(true);
  });

  test("converting an unresolvable 'Other' project is refused, not guessed", async () => {
    Project.findById.mockReturnValue(lean({ ...legacy, div: 'Other', createdByUserId: OWNER, recordState: RECORD_STATES.DRAFT }));
    mockUser(OWNER, { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).post('/api/v3/projects/proj-legacy/convert-to-packages').set(auth(OWNER)).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MIGRATION_REVIEW_REQUIRED');
  });

  test('a non-owner cannot convert someone else\'s project', async () => {
    Project.findById.mockReturnValue(lean({ ...legacy, createdByUserId: OWNER, recordState: RECORD_STATES.DRAFT }));
    mockUser('u-other', { role: 'admin', designation: 'company_admin', permissions: [PERMISSIONS.EDIT] });
    const res = await request(app).post('/api/v3/projects/proj-legacy/convert-to-packages').set(auth('u-other')).send({});
    expect(res.status).toBe(403);
  });

  test('adding a package to an unconverted legacy project is refused with a clear next step', async () => {
    Project.findById.mockReturnValue(lean(legacy));
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-legacy/packages').set(auth('u-a'))
      .send({ division: 'HVAC', code: 'P-HVAC' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSION_REQUIRED');
  });
});

describe('§11 — cross-division PM access with package-level authorization intact', () => {
  test('a cross-division Project Manager can read the whole project and all its packages', async () => {
    mockUser('u-pm', {
      role: 'hvac_pm', designation: 'project_manager', department: 'PROJECTS',
      division: null, projectAccess: ['proj-1'], permissions: ['*'],
    });
    const res = await request(app).get('/api/v3/projects/proj-1/packages').set(auth('u-pm'));
    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveLength(1);
  });

  test('a divisional manager is still confined to their own division\'s package', async () => {
    mockUser('u-mep', { role: 'mep_dm', designation: 'mep_manager', division: 'MEP', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects/proj-1/packages').set(auth('u-mep'))
      .send({ division: 'HVAC', code: 'X' });
    expect(res.status).toBe(403);
  });

  test('an engineer not assigned to the package cannot edit it', async () => {
    ProjectPackage.findById.mockReturnValue(lean(hvacPackage({ accessList: ['u-assigned'] })));
    mockUser('u-eng', {
      role: 'engineer', designation: 'engineer', division: 'HVAC', department: 'HVAC',
      projectAccess: [], permissions: [PERMISSIONS.EDIT],
    });
    const res = await request(app).put('/api/v3/projects/proj-1/packages/pkg-hvac').set(auth('u-eng'))
      .send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('§9 — forward linkage exists without any future module being built', () => {
  test('soNo and the FK fields are accepted and stored on create', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    const res = await request(app).post('/api/v3/projects').set(auth('u-a')).send({
      name: 'Tower', divisions: ['MEP'],
      soNo: 'SO-2026-014', salesOrderId: '65b000000000000000000001', customerId: '65b000000000000000000002',
    });
    expect(res.status).toBe(201);
    expect(res.body.project.soNo).toBe('SO-2026-014');
    expect(res.body.project.salesOrderId).toBe('65b000000000000000000001');
  });

  test('no Sales Order, BOQ, Payment, Inventory or Checklist route is mounted by Phase 5', async () => {
    mockUser('u-a', { role: 'admin', designation: 'company_admin', permissions: ['*'] });
    for (const path of ['/api/v3/sales-orders', '/api/v3/boqs', '/api/v3/payments', '/api/v3/material-requests', '/api/v3/checklist-instances']) {
      const res = await request(app).get(path).set(auth('u-a'));
      expect(res.status).toBe(404);
    }
  });
});
