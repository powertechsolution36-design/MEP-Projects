// Tests for checkDepartment() (src/middleware/department.js) — deliberately separate from division.
const { checkDepartment } = require('../src/middleware/department');

describe('checkDepartment', () => {
  test('super bypasses department scope', () => {
    expect(checkDepartment({ user: { role: 'super' }, targetDepartment: 'FINANCE' }).allowed).toBe(true);
  });

  test('company_admin bypasses department scope', () => {
    expect(checkDepartment({ user: { role: 'admin', designation: 'company_admin' }, targetDepartment: 'FINANCE' }).allowed).toBe(true);
  });

  test('matching department -> allowed', () => {
    expect(checkDepartment({ user: { role: 'engineer', department: 'PROJECTS' }, targetDepartment: 'PROJECTS' }).allowed).toBe(true);
  });

  test('wrong department -> denied', () => {
    const d = checkDepartment({ user: { role: 'engineer', department: 'SALES' }, targetDepartment: 'FINANCE' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/wrong department/i);
  });

  test('a Project Manager (department=PROJECTS) is distinct from a Divisional Manager (department=division) — PROJECTS user denied a SOLAR-department resource', () => {
    const d = checkDepartment({ user: { role: 'project_manager', department: 'PROJECTS', division: 'SOLAR' }, targetDepartment: 'SOLAR' });
    expect(d.allowed).toBe(false);
  });

  test('unknown department value -> denied', () => {
    const d = checkDepartment({ user: { department: 'PROJECTS' }, targetDepartment: 'NOT_A_DEPT' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/unknown department/i);
  });

  test('no department on user -> denied', () => {
    expect(checkDepartment({ user: { department: null }, targetDepartment: 'SALES' }).allowed).toBe(false);
  });

  test('no user -> denied', () => {
    expect(checkDepartment({ user: null, targetDepartment: 'SALES' }).allowed).toBe(false);
  });
});
