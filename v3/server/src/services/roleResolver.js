// Legacy role compatibility resolver — ROLE_HIERARCHY.md §5 / LEGACY_ROLE_COMPATIBILITY.md.
// Pure, read-only: never mutates the stored User document (`role` stays exactly as v2 wrote it —
// LEGACY_ROLE_COMPATIBILITY.md "Rule of engagement" #1-3). V3 sets `role` explicitly only if a V3
// API action decides to change it; this resolver never does that as a side effect of a read.
//
// resolve(user):
//   if user.designation and user.department: return { designation, department, division: user.division }
//   map = LEGACY_ROLE_MAP[user.role]
//   return { designation: map.designation, department: map.department, division: map.division }
//
// DISCLOSED INTERPRETATION DECISION (see V3 PHASE 2 REPORT):
// LEGACY_ROLE_COMPATIBILITY.md's own mapping table and ROLE_HIERARCHY.md's §4 validity matrix use
// two different vocabularies for the same legacy roles:
//   - hvac_dm/solar_dm/mep_dm/service_mgr/store map to a generic 'manager' designation and to
//     department values HVAC/SOLAR/MEP/SERVICE/STORE in LEGACY_ROLE_COMPATIBILITY.md's table.
//   - ROLE_HIERARCHY.md §4's validity matrix maps the SAME legacy roles to the specific frozen
//     designations (solar_manager/mep_manager/hvac_manager/service_manager/inventory_manager) and to
//     the frozen department enum (which has INVENTORY, not STORE).
//   - ROLE_HIERARCHY.md §4 also has an internal inconsistency of its own: the `executive|ACCOUNTS`
//     row uses 'ACCOUNTS', which is not in the frozen department enum defined in that same document's
//     §2 concept table (ADMIN/PROJECTS/SALES/SOLAR/MEP/HVAC/SERVICE/INVENTORY/FINANCE).
// This resolver treats ROLE_HIERARCHY.md's frozen DESIGNATIONS/DEPARTMENTS enum (config/constants.js)
// as authoritative for target values in all cases, since DOCUMENT_AUTHORITY.md names ROLE_HIERARCHY.md
// as the taxonomy authority and the frozen enum is the only value set safe to pass into division/
// department-scope middleware without a second normalization step. Concretely:
//   hvac_dm -> hvac_manager (dept HVAC)      solar_dm -> solar_manager (dept SOLAR)
//   mep_dm  -> mep_manager  (dept MEP)       service_mgr -> service_manager (dept SERVICE)
//   store   -> inventory_manager (dept INVENTORY, not STORE)
//   accounts -> executive (dept FINANCE, not ACCOUNTS)
// This is a read-only normalization for authorization purposes; it does not change any stored value,
// v2 sidebar behavior, or the `role` field itself.
const { DESIGNATIONS, DEPARTMENTS } = require('../config/constants');

// Complete 15-legacy-role map (LEGACY_ROLE_COMPATIBILITY.md "Complete mapping" table), target values
// normalized to the frozen enum per the interpretation decision above.
const LEGACY_ROLE_MAP = Object.freeze({
  super: { designation: DESIGNATIONS.SUPER_ADMIN, department: DEPARTMENTS.ADMIN, division: null },
  admin: { designation: DESIGNATIONS.COMPANY_ADMIN, department: DEPARTMENTS.ADMIN, division: null },
  hvac_dm: { designation: DESIGNATIONS.HVAC_MANAGER, department: DEPARTMENTS.HVAC, division: 'HVAC' },
  solar_dm: { designation: DESIGNATIONS.SOLAR_MANAGER, department: DEPARTMENTS.SOLAR, division: 'SOLAR' },
  mep_dm: { designation: DESIGNATIONS.MEP_MANAGER, department: DEPARTMENTS.MEP, division: 'MEP' },
  hvac_pm: { designation: DESIGNATIONS.PROJECT_MANAGER, department: DEPARTMENTS.PROJECTS, division: 'HVAC' },
  solar_pm: { designation: DESIGNATIONS.PROJECT_MANAGER, department: DEPARTMENTS.PROJECTS, division: 'SOLAR' },
  mep_pm: { designation: DESIGNATIONS.PROJECT_MANAGER, department: DEPARTMENTS.PROJECTS, division: 'MEP' },
  // "Do NOT assume new engineers have a division set" — LEGACY_ROLE_COMPATIBILITY.md "What NOT to do".
  // department/division are null unless the user record itself carries them; back-fill is optional
  // per-assignment history, never assumed here.
  engineer: { designation: DESIGNATIONS.ENGINEER, department: null, division: null },
  service_eng: { designation: DESIGNATIONS.ENGINEER, department: DEPARTMENTS.SERVICE, division: null },
  service_mgr: { designation: DESIGNATIONS.SERVICE_MANAGER, department: DEPARTMENTS.SERVICE, division: null },
  sales: { designation: DESIGNATIONS.SALES_EXECUTIVE, department: DEPARTMENTS.SALES, division: null },
  store: { designation: DESIGNATIONS.INVENTORY_MANAGER, department: DEPARTMENTS.INVENTORY, division: null },
  accounts: { designation: DESIGNATIONS.EXECUTIVE, department: DEPARTMENTS.FINANCE, division: null },
  viewer: { designation: DESIGNATIONS.VIEWER, department: DEPARTMENTS.ADMIN, division: null },
});

const DEFAULT_RESOLUTION = Object.freeze({ designation: DESIGNATIONS.VIEWER, department: DEPARTMENTS.ADMIN, division: null });

/**
 * Pure resolver. Never mutates `user`. `user.role` is read only as a fallback when
 * designation+department are not already present on the record.
 * @param {{designation?:string, department?:string, division?:string, role?:string}} user
 * @returns {{designation:string, department:string|null, division:string|null}}
 */
function resolve(user) {
  if (!user) return { ...DEFAULT_RESOLUTION };
  if (user.designation && user.department) {
    return { designation: user.designation, department: user.department, division: user.division ?? null };
  }
  const mapped = LEGACY_ROLE_MAP[user.role];
  if (mapped) return { ...mapped };
  return { ...DEFAULT_RESOLUTION };
}

module.exports = { resolve, LEGACY_ROLE_MAP };
