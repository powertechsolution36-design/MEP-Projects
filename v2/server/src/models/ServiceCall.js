const mongoose = require('mongoose');

const ServiceCallSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  psc: { type: Number, index: true },
  client: { type: String, trim: true },
  site: { type: String, trim: true },
  contact: { type: String, trim: true },
  phone: { type: String, trim: true },
  type: { type: String, enum: ['breakdown', 'amc', 'installation', 'inspection', 'other'], default: 'breakdown', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['open', 'assigned', 'scheduled', 'inprogress', 'onhold', 'closed'], default: 'open', index: true },
  eng: { type: String, index: true },
  scheduled: Date,
  desc: String,
  actions: String,
  parts: [{ name: String, qty: Number, unit: String }],
  closedAt: Date,
  contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('ServiceCall', ServiceCallSchema);
