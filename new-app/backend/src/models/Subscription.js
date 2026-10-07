'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * subscriptions — links a company to a plan with division entitlements.
 *
 * purchasedDivisions is the authoritative source for what divisions
 * a company may access. The Company.divisions[] field is preserved for
 * compatibility but Subscription.purchasedDivisions takes precedence
 * when a subscription exists.
 */

const auditEntrySchema = new Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: String },
    performedAt: { type: Date, default: () => new Date() },
    details: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const subscriptionSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true, // one active subscription per company
    },
    planCode: { type: String, required: true, trim: true },
    planSnapshot: { type: Schema.Types.Mixed, default: {} },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    trialEndsAt: { type: Date },
    status: {
      type: String,
      enum: ['active', 'trial', 'expired', 'cancelled', 'suspended'],
      default: 'active',
    },
    billingStatus: {
      type: String,
      enum: ['current', 'overdue', 'pending', 'na'],
      default: 'na',
    },
    billingCycle: {
      type: String,
      enum: ['Monthly', 'Quarterly', 'Yearly'],
      default: 'Monthly',
    },
    autoRenew: { type: Boolean, default: false },
    purchasedDivisions: {
      type: [{ type: String, enum: DIVISIONS }],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'At least one division must be purchased.',
      },
    },
    addOns: { type: [Schema.Types.Mixed], default: [] },
    createdBy: { type: String },
    auditLog: { type: [auditEntrySchema], default: [] },
  },
  { timestamps: true, collection: 'subscriptions' }
);

subscriptionSchema.index({ companyId: 1 }, { unique: true });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ endDate: 1 });

module.exports = model('Subscription', subscriptionSchema);
