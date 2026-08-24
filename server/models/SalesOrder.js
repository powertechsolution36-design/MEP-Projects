const mongoose = require('mongoose');

const salesOrderSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  no: { type: Number, required: true },
  div: String,
  project: String,
  start: String,
  end: String,
  addr: String,
  contacts: [{ n: String, dg: String, ph: String, em: String }],
  salesTeam: String,
  projTeam: String,
  crucial: String,
  total: { type: Number, default: 0 },
  hsSell: { type: Number, default: 0 },
  hsPur: { type: Number, default: 0 },
  lsCost: { type: Number, default: 0 },
  lsTarget: { type: Number, default: 0 },
  lsActual: { type: Number, default: 0 },
  terms: String,
  pay: [{
    d: String,
    a: { type: Number, default: 0 },
    rcv: { type: Boolean, default: false }
  }]
}, { timestamps: true });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
