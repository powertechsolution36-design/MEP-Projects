// Foundation only — see Plan.js header. Fine-grained feature flags, same explicit on/off + source
// shape as DivisionEntitlement, kept as a separate collection since features are not 1:1 with divisions.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ENTITLEMENT_SOURCES } = require('../config/constants');

const FeatureEntitlementSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  feature: { type: String, required: true },
  enabled: { type: Boolean, required: true },
  source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
  reason: String,
  setBy: { type: mongoose.Schema.Types.ObjectId },
  setAt: { type: Date, default: Date.now },
}, { collection: 'v3_feature_entitlements', timestamps: true });

FeatureEntitlementSchema.index({ co: 1, feature: 1, setAt: -1 });

module.exports = defineModel('FeatureEntitlement', FeatureEntitlementSchema, 'v3_feature_entitlements');
