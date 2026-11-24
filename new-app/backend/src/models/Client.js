'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');
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

    /*
     * Which sides of the business this client is ours for (owner request,
     * 24 Nov 2026): "Solar will see only solar client and HVAC will see
     * their client, or if a client has both HVAC and solar, or all three,
     * can select multiple division."
     *
     * A list rather than one value, because a client genuinely can be
     * both — an air-conditioning customer who later puts panels on the
     * roof. EMPTY MEANS NOBODY HAS SAID YET, and an untagged client stays
     * visible to every office login: on 19 Nov confining projects to the
     * Manager they were assigned to emptied every Manager's list overnight,
     * and the same mistake with the client directory would hide all 53 of
     * them from the Solar Manager at once. They become confidential as
     * they are tagged, one at a time, by somebody who knows.
     */
    divisions: {
      type: [{ type: String, enum: DIVISIONS }],
      default: [],
    },
    contacts: {
      type: [contactPersonSchema],
      default: [],
      validate: { validator: maxContacts, message: `A client has at most ${MAX_CONTACTS} contacts.` },
    },

    /*
     * The client's other addresses (owner request, 23 Nov 2026 — he
     * pointed at the AMC record's own list and said "put this option in
     * Client", then corrected my wording: "Nana Peth is Address not Site,
     * it is a place in Pune").
     *
     * A firm is often in more than one place: Kapil Agencies Moto Central
     * is at Baner and at Nana Peth. The SITE is the firm; these are the
     * places it is at. The directory keeps them so the office can see them
     * all on the client without opening every AMC record — what is under
     * cover at each, and the PM visits, belong to the AMC records, which
     * stay one per address.
     */
    otherAddresses: {
      type: [new Schema(
        {
          address: { type: String, required: true, trim: true },
          label: { type: String, default: '', trim: true },
        },
        { _id: false }
      )],
      default: [],
      validate: {
        validator: (list) => !list || list.length <= 25,
        message: 'A client has at most 25 addresses.',
      },
    },

    /*
     * What this client USED to be called, and the numbers they used to be
     * on (owner request, 18 Nov 2026).
     *
     * Correcting a client corrects the records that copied their details —
     * but a quotation already sent deliberately keeps the name it went out
     * with. Without this, that document would stop being recognised as
     * theirs the moment they were renamed, and would fall off their page.
     * So every name and number they have had stays here and keeps matching.
     *
     * Normalized on the way in (lower-case, single-spaced names; last ten
     * digits of a number), because matching is the only thing they are for.
     */
    formerNames: { type: [String], default: [] },
    formerPhones: { type: [String], default: [] },

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
