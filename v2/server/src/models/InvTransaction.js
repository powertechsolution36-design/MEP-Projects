const mongoose = require('mongoose');

const InvTransactionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem', index: true },
  type: { type: String, enum: ['in', 'out', 'adjust', 'transfer'], index: true },
  subtype: String,
  fromLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  toLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  qty: Number,
  rate: Number,
  ref: String,
  by: String,
  notes: String,
}, { timestamps: true });

InvTransactionSchema.index({ co: 1, item: 1, createdAt: -1 });

module.exports = mongoose.model('InvTransaction', InvTransactionSchema);
