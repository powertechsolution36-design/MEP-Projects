const mongoose = require('mongoose');

const checklistItemSchema = new mongoose.Schema({
  text: String,
  sign: String,
  done: { type: Boolean, default: false },
  date: String,
  pmSign: { type: Boolean, default: false },
  remark: String,
  photos: [String],
  plan: String,
  appr: {
    by: String,
    role: String,
    date: String,
    remark: String,
    sig: String,
    enteredBy: String
  }
}, { _id: false });

const dcItemSchema = new mongoose.Schema({
  no: String,
  date: String,
  item: String,
  qty: Number,
  unit: String,
  ret: { type: Boolean, default: false },
  rqty: { type: Number, default: 0 },
  by: String,
  remark: String
}, { _id: false });

const updateSchema = new mongoose.Schema({
  d: String,
  done: String,
  nd: String,
  next: String,
  by: String
}, { _id: false });

const projectSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  soNo: { type: Number, default: 0 },
  div: String,
  name: { type: String, required: true },
  siteType: String,
  cap: String,
  customer: String,
  stage: String,
  start: String,
  end: String,
  engs: [String],
  vendor: String,
  status: { type: String, default: 'Ongoing' },
  timelineSet: { type: Boolean, default: false },
  chkName: String,
  chk: [checklistItemSchema],
  updates: [updateSchema],
  dc: [dcItemSchema]
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
