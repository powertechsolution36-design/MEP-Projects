const mongoose = require('mongoose');

const SvcVisitSchema = new mongoose.Schema({
  due: Date,
  done: { type: Boolean, default: false },
  doneAt: Date,
  eng: String,
  notes: String,
}, { _id: false });

const ContractSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  no: { type: String, trim: true, index: true },
  client: { type: String, trim: true, required: true },
  site: { type: String, trim: true },
  type: { type: String, enum: ['AMC', 'CAMC', 'Warranty', 'One-time', 'Rental', 'Other'], default: 'AMC' },
  start: Date,
  end: Date,
  value: { type: Number, default: 0 },
  freq: { type: String, enum: ['monthly', 'quarterly', 'halfyearly', 'yearly'], default: 'quarterly' },
  status: { type: String, enum: ['active', 'expired', 'renewed', 'cancelled'], default: 'active', index: true },
  svcs: [SvcVisitSchema],
  notes: String,
  fromProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('Contract', ContractSchema);
