const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['super', 'admin', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'service_eng', 'sales', 'store', 'accounts', 'viewer'];

const UserSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  un: { type: String, required: true, trim: true, lowercase: true, index: true },
  pw: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, enum: ROLES, default: 'viewer', index: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  disabled: { type: Boolean, default: false, index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

UserSchema.index({ co: 1, un: 1 }, { unique: true });

UserSchema.pre('save', async function(next) {
  if (!this.isModified('pw')) return next();
  this.pw = await bcrypt.hash(this.pw, 10);
  next();
});

UserSchema.methods.comparePw = function(plain) {
  return bcrypt.compare(plain, this.pw);
};

UserSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', UserSchema);
