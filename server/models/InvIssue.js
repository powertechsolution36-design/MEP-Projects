const mongoose = require('mongoose');

const invIssueSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItem' },
  qty: { type: Number, default: 0 },
  staff: String,
  site: String,
  projId: mongoose.Schema.Types.Mixed,
  loc: { type: mongoose.Schema.Types.ObjectId, ref: 'InvLocation' },
  date: String,
  ret: { type: Boolean, default: false },
  rqty: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  status: { type: String, default: 'Issued', enum: ['Issued', 'Returned', 'Consumed'] },
  by: String,
  remark: String,
  retReq: { type: Boolean, default: false },
  retReqQty: { type: Number, default: 0 },
  retReqDate: String,
  retReqNote: String
}, { timestamps: true });

module.exports = mongoose.model('InvIssue', invIssueSchema);
