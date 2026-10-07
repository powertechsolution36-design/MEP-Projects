'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRoleAllowedForCompany, ROLES } = require('../../src/auth/roleDivision');

test('18. PM role/division validation — matching division is allowed', () => {
  const company = { divisions: ['HVAC', 'Solar'] };
  assert.doesNotThrow(() => assertRoleAllowedForCompany('hvac_pm', company));
  assert.doesNotThrow(() => assertRoleAllowedForCompany('solar_pm', company));
});

test('18. PM role/division validation — incompatible division is rejected', () => {
  const company = { divisions: ['HVAC'] };
  assert.throws(() => assertRoleAllowedForCompany('solar_pm', company), /Solar/);
  assert.throws(() => assertRoleAllowedForCompany('mep_pm', company), /MEP/);
});

test('18. non-PM roles never require a division and are unaffected by company divisions', () => {
  const company = { divisions: [] };
  for (const role of ['admin', 'sales', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance', 'super']) {
    assert.doesNotThrow(() => assertRoleAllowedForCompany(role, company));
  }
});

test('19. an invalid/unknown role is rejected', () => {
  const company = { divisions: ['HVAC', 'Solar', 'MEP'] };
  assert.throws(() => assertRoleAllowedForCompany('not_a_real_role', company), /Unknown role/);
});

test('exactly the 11 PWA-observed roles are recognized — no invented roles', () => {
  assert.deepEqual(
    [...ROLES].sort(),
    ['super', 'admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance'].sort()
  );
});
