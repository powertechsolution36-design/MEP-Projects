// Tests for checkProjectScope()/checkPackageScope() (src/middleware/projectScope.js).
const { checkProjectScope, checkPackageScope } = require('../src/middleware/projectScope');

const CO_A = 'co-a';
const CO_B = 'co-b';

function project(overrides = {}) {
  return { _id: 'proj-1', co: CO_A, division: 'SOLAR', department: 'PROJECTS', assignedUserId: null, accessList: [], ...overrides };
}

describe('checkProjectScope', () => {
  test('super allowed regardless of project', () => {
    expect(checkProjectScope({ user: { role: 'super' }, project: project() }).allowed).toBe(true);
  });

  test('company_admin allowed within own company', () => {
    const user = { role: 'admin', designation: 'company_admin', co: CO_A };
    expect(checkProjectScope({ user, project: project() }).allowed).toBe(true);
  });

  test('cross-company access denied even for company_admin of a different company', () => {
    const user = { role: 'admin', designation: 'company_admin', co: CO_B };
    const d = checkProjectScope({ user, project: project() });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/cross-company/i);
  });

  test('divisional manager (solar_manager) allowed on a SOLAR project', () => {
    const user = { role: 'hvac_dm', designation: 'solar_manager', co: CO_A, division: 'SOLAR' };
    expect(checkProjectScope({ user, project: project({ division: 'SOLAR' }) }).allowed).toBe(true);
  });

  test('divisional manager denied cross-division (mep_manager on a SOLAR project)', () => {
    const user = { designation: 'mep_manager', co: CO_A, division: 'MEP' };
    const d = checkProjectScope({ user, project: project({ division: 'SOLAR' }) });
    expect(d.allowed).toBe(false);
  });

  test('project_manager allowed for a project on their own division and in projectAccess[]', () => {
    const user = { designation: 'project_manager', co: CO_A, division: 'SOLAR', projectAccess: ['proj-1'] };
    expect(checkProjectScope({ user, project: project({ _id: 'proj-1', division: 'SOLAR' }) }).allowed).toBe(true);
  });

  test('project_manager denied for a project not in their projectAccess[] (wrong project)', () => {
    const user = { designation: 'project_manager', co: CO_A, division: 'SOLAR', projectAccess: ['proj-999'] };
    const d = checkProjectScope({ user, project: project({ _id: 'proj-1', division: 'SOLAR' }) });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/not assigned/i);
  });

  test('project_manager denied for a project in a different division', () => {
    const user = { designation: 'project_manager', co: CO_A, division: 'MEP', projectAccess: ['proj-1'] };
    const d = checkProjectScope({ user, project: project({ _id: 'proj-1', division: 'SOLAR' }) });
    expect(d.allowed).toBe(false);
  });

  test('engineer allowed when assignedUserId matches', () => {
    const user = { _id: 'eng-1', designation: 'engineer', co: CO_A };
    expect(checkProjectScope({ user, project: project({ assignedUserId: 'eng-1' }) }).allowed).toBe(true);
  });

  test('engineer allowed via accessList even without assignedUserId match', () => {
    const user = { _id: 'eng-2', designation: 'engineer', co: CO_A };
    expect(checkProjectScope({ user, project: project({ assignedUserId: 'eng-1', accessList: ['eng-2'] }) }).allowed).toBe(true);
  });

  test('engineer denied when neither assigned nor in accessList', () => {
    const user = { _id: 'eng-3', designation: 'engineer', co: CO_A };
    const d = checkProjectScope({ user, project: project({ assignedUserId: 'eng-1', accessList: ['eng-2'] }) });
    expect(d.allowed).toBe(false);
  });

  test('project not found -> denied', () => {
    expect(checkProjectScope({ user: { role: 'super' }, project: null }).allowed).toBe(false);
  });
});

describe('checkPackageScope', () => {
  test('inherits denial from the parent project', () => {
    const user = { designation: 'engineer', _id: 'eng-9', co: CO_A };
    const d = checkPackageScope({
      user,
      pkg: { co: CO_A, projectId: 'proj-1' },
      project: project({ assignedUserId: 'someone-else', accessList: [] }),
    });
    expect(d.allowed).toBe(false);
  });

  test('package-level accessList further restricts an engineer even if the project would allow them', () => {
    const user = { designation: 'engineer', _id: 'eng-9', co: CO_A };
    const d = checkPackageScope({
      user,
      pkg: { co: CO_A, projectId: 'proj-1', accessList: ['eng-other'] },
      project: project({ assignedUserId: 'eng-9' }),
    });
    expect(d.allowed).toBe(false);
  });

  test('company_admin bypasses package-level accessList', () => {
    const user = { role: 'admin', designation: 'company_admin', co: CO_A };
    const d = checkPackageScope({ user, pkg: { co: CO_A, projectId: 'proj-1', accessList: ['someone-else'] } });
    expect(d.allowed).toBe(true);
  });

  test('cross-company package access denied', () => {
    const user = { designation: 'engineer', _id: 'eng-9', co: CO_B };
    const d = checkPackageScope({ user, pkg: { co: CO_A, projectId: 'proj-1' } });
    expect(d.allowed).toBe(false);
  });
});
