const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  city: String,
  addr: String,
  gst: String,
  divs: { type: [String], default: ['HVAC'] },
  status: { type: String, enum: ['Active', 'Trial', 'Suspended'], default: 'Trial' },
  since: String,
  phone: String,
  email: String,
  tagline: String,
  contacts: [{
    n: String,
    ph: String
  }],
  subRate: { type: Number, default: 0 },
  subCycle: { type: String, default: 'Monthly' },
  subStart: String,
  subEnd: String,
  trialEnd: String
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
