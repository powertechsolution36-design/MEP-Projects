'use strict';

const { Schema, model } = require('mongoose');

/**
 * serviceCalls — a complaint or a scheduled PM visit, registration through
 * signed completion. See DATABASE_SCHEMA.md §6.
 *
 * Note on `report.checklistResults`: modeled as a Map<String,String>, keyed
 * by the fixed SVC_CHK item text observed in the PWA. The exact fixed key
 * list is not enumerated in DATABASE_SCHEMA.md/DOMAIN_MODEL.md, so keys are
 * not constrained to an enum here — this preserves the PWA's free-text-result
 * behavior without inventing a closed key set.
 */

const reportSchema = new Schema(
  {
    make: { type: String },
    model: { type: String },
    capacity: { type: String },
    type: { type: String }, // refrigerant/unit type, PWA FACT
    materialUsed: { type: String },
    serviceDescription: { type: String },
    checklistResults: { type: Map, of: String, default: undefined },
    serviceType: {
      type: String,
      enum: ['Installation', 'Warranty', 'AMC', 'Chargeable'],
    },
    amount: { type: Number },
    engineerRemark: { type: String },
    customerRemark: { type: String },
  },
  { _id: false }
);

const serviceCallSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    // PWA FACT + NEW BACKEND DESIGN (generation via counters).
    complaintNumber: { type: Number, required: true, immutable: true },
    type: { type: String, enum: ['Complaint', 'PM'], required: true, immutable: true }, // PWA FACT
    customer: { type: String, required: true }, // PWA FACT
    phone: { type: String }, // PWA FACT
    site: { type: String }, // PWA FACT
    appointmentDate: { type: Date }, // PWA FACT
    appointmentTime: { type: String }, // PWA FACT
    complaintDescription: { type: String }, // PWA FACT
    status: {
      type: String,
      enum: ['Registered', 'Assigned', 'Scheduled', 'Completed'],
      required: true,
      default: 'Registered',
    }, // PWA FACT
    // PWA FACT (as name) -> NEW BACKEND DESIGN (durable ref).
    engineerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    registeredDate: { type: Date, required: true, immutable: true }, // PWA FACT
    report: { type: reportSchema, default: null }, // PWA FACT — nullable until filed
    clientSignatureImage: { type: String, default: null }, // PWA FACT
    contractId: { type: Schema.Types.ObjectId, ref: 'Contract', default: null }, // PWA FACT
  },
  { timestamps: true, collection: 'serviceCalls' }
);

serviceCallSchema.index({ companyId: 1, status: 1 });
serviceCallSchema.index({ companyId: 1, engineerId: 1, status: 1 });
serviceCallSchema.index({ companyId: 1, contractId: 1 });

module.exports = model('ServiceCall', serviceCallSchema);
