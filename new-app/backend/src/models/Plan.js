'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * plans — subscription plan catalog (V3-style).
 *
 * Super Admin manages these. Each plan defines which divisions are
 * available and what features/limits apply. Pricing is editable —
 * no hardcoded prices.
 */

const planSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    version: { type: Number, default: 1 },
    availableDivisions: {
      type: [{ type: String, enum: DIVISIONS }],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'At least one division must be available in the plan.',
      },
    },
    includedModules: { type: [String], default: [] },
    defaultFeatures: { type: Schema.Types.Mixed, default: {} },
    availableAddOns: { type: [Schema.Types.Mixed], default: [] },
    limits: { type: Schema.Types.Mixed, default: {} },
    trialDays: { type: Number, default: 15 },
    pricing: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true, collection: 'plans' }
);

module.exports = model('Plan', planSchema);
