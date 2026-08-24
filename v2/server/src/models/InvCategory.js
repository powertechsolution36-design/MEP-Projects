const mongoose = require('mongoose');

const InvCategorySchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  name: { type: String, required: true, trim: true },
  desc: String,
}, { timestamps: true });

module.exports = mongoose.model('InvCategory', InvCategorySchema);
