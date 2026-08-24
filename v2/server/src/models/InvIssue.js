const mongoose = require('mongoose');

const IssueItemSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem' },
  name: String,
  qty: Number,
  unit: String,
}, { _id: false });

const InvIssueSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  staff: { type: String, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  items: [IssueItemSchema],
  status: { type: String, enum: ['issued', 'returned', 'partial'], default: 'issued', index: true },
  notes: String,
  issuedBy: String,
  returnedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('InvIssue', InvIssueSchema);
