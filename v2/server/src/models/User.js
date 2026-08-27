const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['super', 'admin', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'service_eng', 'service_mgr', 'sales', 'store', 'accounts', 'viewer'];
const DESIGNATIONS = ['super_admin', 'company_admin', 'manager', 'senior_engineer', 'engineer', 'executive', 'technician', 'viewer'];
const DEPARTMENTS = ['ADMIN', 'HVAC', 'SOLAR', 'MEP', 'SERVICE', 'SALES', 'STORE', 'ACCOUNTS'];

// Role → { designation, department } mapping for backward compat backfill
const ROLE_TO_DESDEP = {
  super:       { designation: 'super_admin',     department: 'ADMIN' },
  admin:       { designation: 'company_admin',   department: 'ADMIN' },
  hvac_pm:     { designation: 'manager',         department: 'HVAC' },
  solar_pm:    { designation: 'manager',         department: 'SOLAR' },
  mep_pm:      { designation: 'manager',         department: 'MEP' },
  engineer:    { designation: 'engineer',        department: 'HVAC' },
  service_mgr: { designation: 'manager',         department: 'SERVICE' },
  service_eng: { designation: 'engineer',        department: 'SERVICE' },
  sales:       { designation: 'executive',       department: 'SALES' },
  store:       { designation: 'manager',         department: 'STORE' },
  accounts:    { designation: 'executive',       department: 'ACCOUNTS' },
  viewer:      { designation: 'viewer',          department: 'ADMIN' },
};

// { designation, department } → role for reverse compat
function deriveRoleFromDesDep(des, dep) {
  if (des === 'super_admin') return 'super';
  if (des === 'company_admin') return 'admin';
  if (des === 'manager') {
    if (dep === 'HVAC') return 'hvac_pm';
    if (dep === 'SOLAR') return 'solar_pm';
    if (dep === 'MEP') return 'mep_pm';
    if (dep === 'SERVICE') return 'service_mgr';
    if (dep === 'STORE') return 'store';
    return 'admin';
  }
  if (des === 'engineer' || des === 'senior_engineer' || des === 'technician') {
    if (dep === 'SERVICE') return 'service_eng';
    return 'engineer';
  }
  if (des === 'executive') {
    if (dep === 'SALES') return 'sales';
    if (dep === 'ACCOUNTS') return 'accounts';
    return 'viewer';
  }
  return 'viewer';
}

const UserSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  un: { type: String, required: true, trim: true, lowercase: true, index: true },
  pw: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, enum: ROLES, default: 'viewer', index: true },
  designation: { type: String, enum: DESIGNATIONS, index: true },
  department: { type: String, enum: DEPARTMENTS, index: true },
  employeeId: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  disabled: { type: Boolean, default: false, index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

UserSchema.index({ un: 1 });
UserSchema.index({ co: 1, department: 1 });

// Auto-derive role from designation+department if not explicitly set
// Also backfill designation+department from role if missing
UserSchema.pre('validate', function(next) {
  if (this.designation && this.department && !this.role) {
    this.role = deriveRoleFromDesDep(this.designation, this.department);
  } else if (this.role && (!this.designation || !this.department)) {
    const map = ROLE_TO_DESDEP[this.role];
    if (map) {
      if (!this.designation) this.designation = map.designation;
      if (!this.department) this.department = map.department;
    }
  } else if (this.designation && this.department && this.isModified('designation') || this.isModified('department')) {
    // If designation/department changed, re-derive role
    this.role = deriveRoleFromDesDep(this.designation, this.department);
  }
  next();
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('pw')) return next();
  this.pw = await bcrypt.hash(this.pw, 10);
  next();
});

UserSchema.methods.comparePw = function(plain) {
  return bcrypt.compare(plain, this.pw);
};

UserSchema.statics.ROLES = ROLES;
UserSchema.statics.DESIGNATIONS = DESIGNATIONS;
UserSchema.statics.DEPARTMENTS = DEPARTMENTS;
UserSchema.statics.ROLE_TO_DESDEP = ROLE_TO_DESDEP;
UserSchema.statics.deriveRoleFromDesDep = deriveRoleFromDesDep;

module.exports = mongoose.model('User', UserSchema);
