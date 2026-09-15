// Plan — catalog of sellable packages (PLAN_ENTITLEMENTS.md §1/§13). Dynamically configurable —
// never a hard-coded set of division combinations (SOLAR_ONLY/MEP_ONLY/... are display examples
// only, never the implementation model).
//
// VERSIONING (V3 PHASE 3 spec §3/§13): editing a Plan that already has subscriptions referencing it
// must never retroactively change those subscriptions' commercial terms. This is enforced two ways:
//   1. Subscription.planSnapshot freezes the plan's terms at signup/change time (PLAN_ENTITLEMENTS.md
//      §1/§8/§10) — effective entitlement is always computed from the snapshot, never by re-reading
//      the live Plan document.
//   2. A Plan with active subscriptions referencing it is never mutated in place by
//      services/planService.js — an edit instead creates a new Plan document with the same `code`,
//      `version` incremented, and `supersedes` pointing at the previous version, which is then
//      marked `status:'archived'`.
//
// NOTE: this Phase 3 model's field NAMES follow PLAN_ENTITLEMENTS.md §7's formula exactly
// (`availableDivisions`, `defaultFeatures`, `defaultLimits`) — deliberately different shapes from the
// Phase 1 foundation's `computeEffectiveEntitlements()` pure function in services/entitlementService.js
// (which still expects plain `defaultDivisions`/`defaultFeatures` arrays and is left untouched, with
// its Phase 1 tests still passing unmodified). The Phase 3 authoritative formula lives in
// services/commercialEntitlementService.js and reads from Subscription.planSnapshot, never from a
// live Plan document, so this model's fields are never read directly by the entitlement engine except
// at Subscription-create/change time when the snapshot is taken.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES, PLAN_STATUSES, PLAN_VISIBILITY, BILLING_CYCLES } = require('../config/constants');

const PlanSchema = new mongoose.Schema({
  code: { type: String, required: true, index: true }, // stable identity across versions — NOT unique alone, see the compound index below
  name: { type: String, required: true },
  description: String,
  status: { type: String, enum: PLAN_STATUSES, default: 'draft', index: true },
  visibility: { type: String, enum: PLAN_VISIBILITY, default: 'public' },
  sellable: { type: Boolean, default: true },  // false for LEGACY_UNLIMITED and any retired plan
  editable: { type: Boolean, default: true },  // false for LEGACY_UNLIMITED — system/migration only

  billingCycle: { type: String, enum: BILLING_CYCLES, default: 'monthly' },
  basePrice: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },

  availableDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  forbiddenDivisions: { type: [String], enum: DIVISION_VALUES, default: [] }, // rare — §5
  includedModules: { type: [String], default: [] },
  defaultFeatures: { type: mongoose.Schema.Types.Mixed, default: {} }, // { code: Bool|Number }
  defaultLimits: {
    users: { type: mongoose.Schema.Types.Mixed, default: null },        // Number | 'unlimited' | null
    projects: { type: mongoose.Schema.Types.Mixed, default: null },
    storageGB: { type: mongoose.Schema.Types.Mixed, default: null },
    apiCallsPerHour: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  availableAddOns: { type: [String], default: [] }, // AddOn codes sellable alongside this plan

  trial: {
    enabled: { type: Boolean, default: false },
    days: { type: Number, default: 0, min: 0 },
  },

  version: { type: Number, default: 1, min: 1 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId },
}, { collection: 'v3_plans', timestamps: true });

// A given (code, version) pair is unique; `code` alone repeats across versions by design.
PlanSchema.index({ code: 1, version: 1 }, { unique: true });
// Fast "current sellable version of code X" lookups.
PlanSchema.index({ code: 1, status: 1 });

module.exports = defineModel('Plan', PlanSchema, 'v3_plans');
