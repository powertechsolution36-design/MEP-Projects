const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true },
  siteType: String,
  cap: String,
  phone: String,
  ref: String,
  seg: String,
  review: String,
  rating: { type: Number, default: 0 },
  done: String,
  nextDate: String,
  next: String,
  remark: String,
  value: { type: Number, default: 0 },
  status: { type: String, default: 'Open', enum: ['Open', 'Won', 'Lost'] },
  lostReason: String,
  lostDate: String,
  log: [{ d: String, t: String }]
}, { timestamps: true });

module.exports = mongoose.model('Enquiry', enquirySchema);
