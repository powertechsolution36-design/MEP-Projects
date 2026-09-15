// First-class, immutable AuditLog — v3-owned, new collection (whitelisted in LIVE_APP_SAFETY.md).
// Every v3 mutation writes here (see services/auditService.js). Never store passwords/tokens/secrets.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { AUDIT_ACTIONS } = require('../config/constants');

const AuditLogSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userName: String,
  action: { type: String, required: true, enum: Object.values(AUDIT_ACTIONS), index: true },
  resource: { type: String, required: true, index: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, index: true },
  method: String,
  path: String,
  status: Number,
  ip: String,
  userAgent: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  reason: String,
  correctionId: { type: mongoose.Schema.Types.ObjectId, index: true }, // set for OVERRIDE/CORRECT actions
  supportOp: { type: Boolean, default: false },      // true only for a Super Admin support-op mutation
  timestamp: { type: Date, default: Date.now, index: true },
}, { collection: 'v3_audit_logs' });

// Immutability guard at the application layer — AuditLog documents are never updated or deleted
// through this model. No unrestricted audit-delete endpoint exists anywhere in v3.
AuditLogSchema.pre('findOneAndUpdate', function (next) {
  next(new Error('[v3/AuditLog] AuditLog is immutable — updates are not permitted'));
});
AuditLogSchema.pre('findOneAndDelete', function (next) {
  next(new Error('[v3/AuditLog] AuditLog is immutable — deletes are not permitted'));
});
AuditLogSchema.pre('deleteOne', function (next) {
  next(new Error('[v3/AuditLog] AuditLog is immutable — deletes are not permitted'));
});

module.exports = defineModel('AuditLog', AuditLogSchema, 'v3_audit_logs');
