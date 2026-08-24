const mongoose = require('mongoose');

const InvLocationSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  name: { type: String, required: true, trim: true },
  address: String,
}, { timestamps: true });

module.exports = mongoose.model('InvLocation', InvLocationSchema);
