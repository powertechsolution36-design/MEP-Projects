const mongoose = require('mongoose');

const paidSchema = new mongoose.Schema({
  amt: { type: Number, default: 0 },
  date: String,
  mode: String,
  ref: String,
  remark: String,
  inv: { type: Boolean, default: false },
  by: String
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  project: String,
  person: String,
  phone: String,
  amount: { type: Number, default: 0 },
  remark: String,
  lastCall: String,
  disc: String,
  nextCall: String,
  status: { type: String, default: 'Pending', enum: ['Pending', 'Received'] },
  soNo: mongoose.Schema.Types.Mixed,
  mi: Number,
  paid: [paidSchema]
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
