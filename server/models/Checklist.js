const mongoose = require('mongoose');

const chkItemSchema = new mongoose.Schema({
  text: String,
  sign: String
}, { _id: false });

const checklistSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  div: String,
  name: { type: String, required: true },
  items: [chkItemSchema],
  def: { type: Boolean, default: false },
  by: String,
  date: String
}, { timestamps: true });

module.exports = mongoose.model('Checklist', checklistSchema);
