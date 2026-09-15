// Foundation only — see Plan.js header. An add-on GRANTS divisions/features on top of the base
// Subscription; it never itself carries a 'manual' source (manual overrides live on
// DivisionEntitlement/FeatureEntitlement directly, which always outrank an AddOn grant).
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES } = require('../config/constants');

const AddOnSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true },
  grantsDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  grantsFeatures: { type: [String], default: [] },
  active: { type: Boolean, default: true, index: true },
  startDate: Date,
  endDate: Date,
}, { collection: 'v3_addons', timestamps: true });

module.exports = defineModel('AddOn', AddOnSchema, 'v3_addons');
