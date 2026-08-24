const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  desc: String,
  qty: Number,
  unit: String,
  rate: Number,
  amount: Number,
}, { _id: false });

const SalesOrderSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  no: { type: Number, index: true },
  date: { type: Date, default: Date.now },
  client: { type: String, trim: true, required: true },
  contact: String,
  items: [ItemSchema],
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'confirmed', 'delivered', 'cancelled'], default: 'draft', index: true },
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model('SalesOrder', SalesOrderSchema);
