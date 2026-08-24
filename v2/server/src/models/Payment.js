const mongoose = require('mongoose');

const PaidSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  amt: Number,
  mode: String,
  ref: String,
  by: String,
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  client: String,
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  invNo: String,
  invDate: Date,
  amount: { type: Number, default: 0 },
  due: Date,
  status: { type: String, enum: ['pending', 'partial', 'paid', 'overdue'], default: 'pending', index: true },
  paid: [PaidSchema],
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);
