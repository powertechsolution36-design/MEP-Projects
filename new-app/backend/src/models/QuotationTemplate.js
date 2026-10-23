'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * quotationtemplates — ready-made starting points for a quotation
 * (owner request, 22 Oct 2026).
 *
 * The company keeps one per kind of offer — Split, Ductable, VRF, Solar —
 * holding the wording that is the same every time: the subject and system,
 * the benefits, the excluded works, the payment terms, and the heading and
 * specification rows that open the priced table. Creating a quotation from a
 * template copies that content into the new document; nothing stays linked,
 * so editing a quotation never changes the template and vice versa.
 *
 * Company-scoped and division-aware, exactly like paymenttermtemplates.
 * Nothing here is hardcoded to any one tenant.
 */

const lineSchema = new Schema(
  {
    rowType: { type: String, enum: ['item', 'sub', 'heading', 'spec'], default: 'item' },
    description: { type: String, default: '' },
    unit: { type: String, default: 'Nos' },
    qty: { type: Number, default: 0, min: 0 },
    supplyRate: { type: Number, default: 0 },
    installationRate: { type: Number, default: 0 },
    gstPercent: { type: Number, default: null },
  },
  { _id: false }
);

const termRowSchema = new Schema(
  {
    sequence: { type: Number, default: 1 },
    section: { type: String, default: '' },
    label: { type: String, default: '' },
    percentage: { type: String, default: '' },
    triggerEvent: { type: String, default: '' },
    wording: { type: String, default: '' },
  },
  { _id: false }
);

const quotationTemplateSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    name: { type: String, required: true, trim: true },
    division: { type: String, enum: DIVISIONS, required: true },

    // Copied into the new quotation, field for field.
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
    gstPercent: { type: Number, default: 18 },
    offerValidity: { type: String, default: '' },
    delivery: { type: String, default: '' },
    notes: { type: String, default: '' },
    excludedWorks: { type: [String], default: [] },
    paymentTerms: { type: [termRowSchema], default: [] },
    equipmentItems: { type: [lineSchema], default: [] },
    accessoriesItems: { type: [lineSchema], default: [] },

    // Owner request (22 Oct 2026): the usual starting point for a division
    // should be applied on its own, without being picked each time. At most
    // one per company per division carries this.
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'quotationtemplates' }
);

quotationTemplateSchema.index({ companyId: 1, name: 1 }, { unique: true });
quotationTemplateSchema.index({ companyId: 1, division: 1 });

module.exports = model('QuotationTemplate', quotationTemplateSchema);
