// First-class RecordCorrection — the only sanctioned path for a Manager/Admin (or a Super Admin
// support-op) to touch another user's record. Every write here is paired with an AuditLog
// CORRECT/OVERRIDE entry (services/auditService.js) — enforced by services/ownershipService.js,
// never left to individual route handlers to remember.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');

const RecordCorrectionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  originalRecordId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  originalCollection: { type: String, required: true, index: true },
  originalCreatedByUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
  overrideByUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  overrideAt: { type: Date, default: Date.now },
  reason: { type: String, required: true, minlength: 1 },
  supportOp: { type: Boolean, default: false },
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
}, { collection: 'v3_record_corrections', timestamps: { createdAt: true, updatedAt: false } });

module.exports = defineModel('RecordCorrection', RecordCorrectionSchema, 'v3_record_corrections');
