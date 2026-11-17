'use strict';

const { Schema, model } = require('mongoose');
const { contactPersonSchema, maxContacts, MAX_CONTACTS } = require('./shared/contactSchema');

/**
 * clients — the people we work for, kept once instead of retyped.
 *
 * OWNER REQUEST (16 Nov 2026, recorded call): "add the client ... next time
 * when you add the client's name it should come directly, in the drop down
 * ... on the admin page the client's list should be shown ... I can edit the
 * client there ... the company's name, client's name, client's GST address
 * ... and there should be multiple contact numbers added in it, one owner,
 * another the project manager."
 *
 * Until now the same client was typed fresh into every enquiry, quotation,
 * sales order and AMC record, so the same company was spelled three ways and
 * nobody could answer "who do we work for". This is the one record of that,
 * and the forms pick from it.
 *
 * It is a DIRECTORY, not an account: nothing here grants a login (that is
 * CustomerAccount) and nothing here is a contract (that is Contract). A
 * client may have no AMC, no project and no quotation and still belong here.
 */

const clientSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },

    // The firm we invoice. The usual case; for an individual it is simply
    // left blank and the person's name carries the record.
    companyName: { type: String, default: '', trim: true },
    // The person we deal with there.
    clientName: { type: String, default: '', trim: true },
    // Lowercased, space-collapsed companyName (or clientName when there is no
    // company). Deliberately NOT unique: two genuinely different firms can
    // share a name, and refusing the second would block real work. It is a
    // search and de-duplication aid, nothing more.
    normalizedName: { type: String, default: '', index: true },

    // "client's GST address" on the call -- the GST registration as it is
    // written on an invoice. Free text: a GSTIN, an address, or both.
    gst: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    // The main number, the one the dialler and WhatsApp use. The people below
    // are the rest of the site; see models/shared/contactSchema.js.
    phone: { type: String, default: '', trim: true },
    designation: { type: String, default: '', trim: true },
    contacts: {
      type: [contactPersonSchema],
      default: [],
      validate: { validator: maxContacts, message: `A client has at most ${MAX_CONTACTS} contacts.` },
    },

    notes: { type: String, default: '' },
    // Where this record came from, so a list built by the app's own work can
    // be told from one somebody typed: 'manual', 'amc', 'enquiry',
    // 'quotation'. Never a gate on anything -- it is for the reader.
    source: { type: String, default: 'manual' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'clients' }
);

clientSchema.index({ companyId: 1, normalizedName: 1 });
clientSchema.index({ companyId: 1, phone: 1 });

module.exports = model('Client', clientSchema);
