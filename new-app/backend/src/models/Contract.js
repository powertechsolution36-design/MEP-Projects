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

// Owner request (22 Oct 2026): the AMC is marked paid on the client, which
// unlocks the AMC letter.
const PAYMENT_MODES = ['Bank Transfer/NEFT', 'Cheque', 'UPI', 'Cash', 'RTGS'];
const amcPaymentSchema = new Schema(
  {
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
    amountPaid: { type: Number, default: 0, min: 0 },
    paidOn: { type: Date, default: null },
    mode: { type: String, enum: [...PAYMENT_MODES, ''], default: '' },
    reference: { type: String, default: '' },
    recordedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recordedAt: { type: Date, default: null },
  },
  { _id: false }
);

// Owner request (22 Oct 2026): a renewal extends the SAME client record, so
// its whole service history stays on one page. Each earlier period is kept
// here with its visits and payment.
const renewalSchema = new Schema(
  {
    startDate: { type: Date },
    endDate: { type: Date },
    amcType: { type: String },
    amount: { type: Number, default: 0 },
    visits: { type: [scheduledVisitSchema], default: [] },
    payment: { type: amcPaymentSchema, default: undefined },
    renewedAt: { type: Date, required: true },
    renewedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
    payment: { type: amcPaymentSchema, default: () => ({ status: 'Pending' }) },
    renewals: { type: [renewalSchema], default: [] },
    // Unguessable key for the client-facing AMC letter link.
    letterToken: { type: String },
  },
  { timestamps: true, collection: 'contracts' }
);

contractSchema.index({ companyId: 1, endDate: 1 });
contractSchema.index({ companyId: 1, 'scheduledVisits.month': 1 });
contractSchema.index(
  { letterToken: 1 },
  { unique: true, partialFilterExpression: { letterToken: { $type: 'string' } } }
);

module.exports = model('Contract', contractSchema);
module.exports.PAYMENT_MODES = PAYMENT_MODES;
