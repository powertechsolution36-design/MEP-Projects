'use strict';

const { Schema, model } = require('mongoose');
const { contactPersonSchema, maxContacts, MAX_CONTACTS } = require('./shared/contactSchema');
const { DIVISIONS } = require('./shared/enums');

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

/*
 * A second (third, fourth) site under the SAME contract.
 *
 * Owner question, answered 23 Nov 2026: "What if the client has AMC site
 * with 2 different location under 1 AMC — example Kapil Agency has a site
 * in Baner and Nana Peth", and his decision — one AMC and one amount, but
 * the visits and the machine details held per site, so the PM calendar
 * still tells an engineer which site to attend.
 *
 * The contract's own `site`, `capacity`, `make`, `equipmentModel`,
 * `equipmentType` and `scheduledVisits` ARE the first site. Everything
 * written before this existed therefore remains a one-site contract with
 * nothing to migrate, and every screen that reads `contract.site` keeps
 * reading the same thing. These are the sites after it.
 */
const extraSiteSchema = new Schema(
  {
    name: { type: String, required: true },
    capacity: { type: String, default: '' },
    make: { type: String, default: '' },
    equipmentModel: { type: String, default: '' },
    equipmentType: { type: String, default: '' },
    scheduledVisits: { type: [scheduledVisitSchema], default: [] },
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
    // The other sites' visits for that period, in the order they are
    // listed on the contract (23 Nov 2026).
    siteVisits: { type: [[scheduledVisitSchema]], default: [] },
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
    // Owner request (14 Nov 2026): which side of the business the cover
    // belongs to, chosen when the AMC is registered. Optional, because every
    // contract created before this field existed has none, and those records
    // are not guessed at — staff set it themselves.
    division: { type: String, enum: DIVISIONS },
    phone: { type: String }, // PWA FACT — the client's main number
    // Owner request (5 Nov 2026): the other people at the site, each with a
    // name and what they do there. The main number above is unchanged.
    contacts: {
      type: [contactPersonSchema],
      default: [],
      validate: { validator: maxContacts, message: `A client has at most ${MAX_CONTACTS} contacts.` },
    },
    email: { type: String }, // PWA FACT
    site: { type: String, required: true }, // PWA FACT — the firm, in the owner's words
    /*
     * Where that site is (owner, 23 Nov 2026): "Nana peth is Address not
     * Site, it is a place in Pune." Kapil Agencies Moto Central is the
     * site; Baner and Nana Peth are the addresses it is at, and the two
     * AMC records are told apart by this. Optional: every contract written
     * before this existed has none, and those are left for staff to fill
     * rather than guessed at.
     */
    address: { type: String, default: '' },
    /*
     * Which client in the directory this cover belongs to (24 Nov 2026).
     *
     * Owner: "link from Client to AMC/PM list, Site to Site, Customer Name
     * to Customer Name and Address to Address." The two lists had drifted
     * apart because an AMC record only ever held typed text and was matched
     * back to a client by name or number. A record raised from the client
     * list now says WHICH client it is, so a correction on the client
     * reaches it exactly rather than by resemblance. Optional: every
     * contract written before this has none and is still matched the old
     * way, which is what clientService does.
     */
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    capacity: { type: String }, // PWA FACT
    /*
     * Owner request (19 Nov 2026): "Use detail from AMC/PM list of AMC
     * client to Automatically fill service report make, model and
     * capacity." The machine under cover is the client's, not the visit's,
     * so it is recorded once here and every service report of theirs starts
     * filled in. Optional: every contract made before this field existed has
     * none, and those are left for staff to fill rather than guessed at.
     */
    make: { type: String },
    equipmentModel: { type: String },
    // The report's own "Type" line (owner request, 20 Nov 2026) — what the
    // machine is: cassette, hi-wall, ducted, VRF. Not `amcType`, which is
    // how often the visits fall, nor `category`, which is AMC or Warranty.
    equipmentType: { type: String },
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
    // The sites after the first one (23 Nov 2026) — see extraSiteSchema.
    extraSites: { type: [extraSiteSchema], default: [] },
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
