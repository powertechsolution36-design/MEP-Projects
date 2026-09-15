// AddOn — PLATFORM CATALOG of optional paid extras (PLAN_ENTITLEMENTS.md §1: "AddOn (catalog) +
// Subscription.addOns[] active entries"). Deliberately NOT company-scoped (no `co` field) — this is
// the sellable definition (what an add-on grants), managed by Super Admin like Plan. A company's
// actual assignment of an add-on lives in Subscription.addOns[] (models/Subscription.js), which
// references this catalog by `code` and never duplicates the grant data here.
//
// An add-on never itself carries a 'manual' source and never rewrites Subscription.purchasedDivisions
// or planSnapshot directly — manual overrides live on DivisionEntitlement/FeatureEntitlement, which
// always outrank an AddOn grant (PLAN_ENTITLEMENTS.md §4 precedence).
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES } = require('../config/constants');

const AddOnSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: String,
  divisionsGranted: { type: [String], enum: DIVISION_VALUES, default: [] },
  featuresGranted: { type: mongoose.Schema.Types.Mixed, default: {} }, // { code: Bool|Number }
  limits: { type: mongoose.Schema.Types.Mixed, default: {} },          // merge-add on top of plan limits
  // PLAN_ENTITLEMENTS.md §5 validation rule — empty = universal (compatible with every plan).
  compatiblePlans: { type: [String], default: [] },
  price: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true }, // catalog-level: is this add-on currently sellable at all
  sellable: { type: Boolean, default: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId },
}, { collection: 'v3_addons', timestamps: true });

module.exports = defineModel('AddOn', AddOnSchema, 'v3_addons');
