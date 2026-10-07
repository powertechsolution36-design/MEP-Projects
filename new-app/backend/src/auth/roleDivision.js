'use strict';

const { ROLES, DIVISIONS } = require('../models/shared/enums');

/**
 * PWA FACT (DOMAIN_MODEL.md §2, §Roles): the three PM roles are each bound to
 * exactly one division. "Role selection is filtered by division access — a
 * role bound to a division (hvac_pm/solar_pm/mep_pm) is only offered if the
 * company subscribes to that division."
 *
 * The User schema (DATABASE_SCHEMA.md §2) has no separate "division" field —
 * the binding is inherent in the role name itself. Enforcement therefore
 * means: a user may only be assigned a PM role if their company's
 * `divisions[]` (Company, DATABASE_SCHEMA.md §1) includes that PM role's
 * division. This module does not invent a stored division attribute for
 * non-PM roles, and does not merge HVAC/Solar/MEP into one role.
 */

const ROLE_DIVISION_MAP = Object.freeze({
  hvac_pm: 'HVAC',
  solar_pm: 'Solar',
  mep_pm: 'MEP',
});

function isKnownRole(role) {
  return ROLES.includes(role);
}

function isPmRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_DIVISION_MAP, role);
}

/**
 * @param {string} role
 * @param {{ divisions: string[] }} company
 * @throws {Error} if role is unknown, or is a PM role not covered by the company's divisions.
 */
function assertRoleAllowedForCompany(role, company) {
  if (!isKnownRole(role)) {
    throw new Error(`Unknown role "${role}". Only the PWA-observed roles are permitted: ${ROLES.join(', ')}.`);
  }
  if (!isPmRole(role)) {
    // Regular sales/engineer/service/finance/inventory/admin/super roles do
    // not receive an invented division attribute — nothing further to check.
    return;
  }
  const requiredDivision = ROLE_DIVISION_MAP[role];
  const companyDivisions = (company && company.divisions) || [];
  if (!companyDivisions.includes(requiredDivision)) {
    throw new Error(
      `Role "${role}" requires the company to subscribe to the "${requiredDivision}" division, ` +
        `but this company's divisions are: [${companyDivisions.join(', ')}].`
    );
  }
}

module.exports = { ROLE_DIVISION_MAP, ROLES, DIVISIONS, isKnownRole, isPmRole, assertRoleAllowedForCompany };
