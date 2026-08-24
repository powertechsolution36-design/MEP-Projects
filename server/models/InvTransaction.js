const mongoose = require('mongoose');

const invTransactionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  date: String,
  type: { type: String, enum: ['Purchase In', 'Issue', 'Return', 'Transfer', 'Adjustment'] },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem' },
  qty: { type: Number, default: 0 },
  from: mongoose.Schema.Types.Mixed,
  to: mongoose.Schema.Types.Mixed,
  by: String,
  ref: String,
  remark: String
}, { timestamps: true });

module.exports = mongoose.model('InvTransaction', invTransactionSchema);
