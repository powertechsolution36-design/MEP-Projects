/**
 * Organization model — designations, departments, and their labels.
 * Kept in sync with server-side User.js constants.
 */

export const DESIGNATIONS = [
  { value: 'manager',         label: 'Manager' },
  { value: 'senior_engineer', label: 'Senior Engineer' },
  { value: 'engineer',        label: 'Engineer' },
  { value: 'executive',       label: 'Executive' },
  { value: 'technician',      label: 'Technician' },
  { value: 'viewer',          label: 'Viewer' },
];

// All designations including admin-level (for internal use / display of Sam)
export const ALL_DESIGNATIONS = [
  { value: 'super_admin',     label: 'Super Admin' },
  { value: 'company_admin',   label: 'Company Admin' },
  ...DESIGNATIONS.map(d => d),
];

export const DEPARTMENTS = [
  { value: 'ADMIN',    label: 'Administration' },
  { value: 'HVAC',     label: 'HVAC' },
  { value: 'SOLAR',    label: 'Solar' },
  { value: 'MEP',      label: 'MEP' },
  { value: 'SERVICE',  label: 'Service' },
  { value: 'SALES',    label: 'Sales' },
  { value: 'STORE',    label: 'Store / Inventory' },
  { value: 'ACCOUNTS', label: 'Accounts / Finance' },
];

// Human-readable label combining designation + department
export function orgLabel(user) {
  if (!user) return '';
  const d = ALL_DESIGNATIONS.find(x => x.value === user.designation)?.label || user.designation || '';
  const dep = DEPARTMENTS.find(x => x.value === user.department)?.label || user.department || '';
  if (d && dep) return `${d} — ${dep}`;
  return d || dep || user.role || '—';
}

// Role → designation+department (for legacy display)
export const ROLE_TO_DESDEP = {
  super:       { designation: 'super_admin',   department: 'ADMIN' },
  admin:       { designation: 'company_admin', department: 'ADMIN' },
  hvac_pm:     { designation: 'manager',       department: 'HVAC' },
  solar_pm:    { designation: 'manager',       department: 'SOLAR' },
  mep_pm:      { designation: 'manager',       department: 'MEP' },
  engineer:    { designation: 'engineer',      department: 'HVAC' },
  service_mgr: { designation: 'manager',       department: 'SERVICE' },
  service_eng: { designation: 'engineer',      department: 'SERVICE' },
  sales:       { designation: 'executive',     department: 'SALES' },
  store:       { designation: 'manager',       department: 'STORE' },
  accounts:    { designation: 'executive',     department: 'ACCOUNTS' },
  viewer:      { designation: 'viewer',        department: 'ADMIN' },
};

// Get {designation, department} from a user (either explicit or derived from role)
export function getOrg(user) {
  if (!user) return { designation: '', department: '' };
  if (user.designation && user.department) return { designation: user.designation, department: user.department };
  return ROLE_TO_DESDEP[user.role] || { designation: '', department: '' };
}
