const mongoose = require('mongoose');

const InvItemSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  code: { type: String, trim: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  cat: { type: mongoose.Schema.Types.ObjectId, ref: 'InvCategory', index: true },
  unit: { type: String, default: 'nos' },
  qty: { type: Number, default: 0 },
  minQty: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  location: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  desc: String,
}, { timestamps: true });

module.exports = mongoose.model('InvItem', InvItemSchema);
