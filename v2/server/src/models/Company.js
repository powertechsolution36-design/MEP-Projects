const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  code: { type: String, trim: true, uppercase: true, index: true },
  address: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  gstin: { type: String, trim: true },
  logo: { type: String },
  divs: { type: [String], default: ['MEP', 'HVAC', 'Solar'] },
  disabled: { type: Boolean, default: false, index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('Company', CompanySchema);
