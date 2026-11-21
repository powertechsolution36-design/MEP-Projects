'use strict';

const { Schema, model } = require('mongoose');
const { contactPersonSchema, maxContacts, MAX_CONTACTS } = require('./shared/contactSchema');

/**
 * enquiries — a sales lead, tracked to Won (→ SalesOrder) or Lost.
 * See DATABASE_SCHEMA.md §3. Verified: marking Lost does NOT require a
 * reason — lostReason stays optional, no required validator added.
 */

const followUpEntrySchema = new Schema(
  {
    date: { type: Date, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const enquirySchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT — project/address
    siteType: {
      type: String,
      enum: ['Residential', 'Commercial', 'Factory', 'Banquet Hall', 'Hospital', 'Office'],
    }, // PWA FACT
    capacity: { type: String }, // PWA FACT
    phone: { type: String }, // PWA FACT — the client's main number
    // Owner request (5 Nov 2026): the other people at the site, each with a
    // name and what they do there. The main number above is unchanged.
    contacts: {
      type: [contactPersonSchema],
      default: [],
      validate: { validator: maxContacts, message: `An enquiry has at most ${MAX_CONTACTS} contacts.` },
    },
    referenceSource: { type: String }, // PWA FACT
    segment: { type: String, required: true }, // PWA FACT — a division, or "AMC"
    rating: { type: Number, min: 1, max: 5 }, // PWA FACT
    estimatedValue: { type: Number }, // PWA FACT
    remark: { type: String }, // PWA FACT
    lastReviewDate: { type: Date }, // PWA FACT
    lastActionDone: { type: String }, // PWA FACT
    nextActionDescription: { type: String }, // PWA FACT
    nextActionDate: { type: Date }, // PWA FACT
    /*
     * Owner request (20 Nov 2026): "Enquiries required to allocate sales
     * engineer or admin. Sales engineer can see his Enquiries or allocated
     * Enquiries but admin can see all Enquiries with sales engineer name."
     *
     * Whose lead this is. A lead raised by a sales login belongs to that
     * login from the start; admin allocates or moves it afterwards. A lead
     * with nobody on it is nobody's in particular and every sales login
     * sees it — the leads already on file are all like that, and they must
     * not vanish from under the people working them.
     */
    assignedSalesUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['Open', 'Won', 'Lost'], required: true, default: 'Open' }, // PWA FACT
    followUpLog: { type: [followUpEntrySchema], default: [] }, // PWA FACT — append-only
    // PWA FACT (verified against source): optional — do not make required.
    lostReason: { type: String },
    lostDate: { type: Date }, // PWA FACT
  },
  { timestamps: true, collection: 'enquiries' }
);

enquirySchema.index({ companyId: 1, status: 1 });
enquirySchema.index({ companyId: 1, nextActionDate: 1 });
enquirySchema.index({ companyId: 1, assignedSalesUserId: 1 });

module.exports = model('Enquiry', enquirySchema);
