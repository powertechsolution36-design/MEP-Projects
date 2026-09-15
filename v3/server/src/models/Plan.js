// Entitlement foundation (DOCUMENT_AUTHORITY.md authority chain: Plan -> Subscription ->
// DivisionEntitlement -> FeatureEntitlement -> AddOn -> Company.entitlements CACHE).
// Foundation only — no plan-catalog CRUD/UI is built in this pass, just the schema interface
// services/entitlementService.js computes against. Never hard-code a fixed set of plan combinations.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES } = require('../config/constants');

const PlanSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  defaultDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  defaultFeatures: { type: [String], default: [] },
  active: { type: Boolean, default: true },
}, { collection: 'v3_plans', timestamps: true });

module.exports = defineModel('Plan', PlanSchema, 'v3_plans');
