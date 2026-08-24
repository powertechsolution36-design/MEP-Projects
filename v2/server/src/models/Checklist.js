const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  title: String,
  required: { type: Boolean, default: false },
}, { _id: false });

const ChecklistSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  name: { type: String, required: true, trim: true },
  div: { type: String, index: true },
  desc: String,
  items: [ItemSchema],
}, { timestamps: true });

module.exports = mongoose.model('Checklist', ChecklistSchema);
