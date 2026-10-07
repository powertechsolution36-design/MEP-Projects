'use strict';

const { Schema, model } = require('mongoose');

/**
 * contracts — a recurring maintenance agreement (AMC or warranty) with a
 * scheduled visit calendar. See DATABASE_SCHEMA.md §7.
 *
 * status (Active/Expiring Soon/Expired) is derived at read time (verified:
 * contractStatus() subtracts 45 days from endDate for "Expiring Soon") and
 * therefore is NOT a stored field.
 */

const scheduledVisitSchema = new Schema(
  {
    month: { type: String, required: true }, // "YYYY-MM", PWA FACT
    completedDate: { type: Date, default: null }, // PWA FACT
  },
  { _id: false }
);

const contractSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    customer: { type: String }, // PWA FACT
    phone: { type: String }, // PWA FACT
    email: { type: String }, // PWA FACT
    site: { type: String, required: true }, // PWA FACT
    capacity: { type: String }, // PWA FACT
    startDate: { type: Date, required: true }, // PWA FACT
    // PWA FACT (manual `saveContract()`'s `end` field, audit §3/§18 #22): stored
    // with NO fallback/validation -- a blank end is accepted and, combined with
    // contractStatus()'s plain string comparison, immediately reads as "Expired"
    // (a blank string sorts before any real date). Mongo has no equivalent of an
    // absent-but-present empty string for a Date field, so this is `default: null`
    // rather than `required: true` -- a storage-representation necessity
    // (CONTRACT_DECISION_LOCK.md Decision 8), not a business-validation change: no
    // create-Contract call is ever rejected for omitting `end`. contractService.js's
    // computeContractStatus treats a null endDate as unconditionally "before any
    // real date" (i.e. always Expired), reproducing the PWA's observable outcome.
    endDate: { type: Date, default: null },
    amcType: { type: String, enum: ['Monthly', 'Quarterly', 'Half-Yearly'], required: true }, // PWA FACT
    category: { type: String, enum: ['AMC', 'Warranty'], required: true }, // PWA FACT
    amount: { type: Number, default: 0 }, // PWA FACT
    scheduledVisits: { type: [scheduledVisitSchema], default: [] }, // PWA FACT — generated at creation
    originatingProjectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // PWA FACT
  },
  { timestamps: true, collection: 'contracts' }
);

contractSchema.index({ companyId: 1, endDate: 1 });
contractSchema.index({ companyId: 1, 'scheduledVisits.month': 1 });

module.exports = model('Contract', contractSchema);
