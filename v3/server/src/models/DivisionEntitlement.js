// Explicit per-division on/off, independent of Subscription, so a manual enable/disable can override
// a purchase without editing the Subscription itself. `historicalData` (PLAN_ENTITLEMENTS.md §8
// "Downgrade": "Set DivisionEntitlement{ division, enabled: false, source: manual,
// historicalData: true }") marks a disable that intentionally preserves the division's underlying
// business data instead of implying it should be purged — re-enabling is instant restoration.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES, ENTITLEMENT_SOURCES } = require('../config/constants');

const DivisionEntitlementSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  division: { type: String, enum: DIVISION_VALUES, required: true },
  enabled: { type: Boolean, required: true },
  source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
  historicalData: { type: Boolean, default: false },
  reason: String,
  setBy: { type: mongoose.Schema.Types.ObjectId },
  setAt: { type: Date, default: Date.now },
}, { collection: 'v3_division_entitlements', timestamps: true });

DivisionEntitlementSchema.index({ co: 1, division: 1, setAt: -1 });

module.exports = defineModel('DivisionEntitlement', DivisionEntitlementSchema, 'v3_division_entitlements');
