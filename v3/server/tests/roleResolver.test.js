// Tests for services/roleResolver.js — ROLE_HIERARCHY.md §5 / LEGACY_ROLE_COMPATIBILITY.md.
const { resolve, LEGACY_ROLE_MAP } = require('../src/services/roleResolver');

describe('roleResolver.resolve', () => {
  test('v3-native user with designation+department is passed through unchanged', () => {
    const r = resolve({ role: 'admin', designation: 'sales_manager', department: 'SALES', division: null });
    expect(r).toEqual({ designation: 'sales_manager', department: 'SALES', division: null });
  });

  test('legacy super -> super_admin/ADMIN/null', () => {
    expect(resolve({ role: 'super' })).toEqual({ designation: 'super_admin', department: 'ADMIN', division: null });
  });

  test('legacy admin -> company_admin/ADMIN/null', () => {
    expect(resolve({ role: 'admin' })).toEqual({ designation: 'company_admin', department: 'ADMIN', division: null });
  });

  test.each([
    ['hvac_dm', 'hvac_manager', 'HVAC', 'HVAC'],
    ['solar_dm', 'solar_manager', 'SOLAR', 'SOLAR'],
    ['mep_dm', 'mep_manager', 'MEP', 'MEP'],
  ])('legacy %s -> %s/%s/%s (divisional manager)', (role, designation, department, division) => {
    expect(resolve({ role })).toEqual({ designation, department, division });
  });

  test.each([
    ['hvac_pm', 'HVAC'],
    ['solar_pm', 'SOLAR'],
    ['mep_pm', 'MEP'],
  ])('legacy %s -> project_manager/PROJECTS/%s', (role, division) => {
    expect(resolve({ role })).toEqual({ designation: 'project_manager', department: 'PROJECTS', division });
  });

  test('legacy engineer -> engineer designation, department/division left null (never assumed)', () => {
    expect(resolve({ role: 'engineer' })).toEqual({ designation: 'engineer', department: null, division: null });
  });

  test('legacy service_eng -> engineer/SERVICE/null', () => {
    expect(resolve({ role: 'service_eng' })).toEqual({ designation: 'engineer', department: 'SERVICE', division: null });
  });

  test('legacy service_mgr -> service_manager/SERVICE/null', () => {
    expect(resolve({ role: 'service_mgr' })).toEqual({ designation: 'service_manager', department: 'SERVICE', division: null });
  });

  test('legacy sales -> sales_executive/SALES/null', () => {
    expect(resolve({ role: 'sales' })).toEqual({ designation: 'sales_executive', department: 'SALES', division: null });
  });

  test('legacy store -> inventory_manager/INVENTORY/null (normalized off the frozen dept enum, not STORE)', () => {
    expect(resolve({ role: 'store' })).toEqual({ designation: 'inventory_manager', department: 'INVENTORY', division: null });
  });

  test('legacy accounts -> executive/FINANCE/null (normalized off the frozen dept enum, not ACCOUNTS)', () => {
    expect(resolve({ role: 'accounts' })).toEqual({ designation: 'executive', department: 'FINANCE', division: null });
  });

  test('legacy viewer -> viewer/ADMIN/null', () => {
    expect(resolve({ role: 'viewer' })).toEqual({ designation: 'viewer', department: 'ADMIN', division: null });
  });

  test('unknown/missing role -> safe default (viewer/ADMIN/null), never a crash', () => {
    expect(resolve({ role: 'not-a-real-role' })).toEqual({ designation: 'viewer', department: 'ADMIN', division: null });
    expect(resolve({})).toEqual({ designation: 'viewer', department: 'ADMIN', division: null });
    expect(resolve(null)).toEqual({ designation: 'viewer', department: 'ADMIN', division: null });
  });

  test('never mutates the input user object', () => {
    const user = { role: 'hvac_dm' };
    const before = JSON.stringify(user);
    resolve(user);
    expect(JSON.stringify(user)).toBe(before);
  });

  test('LEGACY_ROLE_MAP has exactly the 15 documented legacy roles', () => {
    expect(Object.keys(LEGACY_ROLE_MAP).sort()).toEqual([
      'accounts', 'admin', 'engineer', 'hvac_dm', 'hvac_pm', 'mep_dm', 'mep_pm',
      'sales', 'service_eng', 'service_mgr', 'solar_dm', 'solar_pm', 'store', 'super', 'viewer',
    ]);
  });
});
