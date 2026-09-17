const mongoose = require('mongoose');

const ChkItemSchema = new mongoose.Schema({
  title: String,
  done: { type: Boolean, default: false },
  by: String,
  at: Date,
  notes: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const UpdateSchema = new mongoose.Schema({
  by: String,
  at: { type: Date, default: Date.now },
  text: String,
  photos: [String],
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const DcSchema = new mongoose.Schema({
  by: String,
  at: { type: Date, default: Date.now },
  type: String,
  ref: String,
  note: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  code: { type: String, trim: true, index: true },
  name: { type: String, required: true, trim: true },
  client: { type: String, trim: true },
  site: { type: String, trim: true },
  div: { type: String, enum: ['MEP', 'HVAC', 'Solar', 'Other'], default: 'MEP', index: true },
  status: { type: String, enum: ['planning', 'active', 'onhold', 'completed', 'cancelled'], default: 'planning', index: true },
  start: Date,
  target: Date,
  value: { type: Number, default: 0 },
  pm: String,
  engs: [String],
  chk: [ChkItemSchema],
  updates: [UpdateSchema],
  dc: [DcSchema],
  notes: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

ProjectSchema.index({ co: 1, status: 1 });
ProjectSchema.index({ co: 1, div: 1 });

module.exports = mongoose.model('Project', ProjectSchema);
