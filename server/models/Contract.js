const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  customer: String,
  phone: String,
  email: String,
  site: String,
  cap: String,
  start: String,
  end: String,
  amcType: { type: String, default: 'Quarterly' },
  cat: { type: String, default: 'AMC' },
  amount: { type: Number, default: 0 },
  svcs: [{ m: String, done: String }]
}, { timestamps: true });

module.exports = mongoose.model('Contract', contractSchema);
