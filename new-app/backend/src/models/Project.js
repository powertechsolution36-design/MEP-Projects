'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS, SIGN_RESPONSIBILITIES, PROJECT_STAGES_BY_DIVISION } = require('./shared/enums');

/**
 * projects — the execution record for one SO's division work.
 * See DATABASE_SCHEMA.md §5.
 *
 * Checklist/executionUpdates/deliveryChallans are embedded subdocuments —
 * NEW BACKEND DESIGN (a MongoDB modeling choice), because the PWA always
 * reads/writes them together with the project as one unit and each array is
 * small and bounded, per the schema doc's "embedded vs referenced" rationale.
 *
 * Note on `stage`: verified against the live PWA `STAGES` source (see
 * DOMAIN_MODEL.md / DATABASE_SCHEMA.md §5 "Stage Enum (per division)").
 * `stage` is validated with a division-aware custom validator against
 * `PROJECT_STAGES_BY_DIVISION[this.division]`, NOT a single flattened enum
 * across all divisions — this preserves each division's distinct, ordered
 * stage list rather than allowing cross-division stage values.
 */

const approvalSchema = new Schema(
  {
    // PWA FACT (verified: `by`) — free-text approver name. NOT a User
    // reference: a CLIENT approver is never a system User, so this field
    // cannot be modeled as an ObjectId ref without losing information.
    approverName: { type: String },
    approvedByRole: { type: String },
    approvedDate: { type: Date },
    approvalRemark: { type: String },
    signatureImage: { type: String },
    // PWA FACT (verified: `enteredBy`) -> NEW BACKEND DESIGN (durable ref).
    // The logged-in staff member who recorded this approval — distinct
    // from `approverName`, which is who actually approved it.
    enteredByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const checklistExecutionItemSchema = new Schema(
  {
    text: { type: String, required: true }, // PWA FACT
    // PWA FACT (verified): SIGN_ROLES has a 5th key `PM`, but it is never
    // reachable from the checklist-point UI — only these 4 values are ever
    // assigned to a point.
    signResponsibility: { type: String, enum: SIGN_RESPONSIBILITIES, required: true },
    done: { type: Boolean, default: false }, // PWA FACT
    completedDate: { type: Date, default: null }, // PWA FACT
    pmSigned: { type: Boolean, default: false }, // PWA FACT
    remark: { type: String }, // PWA FACT
    photos: { type: [String], default: [] }, // PWA FACT
    targetDate: { type: Date, default: null }, // PWA FACT
    approval: { type: approvalSchema, default: null }, // PWA FACT
  },
  { _id: false }
);

const deliveryChallanItemSchema = new Schema(
  {
    challanNumber: { type: String, required: true }, // PWA FACT
    date: { type: Date, required: true }, // PWA FACT
    materialName: { type: String, required: true }, // PWA FACT
    quantity: { type: Number, required: true }, // PWA FACT
    unit: { type: String, required: true }, // PWA FACT
    returnable: { type: Boolean, required: true }, // PWA FACT
    returnedQuantity: { type: Number, default: 0 }, // PWA FACT
    // PWA FACT (as name, `by`, "Received By (site)") -> NEW BACKEND DESIGN
    // (durable ref) for the STAFF member who recorded this row.
    recordedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    // NEW BACKEND DESIGN (OPEN_DECISIONS.md #25, resolving
    // PWA_COVERAGE_AUDIT_PROJECT.md §30 item 7): free-text on-site
    // person's name, exactly as the PWA captured it in `by` -- the PWA's
    // "Received By (site)" field is frequently NOT a system User at all
    // (a site/warehouse person with no login), so forcing it into
    // `recordedByUserId` alone would silently discard real PWA data. This
    // is an additive, representation-fidelity fix, not a new business
    // rule -- it mirrors the split already correctly modeled between
    // `approval.approverName` (free text) and `approval.enteredByUserId`
    // (durable ref) above.
    receivedByName: { type: String },
    remark: { type: String }, // PWA FACT
  },
  { _id: false }
);

const executionUpdateSchema = new Schema(
  {
    date: { type: Date, required: true }, // PWA FACT
    actionDone: { type: String }, // PWA FACT
    nextAction: { type: String }, // PWA FACT
    nextActionDate: { type: Date }, // PWA FACT
    // PWA FACT (as name) -> NEW BACKEND DESIGN (durable ref).
    enteredByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const projectSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true }, // PWA FACT
    division: { type: String, enum: DIVISIONS, required: true }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
    siteType: { type: String }, // PWA FACT
    capacity: { type: String }, // PWA FACT
    customer: { type: String }, // PWA FACT
    // PWA FACT (verified against `STAGES`) — division-aware validation,
    // NEW BACKEND DESIGN choice to preserve per-division validity instead
    // of a single flattened enum (see class comment above).
    stage: {
      type: String,
      required: true,
      validate: {
        validator: function projectStageIsValidForDivision(value) {
          const allowed = PROJECT_STAGES_BY_DIVISION[this.division];
          return Array.isArray(allowed) && allowed.includes(value);
        },
        message: (props) => `'${props.value}' is not a valid stage for this project's division.`,
      },
    }, // PWA FACT
    startDate: { type: Date, required: true }, // PWA FACT
    endDate: { type: Date }, // PWA FACT
    // PWA FACT (as name strings, `engs[]`) -> NEW BACKEND DESIGN (durable ref).
    assignedEngineerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    vendor: { type: String }, // PWA FACT
    status: {
      type: String,
      enum: ['Ongoing', 'Completed', 'In Service'],
      required: true,
      default: 'Ongoing',
    }, // PWA FACT
    checklistTemplateName: { type: String }, // PWA FACT — display only
    checklist: { type: [checklistExecutionItemSchema], default: [] }, // PWA FACT
    executionUpdates: { type: [executionUpdateSchema], default: [] }, // PWA FACT — append-only
    deliveryChallans: { type: [deliveryChallanItemSchema], default: [] }, // PWA FACT
    timelineSet: { type: Boolean, default: false }, // PWA FACT
    lastDelayNotifiedDate: { type: Date, default: null }, // PWA FACT — throttle marker
  },
  { timestamps: true, collection: 'projects' }
);

projectSchema.index({ companyId: 1, division: 1, status: 1 });
projectSchema.index({ companyId: 1, salesOrderId: 1 }, { unique: true });
projectSchema.index({ companyId: 1, assignedEngineerIds: 1 });

module.exports = model('Project', projectSchema);
