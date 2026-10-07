'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * salesOrders — the confirmed commercial agreement; creating one atomically
 * creates the linked Project + Payment milestones (cascade is application
 * logic, not implemented in this schema-only phase). See DATABASE_SCHEMA.md §4.
 */

const contactSchema = new Schema(
  {
    name: { type: String },
    designation: { type: String },
    phone: { type: String },
    email: { type: String },
  },
  { _id: false }
);

const paymentMilestoneSchema = new Schema(
  {
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    received: { type: Boolean, required: true, default: false },
  },
  { _id: false }
);

function maxTwoContacts(arr) {
  return !arr || arr.length <= 2;
}
function maxFiveMilestones(arr) {
  return !arr || arr.length <= 5;
}

const salesOrderSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    // PWA FACT (as a display number) + NEW BACKEND DESIGN (generation mechanism via counters).
    orderNumber: { type: Number, required: true, immutable: true },
    // NEW BACKEND DESIGN (locked decision #20=D, OPEN_DECISIONS.md #20) — NOT a PWA fact:
    // the PWA itself has no such field. This is a durable, system-managed back-reference
    // to the originating Enquiry: populated automatically by the conversion cascade
    // (src/services/enquiryService.js convertEnquiryToSalesOrder), never client-editable,
    // and enforced unique below so at most one SalesOrder can ever link to a given Enquiry.
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', default: null },
    division: { type: String, enum: DIVISIONS, required: true }, // PWA FACT
    projectName: { type: String, required: true }, // PWA FACT
    startDate: { type: Date, required: true }, // PWA FACT
    endDate: { type: Date }, // PWA FACT
    siteAddress: { type: String }, // PWA FACT
    contacts: {
      type: [contactSchema],
      validate: { validator: maxTwoContacts, message: 'A sales order has at most 2 contacts (PWA FACT).' },
    },
    salesTeam: { type: String }, // PWA FACT
    projectTeam: { type: String }, // PWA FACT
    crucialPoints: { type: String }, // PWA FACT
    totalCost: { type: Number }, // PWA FACT
    highSideSelling: { type: Number }, // PWA FACT
    highSidePurchase: { type: Number }, // PWA FACT
    lowSideCost: { type: Number }, // PWA FACT
    lowSideTargetExpense: { type: Number }, // PWA FACT
    lowSideActualExpense: { type: Number }, // PWA FACT
    termsAndConditions: { type: String }, // PWA FACT
    paymentMilestones: {
      type: [paymentMilestoneSchema],
      validate: { validator: maxFiveMilestones, message: 'A sales order has at most 5 payment milestones (PWA FACT).' },
      default: [],
    },
  },
  { timestamps: true, collection: 'salesOrders' }
);

salesOrderSchema.index({ companyId: 1, orderNumber: 1 }, { unique: true });
salesOrderSchema.index({ companyId: 1, division: 1 });
// Locked decisions #19=B / #20=D: at most one SalesOrder per Enquiry,
// enforced at the database level (sparse — only applies when enquiryId is
// set) so a concurrent duplicate conversion attempt fails with a
// MongoDB duplicate-key error even if the service-layer pre-check races.
salesOrderSchema.index({ enquiryId: 1 }, { unique: true, sparse: true });

module.exports = model('SalesOrder', salesOrderSchema);
