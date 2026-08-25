const mongoose = require('mongoose');

const IssueItemSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem' },
  name: String,
  qty: Number,
  unit: String,
  returnedQty: { type: Number, default: 0 },
  consumedQty: { type: Number, default: 0 },
}, { _id: false });

const ReturnRequestSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: String,
  items: [{ item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem' }, name: String, qty: Number, unit: String }],
  notes: String,
  status: { type: String, enum: ['pending', 'received', 'rejected'], default: 'pending' },
  handledAt: Date,
  handledBy: String,
}, { _id: true });

const InvIssueSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  staff: { type: String, index: true, required: true },
  site: String,
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  location: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  items: [IssueItemSchema],
  status: { type: String, enum: ['open', 'partial', 'closed'], default: 'open', index: true },
  notes: String,
  issuedBy: String,
  returnRequests: [ReturnRequestSchema],
}, { timestamps: true });

module.exports = mongoose.model('InvIssue', InvIssueSchema);
