// Subscription — Company × Plan × time window, planSnapshot frozen at signup/change
// (PLAN_ENTITLEMENTS.md §1/§8/§10). This is the authoritative commercial record; Company.entitlements
// is only ever a recomputed cache of it (see services/entitlementResolutionService.js).
//
// "One Subscription active per company at a time" (§10) — enforced by the partial unique index below
// (co + status:'active'), not just by convention. Historical rows are NEVER deleted — a plan switch
// or cancellation creates a NEW row (or flips status on this one to 'cancelled'/'expired') while the
// old 'active' row is set to 'replaced'/'expired'/'cancelled', preserving planSnapshot for audit.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const {
  DIVISION_VALUES, ENTITLEMENT_SOURCES, SUBSCRIPTION_STATUSES, BILLING_CYCLES,
} = require('../config/constants');

const PlanSnapshotSchema = new mongoose.Schema({
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  code: String,
  name: String,
  version: Number,
  billingCycle: { type: String, enum: BILLING_CYCLES },
  basePrice: Number,
  currency: String,
  availableDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  forbiddenDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  includedModules: { type: [String], default: [] },
  defaultFeatures: { type: mongoose.Schema.Types.Mixed, default: {} },
  defaultLimits: { type: mongoose.Schema.Types.Mixed, default: {} },
  trial: { enabled: Boolean, days: Number },
  snapshotAt: { type: Date, default: Date.now },
}, { _id: false });

// Subscription.addOns[] — active AddOn assignments (PLAN_ENTITLEMENTS.md §1: "AddOn (catalog) +
// Subscription.addOns[] active entries"). Assigning/removing an add-on only ever appends/updates an
// entry here — it never rewrites purchasedDivisions/planSnapshot (V3 PHASE 3 spec §7: "Add-ons must
// not directly rewrite subscription records").
const AddOnAssignmentSchema = new mongoose.Schema({
  addOnCode: { type: String, required: true },
  active: { type: Boolean, default: true },
  activatedAt: { type: Date, default: Date.now },
  activatedBy: { type: mongoose.Schema.Types.ObjectId },
  deactivatedAt: Date,
  deactivatedBy: { type: mongoose.Schema.Types.ObjectId },
}, { _id: false });

const SubscriptionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  planSnapshot: { type: PlanSnapshotSchema, required: true },
  purchasedDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  addOns: { type: [AddOnAssignmentSchema], default: [] },
  status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true, default: 'active', index: true },
  source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
  startDate: { type: Date, default: Date.now },
  endDate: Date,          // set when replaced/expired/cancelled — historical rows keep this
  renewsAt: Date,
  trialEndsAt: Date,
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId },
}, { collection: 'v3_subscriptions', timestamps: true });

// "One Subscription active per company at a time" — partial unique index, not just app-level
// discipline (PLAN_ENTITLEMENTS.md §10).
SubscriptionSchema.index(
  { co: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
SubscriptionSchema.index({ co: 1, createdAt: -1 }); // history lookups

module.exports = defineModel('Subscription', SubscriptionSchema, 'v3_subscriptions');
