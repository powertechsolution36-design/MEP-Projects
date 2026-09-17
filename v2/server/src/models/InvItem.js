const mongoose = require('mongoose');

// Per-location stock breakdown, added to preserve the legacy PWA's location-aware
// inventory view. The scalar `qty` below remains the authoritative V2 stock figure
// and is owned exclusively by the inventory routes; `stock` is a parallel
// representation and is never used to recompute `qty`.
const StockSchema = new mongoose.Schema({
  location: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  qty: { type: Number, default: 0 },
}, { _id: false });

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
  division: { type: String, enum: ['COMMON', 'HVAC', 'SOLAR', 'MEP'], default: 'COMMON', index: true },
  desc: String,
  stock: { type: [StockSchema], default: [] },
  returnable: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('InvItem', InvItemSchema);
