'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * quotations — first-class commercial document for Sales/Finance.
 *
 * Supports Equipment + Accessories sections (NOT "High Side" / "Low Side").
 * Line items carry per-document pricing — no permanent price memory.
 * Layout varies by division (HVAC columns differ from Solar).
 */

const lineItemSchema = new Schema(
  {
    sNo: { type: Number, required: true },
    description: { type: String, required: true },
    unit: { type: String, default: 'Nos' },
    qty: { type: Number, required: true, min: 0 },
    supplyRate: { type: Number, default: 0 },
    installationRate: { type: Number, default: 0 },
    supplyAmount: { type: Number, default: 0 },
    installationAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    // Per-item GST (used by Solar — flat table with per-item GST%)
    gstPercent: { type: Number, default: null },
    gstAmount: { type: Number, default: 0 },
    amountWithGst: { type: Number, default: 0 },
  },
  { _id: false }
);

const paymentTermRowSchema = new Schema(
  {
    sequence: { type: Number, required: true },
    section: { type: String, default: '' }, // 'Equipment', 'Accessories', or ''
    label: { type: String, default: '' },
    percentage: { type: String, default: '' }, // may be text like "100%" or descriptive
    triggerEvent: { type: String, default: '' },
    wording: { type: String, default: '' },
  },
  { _id: false }
);

const quotationSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    quotationNumber: { type: String, required: true },
    revision: { type: Number, default: 0 },
    division: {
      type: String,
      enum: DIVISIONS,
      required: true,
    },
    status: {
      type: String,
      enum: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Revised', 'Cancelled'],
      default: 'Draft',
    },

    // Customer details
    customerName: { type: String, default: '' },
    customerAddress: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    customerEmail: { type: String, default: '' },
    customerGst: { type: String, default: '' },

    // Project/Subject
    subject: { type: String, default: '' },
    system: { type: String, default: '' },
    capacity: { type: String, default: '' },
    siteDescription: { type: String, default: '' },
    summaryText: { type: String, default: '' },
    technicalDescription: { type: String, default: '' },
    designApproval: { type: String, default: '' },
    benefitsOfSystem: { type: String, default: '' },
    designBy: { type: String, default: '' },
    systemApprovedBy: { type: String, default: '' },

    // Line items
    equipmentItems: { type: [lineItemSchema], default: [] },
    accessoriesItems: { type: [lineItemSchema], default: [] },

    // Totals
    equipmentSupplyTotal: { type: Number, default: 0 },
    equipmentInstallTotal: { type: Number, default: 0 },
    equipmentTotal: { type: Number, default: 0 },
    accessoriesSupplyTotal: { type: Number, default: 0 },
    accessoriesInstallTotal: { type: Number, default: 0 },
    accessoriesTotal: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 18 },
    gstAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },

    // Payment terms
    paymentTerms: { type: [paymentTermRowSchema], default: [] },
    paymentTermTemplateId: { type: Schema.Types.ObjectId, ref: 'PaymentTermTemplate', default: null },

    // Commercial terms
    offerValidity: { type: String, default: '' },
    delivery: { type: String, default: '' },
    excludedWorks: { type: [String], default: [] },

    // Notes
    notes: { type: String, default: '' },

    // Meta
    date: { type: Date, default: () => new Date() },
    createdBy: { type: String },
    lastEditedBy: { type: String },
  },
  { timestamps: true, collection: 'quotations' }
);

quotationSchema.index({ companyId: 1, quotationNumber: 1 }, { unique: true });
quotationSchema.index({ companyId: 1, status: 1 });
quotationSchema.index({ companyId: 1, division: 1 });
quotationSchema.index({ companyId: 1, customerName: 1 });

module.exports = model('Quotation', quotationSchema);
