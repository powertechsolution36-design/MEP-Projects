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

// Owner request (22 Oct 2026): each part the engineer touched, and whether
// it was repaired or replaced, so the AMC client page can count them.
const partWorkSchema = new Schema(
  {
    part: { type: String, required: true },
    action: { type: String, enum: ['Repaired', 'Replaced'], required: true },
    remark: { type: String, default: '' },
  },
  { _id: false }
);

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
    // Owner request (22 Oct 2026): parts work and gas filling, recorded per
    // visit and totalled on the AMC client page.
    partsWork: { type: [partWorkSchema], default: undefined },
    gasFilled: { type: Boolean, default: false },
    gasType: { type: String, default: '' },
    gasQtyKg: { type: Number, default: 0, min: 0 },
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
    // Owner request (22 Oct 2026): what the client was covered by on the day
    // the call was registered — kept as a snapshot, so a service given after
    // the AMC ran out still shows as such on the client's history.
    coverage: {
      type: String,
      enum: ['AMC', 'Warranty', 'AMC expired', 'Warranty expired', 'Chargeable'],
      default: 'Chargeable',
    },
    // Owner decision (21 Oct 2026): the completed report is sent to the client
    // as a PDF through an unguessable link. Set at completion.
    completedAt: { type: Date },
    reportToken: { type: String },
    // Owner decision (22 Oct 2026): the engineer does not send the report to
    // the client. Completing the call asks the service manager to send it
    // from the company WhatsApp number; it is marked sent when they do.
    reportSendStatus: { type: String, enum: ['Pending', 'Sent', null], default: null },
    reportSendRequestedAt: { type: Date, default: null },
    reportSentAt: { type: Date, default: null },
    reportSentByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'serviceCalls' }
);

serviceCallSchema.index({ companyId: 1, status: 1 });
serviceCallSchema.index({ companyId: 1, engineerId: 1, status: 1 });
serviceCallSchema.index({ companyId: 1, contractId: 1 });
serviceCallSchema.index({ companyId: 1, contractId: 1, registeredDate: -1 });
serviceCallSchema.index({ companyId: 1, reportSendStatus: 1 });
serviceCallSchema.index(
  { reportToken: 1 },
  { unique: true, partialFilterExpression: { reportToken: { $type: 'string' } } }
);

module.exports = model('ServiceCall', serviceCallSchema);
