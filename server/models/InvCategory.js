const mongoose = require('mongoose');

const invCategorySchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('InvCategory', invCategorySchema);
