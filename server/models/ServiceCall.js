const mongoose = require('mongoose');

const serviceCallSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  psc: { type: Number, required: true },
  type: { type: String, enum: ['Complaint', 'PM'], default: 'Complaint' },
  customer: String,
  phone: String,
  site: String,
  date: String,
  time: String,
  status: { type: String, default: 'Registered', enum: ['Registered', 'Assigned', 'In Progress', 'Completed'] },
  eng: String,
  regDate: String,
  contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },
  report: {
    make: String,
    model: String,
    capacity: String,
    rtype: String,
    material: String,
    service: String,
    chk: mongoose.Schema.Types.Mixed,
    stype: String,
    amount: { type: Number, default: 0 },
    remark: String,
    custRemark: String
  },
  sig: String
}, { timestamps: true });

module.exports = mongoose.model('ServiceCall', serviceCallSchema);
