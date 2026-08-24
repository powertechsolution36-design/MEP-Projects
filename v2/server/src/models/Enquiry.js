const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: String,
  action: String,
  note: String,
}, { _id: false });

const EnquirySchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  client: { type: String, trim: true, required: true },
  contact: String,
  phone: String,
  email: String,
  source: String,
  subject: String,
  desc: String,
  status: { type: String, enum: ['new', 'contacted', 'quoted', 'won', 'lost'], default: 'new', index: true },
  value: { type: Number, default: 0 },
  owner: String,
  log: [LogSchema],
}, { timestamps: true });

module.exports = mongoose.model('Enquiry', EnquirySchema);
