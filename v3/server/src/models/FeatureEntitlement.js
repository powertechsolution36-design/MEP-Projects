// Fine-grained feature flags, same explicit on/off + source shape as DivisionEntitlement, kept as a
// separate collection since features are not 1:1 with divisions. `limit` (PLAN_ENTITLEMENTS.md §7
// formula: "features[fe.code] = fe.enabled if fe.limit is None else fe.limit") lets a manual row
// override a feature's numeric limit directly instead of only toggling it on/off — e.g. raising
// `extra_users_pack_10`'s effective seat count for one company without a new AddOn row.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ENTITLEMENT_SOURCES } = require('../config/constants');

const FeatureEntitlementSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  feature: { type: String, required: true },
  enabled: { type: Boolean, required: true },
  limit: { type: mongoose.Schema.Types.Mixed, default: null }, // Number | 'unlimited' | null (null = not a limit override, use `enabled`)
  source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
  reason: String,
  setBy: { type: mongoose.Schema.Types.ObjectId },
  setAt: { type: Date, default: Date.now },
}, { collection: 'v3_feature_entitlements', timestamps: true });

FeatureEntitlementSchema.index({ co: 1, feature: 1, setAt: -1 });

module.exports = defineModel('FeatureEntitlement', FeatureEntitlementSchema, 'v3_feature_entitlements');
