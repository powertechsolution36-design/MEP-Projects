'use strict';

const { Schema, model } = require('mongoose');

/**
 * payments — CRITICAL: full Accounts/Finance structure.
 * See DATABASE_SCHEMA.md §8 and the dedicated
 * "Accounts / Finance Functional Relationship Map" section.
 *
 * Every PWA field is preserved (mapped in the schema doc's 3rd column):
 *   co, project, person, phone, amount, remark, lastCall, disc, nextCall,
 *   status, soNo, mi, paid[], raised{}, rcvDate.
 * Part-payment ledger fields: amt, date, mode, ref, remark, inv, by,
 * editedBy, editedOn — none omitted.
 *
 * status is DERIVED (Pending/Received) from the partPayments sum vs amount —
 * this schema stores it as a field (mirroring the PWA, which also stores a
 * derived value) but the recomputation itself is service-layer logic, not
 * implemented here (see project instructions: reconciliation logic belongs
 * in services, not schema validators).
 */

const partPaymentSchema = new Schema(
  {
    amount: { type: Number, required: true }, // PWA `amt`
    date: { type: Date, required: true }, // PWA `date`
    mode: {
      type: String,
      enum: ['Bank Transfer/NEFT', 'Cheque', 'UPI', 'Cash', 'RTGS'],
      required: true,
    }, // PWA `mode`
    reference: { type: String }, // PWA `ref`
    remark: { type: String }, // PWA `remark`
    invoiceIssued: { type: Boolean, default: false }, // PWA `inv`
    // PWA `by` (name) -> NEW BACKEND DESIGN (durable ref).
    recordedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // PWA `editedBy` (name) -> NEW BACKEND DESIGN (durable ref).
    editedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    editedOn: { type: Date, default: null }, // PWA `editedOn`
  },
  { _id: true }
);

const raisedToFinanceSchema = new Schema(
  {
    raisedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // PWA `raised.by` (name) -> durable ref
    raisedByRole: { type: String },
    raisedDate: { type: Date, required: true },
    collectByDate: { type: Date },
    priority: { type: String, enum: ['Normal', 'Urgent'], default: 'Normal' },
    note: { type: String },
  },
  { _id: false }
);

const paymentSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA `co`
    projectOrReference: { type: String, required: true }, // PWA `project`
    personName: { type: String, required: true }, // PWA `person`
    phone: { type: String }, // PWA `phone`
    amount: { type: Number, required: true }, // PWA `amount`
    remark: { type: String }, // PWA `remark`
    lastCallDate: { type: Date }, // PWA `lastCall`
    discussionNotes: { type: String }, // PWA `disc`
    nextCallDate: { type: Date }, // PWA `nextCall`
    status: { type: String, enum: ['Pending', 'Received'], required: true, default: 'Pending' }, // PWA `status`, derived
    // PWA `soNo` (display no.) -> NEW BACKEND DESIGN (durable ref instead of string match).
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    milestoneIndex: { type: Number, default: null }, // PWA `mi`
    partPayments: { type: [partPaymentSchema], default: [] }, // PWA `paid[]`
    raisedToFinance: { type: raisedToFinanceSchema, default: null }, // PWA `raised{}`
    receivedDate: { type: Date, default: null }, // PWA `rcvDate`
  },
  { timestamps: true, collection: 'payments' }
);

paymentSchema.index({ companyId: 1, status: 1 });
paymentSchema.index(
  { companyId: 1, salesOrderId: 1, milestoneIndex: 1 },
  { unique: true, sparse: true }
);
paymentSchema.index({ companyId: 1, nextCallDate: 1 });
paymentSchema.index({ companyId: 1, 'raisedToFinance.raisedDate': -1 }, { sparse: true });

module.exports = model('Payment', paymentSchema);
