const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  key: { type: String, required: true },
  val: { type: Number, default: 0 }
}, { timestamps: true });

sequenceSchema.index({ co: 1, key: 1 }, { unique: true });

sequenceSchema.statics.next = async function(co, key) {
  const doc = await this.findOneAndUpdate(
    { co, key },
    { $inc: { val: 1 } },
    { upsert: true, new: true }
  );
  return doc.val;
};

module.exports = mongoose.model('Sequence', sequenceSchema);
