const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  name: { type: String, required: true },
  role: { type: String, required: true, enum: [
    'super', 'admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm',
    'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance'
  ]},
  un: { type: String, required: true, unique: true },
  pw: { type: String, required: true }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('pw')) return next();
  this.pw = await bcrypt.hash(this.pw, 10);
  next();
});

userSchema.methods.comparePw = function(candidate) {
  return bcrypt.compare(candidate, this.pw);
};

module.exports = mongoose.model('User', userSchema);
