// ApprovalStep — one approver decision within an ApprovalRequest's history. Immutable once written
// (an approver's decision is never edited after the fact; a changed mind is a new step / a new
// request, never a silent rewrite) — mirrors AuditLog's immutability guard.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');

const ApprovalStepSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  approverId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  stepIndex: { type: Number, required: true },
  decision: { type: String, enum: ['approve', 'reject'], required: true },
  note: String,
  decidedAt: { type: Date, default: Date.now },
}, { collection: 'v3_approval_steps' });

ApprovalStepSchema.pre('findOneAndUpdate', function (next) {
  next(new Error('[v3/ApprovalStep] ApprovalStep is immutable — updates are not permitted'));
});
ApprovalStepSchema.pre('findOneAndDelete', function (next) {
  next(new Error('[v3/ApprovalStep] ApprovalStep is immutable — deletes are not permitted'));
});
ApprovalStepSchema.pre('deleteOne', function (next) {
  next(new Error('[v3/ApprovalStep] ApprovalStep is immutable — deletes are not permitted'));
});

module.exports = defineModel('ApprovalStep', ApprovalStepSchema, 'v3_approval_steps');
