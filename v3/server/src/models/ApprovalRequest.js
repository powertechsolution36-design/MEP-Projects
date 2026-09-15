// ApprovalRequest — persistent, server-authoritative approval state. Never bypassable by a direct
// API call: any route protected by an active ApprovalRule creates/consults an ApprovalRequest
// through services/approvalService.js, never writes the target resource's real state directly.
// `idempotencyKey` makes execution retry-safe (DATABASE_ARCHITECTURE.md: "ApprovalRequest idempotent
// execution — retry-safe via idempotencyKey").
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { APPROVAL_STATUSES, APPROVAL_EXECUTION_STATUSES } = require('../config/constants');

const STATUSES = APPROVAL_STATUSES;
const EXECUTION_STATUSES = APPROVAL_EXECUTION_STATUSES;

const ApprovalRequestSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  resource: { type: String, required: true, index: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  action: { type: String, required: true },
  payload: mongoose.Schema.Types.Mixed,
  ruleIds: [{ type: mongoose.Schema.Types.ObjectId }],
  status: { type: String, enum: STATUSES, default: 'pending', index: true },
  createdAt: { type: Date, default: Date.now },
  decidedAt: Date,
  approvalRequestId: { type: String, index: true, unique: true, sparse: true }, // stable external id, separate from _id
  actionId: String,
  idempotencyKey: { type: String, index: true, unique: true, sparse: true },
  executionStatus: { type: String, enum: EXECUTION_STATUSES, default: null },
  executedAt: Date,
}, { collection: 'v3_approval_requests' });

// One pending request per (resource, resourceId, action) — prevents a second, duplicate submission
// from racing the first while it is still pending (STEP 20 "duplicate-approve/duplicate-reject").
ApprovalRequestSchema.index(
  { co: 1, resource: 1, resourceId: 1, action: 1, status: 1 },
);

// NOTE: models/registry.js's defineModel() returns a lazy-resolution Proxy whose `get` trap always
// forwards to the underlying Mongoose model (and triggers a DB connection lookup on first access) —
// it cannot also hold plain static properties. Callers needing the status enums import
// APPROVAL_STATUSES / APPROVAL_EXECUTION_STATUSES from config/constants.js directly, not from here.
module.exports = defineModel('ApprovalRequest', ApprovalRequestSchema, 'v3_approval_requests');
