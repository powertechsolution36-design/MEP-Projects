'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * paymenttermtemplates — reusable payment-term row sets.
 *
 * A quotation may use a saved template or custom rows.
 * Templates are company-scoped and division-aware.
 */

const termRowSchema = new Schema(
  {
    sequence: { type: Number, required: true },
    section: { type: String, default: '' }, // 'Equipment', 'Accessories', or ''
    label: { type: String, default: '' },
    percentage: { type: String, default: '' },
    triggerEvent: { type: String, default: '' },
    wording: { type: String, default: '' },
  },
  { _id: false }
);

const paymentTermTemplateSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    division: { type: String, enum: [...DIVISIONS, ''], default: '' },
    documentType: {
      type: String,
      enum: ['quotation', 'amc', 'general'],
      default: 'quotation',
    },
    rows: { type: [termRowSchema], default: [] },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'paymenttermtemplates' }
);

paymentTermTemplateSchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = model('PaymentTermTemplate', paymentTermTemplateSchema);
