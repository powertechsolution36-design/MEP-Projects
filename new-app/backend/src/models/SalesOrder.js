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
    /*
     * Owner request (18 Nov 2026): "the rest will be chosen from the 13
     * checklist and on which checklists the each remaining payment will be
     * taken it should be as a dropdown option in sales order."
     *
     * Which point of the project's checklist earns this payment, by its
     * position in that checklist. Null on the advance, which is taken
     * against the order itself and no point of work, and on every milestone
     * raised before this existed.
     *
     * The LIVE link is the one on the project's own point
     * (Project.checklist[i].releasesMilestoneIndex) — that is what releases
     * the money, and it moves with its point when points are added or
     * removed. This field is what the order AGREED, written when the order
     * is raised and re-applied to the project when the order is edited. The
     * order is the commercial document; it should say at which stage each
     * payment falls, rather than making somebody open the project to find
     * out.
     */
    checklistPointIndex: { type: Number, default: null },
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
    //
    // DEFECT FIX (16 Nov 2026): no `default: null`. A MongoDB sparse index
    // skips a document only when the field is ABSENT -- an explicit null IS
    // indexed. With a default of null, the first order raised without a lead
    // put null in the unique index and every order after it collided, which
    // is what broke "+ New SO" and the conversion of a quotation that had no
    // lead behind it. The field is therefore left off the document entirely
    // when there is no lead (see salesOrderCascade.js), and reads report it
    // as null so the API shape is unchanged.
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry' },
    // Owner request (14 Nov 2026): the flow is enquiry -> quotation -> sales
    // order, so an order records the quotation it was accepted from. Null on
    // the two older paths — a walk-in order, or an enquiry converted direct.
    // Left off the document when there is none, for the same reason as
    // enquiryId above.
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation' },
    // Owner request (17 Nov 2026): carried down from the quotation it was
    // accepted from, so the client's history is exact. No index, no default:
    // it is simply absent on an order that came from no client record.
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
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
    /*
     * Owner request (19 Nov 2026): "only sales person and admin can assign
     * the project to which Project manager ... they should only see the
     * project assigned to them."
     *
     * WHICH Manager, by id. projectTeam above is the name as it is printed
     * and is kept exactly as it was; a name cannot carry the rule, because
     * two people can share one and a renamed user would silently lose their
     * projects. Null on every order raised before this, and on one where
     * nobody was chosen.
     */
    projectManagerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
// enforced at the database level so a concurrent duplicate conversion fails
// even if the service-layer pre-check races.
//
// Sparse, and the field is absent on an order that has no lead -- an
// explicit null would be indexed and would collide with the next such
// order (see the note on enquiryId above). The index options are left
// exactly as they were on purpose: changing them would need the live index
// dropped first, and correcting what is written needs no migration.
salesOrderSchema.index({ enquiryId: 1 }, { unique: true, sparse: true });
// One sales order per quotation, enforced and written the same way.
salesOrderSchema.index({ quotationId: 1 }, { unique: true, sparse: true });

module.exports = model('SalesOrder', salesOrderSchema);
