const mongoose = require('mongoose');

const invItemSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  cat: { type: mongoose.Schema.Types.ObjectId, ref: 'InvCategory' },
  code: String,
  name: { type: String, required: true },
  unit: String,
  ret: { type: Boolean, default: false },
  min: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  stock: { type: Map, of: Number, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('InvItem', invItemSchema);
