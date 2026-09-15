// Foundation only — see Plan.js header.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { DIVISION_VALUES, ENTITLEMENT_SOURCES } = require('../config/constants');

const SubscriptionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  purchasedDivisions: { type: [String], enum: DIVISION_VALUES, default: [] },
  source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
  startDate: Date,
  endDate: Date,
  active: { type: Boolean, default: true, index: true },
}, { collection: 'v3_subscriptions', timestamps: true });

module.exports = defineModel('Subscription', SubscriptionSchema, 'v3_subscriptions');
