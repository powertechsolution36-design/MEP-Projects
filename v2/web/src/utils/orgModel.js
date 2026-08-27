/**
 * Organization model — designations, departments, divisions.
 * Kept in sync with server-side User.js constants.
 */

export const DESIGNATIONS = [
  { value: 'manager',         label: 'Manager' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'senior_engineer', label: 'Senior Engineer' },
  { value: 'engineer',        label: 'Engineer' },
  { value: 'executive',       label: 'Executive' },
  { value: 'technician',      label: 'Technician' },
  { value: 'viewer',          label: 'Viewer' },
];

// All designations including admin-level (for label display of Sam / company admins)
export const ALL_DESIGNATIONS = [
  { value: 'super_admin',     label: 'Super Admin' },
  { value: 'company_admin',   label: 'Company Admin' },
  ...DESIGNATIONS,
];

// Top-level departments shown in user form.
// 'Projects' expands into a Division picker (HVAC/Solar/MEP).
export const DEPARTMENTS = [
  { value: 'PROJECTS', label: 'Projects (HVAC / Solar / MEP)' },
  { value: 'SERVICE',  label: 'Service' },
  { value: 'SALES',    label: 'Sales' },
  { value: 'STORE',    label: 'Store / Inventory' },
  { value: 'ACCOUNTS', label: 'Accounts / Finance' },
];

// All departments including ADMIN + legacy flat ones (for label lookup)
export const ALL_DEPARTMENTS = [
  { value: 'ADMIN',    label: 'Administration' },
  ...DEPARTMENTS,
  { value: 'HVAC',     label: 'HVAC' },
  { value: 'SOLAR',    label: 'Solar' },
  { value: 'MEP',      label: 'MEP' },
];

// Divisions shown when Department = 'PROJECTS'
export const DIVISIONS = [
  { value: 'HVAC',  label: 'HVAC' },
  { value: 'SOLAR', label: 'Solar' },
  { value: 'MEP',   label: 'MEP' },
];

// Human-readable label combining designation + department (+ division)
export function orgLabel(user) {
  if (!user) return '';
  const d = ALL_DESIGNATIONS.find(x => x.value === user.designation)?.label || user.designation || '';
  let dep = ALL_DEPARTMENTS.find(x => x.value === user.department)?.label || user.department || '';
  // If department is PROJECTS and user has a division, show "Projects — HVAC"
  if (user.department === 'PROJECTS' && user.division) {
    const div = DIVISIONS.find(x => x.value === user.division)?.label || user.division;
    dep = `Projects — ${div}`;
  }
  if (d && dep) return `${d} — ${dep}`;
  return d || dep || user.role || '—';
}

// Legacy role → org triplet
export const ROLE_TO_DESDEP = {
  super:       { designation: 'super_admin',   department: 'ADMIN' },
  admin:       { designation: 'company_admin', department: 'ADMIN' },
  hvac_pm:     { designation: 'project_manager', department: 'PROJECTS', division: 'HVAC' },
  hvac_dm:     { designation: 'manager',         department: 'PROJECTS', division: 'HVAC' },
  solar_pm:    { designation: 'project_manager', department: 'PROJECTS', division: 'SOLAR' },
  solar_dm:    { designation: 'manager',         department: 'PROJECTS', division: 'SOLAR' },
  mep_pm:      { designation: 'project_manager', department: 'PROJECTS', division: 'MEP' },
  mep_dm:      { designation: 'manager',         department: 'PROJECTS', division: 'MEP' },
  engineer:    { designation: 'engineer',      department: 'PROJECTS', division: 'HVAC' },
  service_mgr: { designation: 'manager',       department: 'SERVICE' },
  service_eng: { designation: 'engineer',      department: 'SERVICE' },
  sales:       { designation: 'executive',     department: 'SALES' },
  store:       { designation: 'manager',       department: 'STORE' },
  accounts:    { designation: 'executive',     department: 'ACCOUNTS' },
  viewer:      { designation: 'viewer',        department: 'ADMIN' },
};

export function getOrg(user) {
  if (!user) return { designation: '', department: '', division: '' };
  if (user.designation && user.department) {
    return { designation: user.designation, department: user.department, division: user.division || '' };
  }
  return ROLE_TO_DESDEP[user.role] || { designation: '', department: '', division: '' };
}
