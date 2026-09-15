// ApprovalRule — DATABASE_ARCHITECTURE.md approval engine shapes (rev 9/10/11 addenda). Super Admin
// owns master/default `systemManaged:true` templates; Company Admin may add additional
// `systemManaged:false` rules but can never disable/edit a systemManaged:true rule (enforced in
// services/approvalService.js, not just at the UI layer — this is NOT built as an admin CRUD screen
// in this pass, only the reusable engine).
const mongoose = require('mongoose');
const { defineModel } = require('./registry');

const ApprovalRuleSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  resource: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  condition: {
    field: String,
    op: { type: String, enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] },
    value: mongoose.Schema.Types.Mixed,
  },
  approvers: [{
    role: String,
    userId: mongoose.Schema.Types.ObjectId,
    quorum: { type: Number, default: 1 },
    _id: false,
  }],
  steps: [{ type: mongoose.Schema.Types.Mixed }],
  escalation: {
    after: Number, // ms/hours — interpretation left to the caller invoking escalation
    to: { role: String, userId: mongoose.Schema.Types.ObjectId },
  },
  // Separation of duties (V3 PHASE 4 spec §24) — a requester approving their own request is
  // PROHIBITED unless a rule opts in explicitly. Default false so a workflow can never permit
  // self-approval by omission; enforced in services/approvalService.js, not only in the UI.
  allowSelfApproval: { type: Boolean, default: false },
  systemManaged: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: true, index: true },
}, { collection: 'v3_approval_rules', timestamps: true });

module.exports = defineModel('ApprovalRule', ApprovalRuleSchema, 'v3_approval_rules');
