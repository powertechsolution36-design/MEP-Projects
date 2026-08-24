const mongoose = require('mongoose');

const SequenceSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  key: { type: String, required: true, index: true },
  seq: { type: Number, default: 0 },
}, { timestamps: true });

SequenceSchema.index({ co: 1, key: 1 }, { unique: true });

SequenceSchema.statics.next = async function(co, key) {
  const doc = await this.findOneAndUpdate(
    { co, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Sequence', SequenceSchema);
