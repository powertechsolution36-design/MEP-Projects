'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * companies — one document per tenant. Tenant root; every other business
 * collection carries a companyId reference back to this collection.
 * See DATABASE_SCHEMA.md §1.
 */

const contactSchema = new Schema(
  {
    name: { type: String },
    phone: { type: String },
  },
  { _id: false }
);

function maxTwoContacts(arr) {
  return !arr || arr.length <= 2;
}

const companySchema = new Schema(
  {
    name: { type: String, required: true }, // PWA FACT
    city: { type: String }, // PWA FACT
    address: { type: String }, // PWA FACT
    gstNumber: { type: String }, // PWA FACT
    divisions: {
      type: [{ type: String, enum: DIVISIONS }],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'At least one division must be selected (PWA FACT).',
      },
    },
    status: {
      type: String,
      enum: ['Trial', 'Active', 'Suspended'],
      required: true,
      default: 'Trial',
    }, // PWA FACT
    phone: { type: String }, // PWA FACT
    email: { type: String }, // PWA FACT
    tagline: { type: String }, // PWA FACT
    contacts: {
      type: [contactSchema],
      validate: { validator: maxTwoContacts, message: 'A company has at most 2 contacts (PWA FACT).' },
    },
    subscriptionRate: {
      type: Number,
      required: function () {
        return this.status === 'Active';
      },
    }, // PWA FACT
    subscriptionCycle: {
      type: String,
      enum: ['Monthly', 'Yearly'],
      required: function () {
        return this.status === 'Active';
      },
    }, // PWA FACT
    subscriptionStart: {
      type: Date,
      required: function () {
        return this.status === 'Active';
      },
    }, // PWA FACT
    subscriptionEnd: { type: Date }, // PWA FACT, optional
    trialEnd: { type: Date }, // PWA FACT — set automatically = since + 15 days when status=Trial
    since: { type: Date, required: true }, // PWA FACT — join date, set at creation
    // NEW BACKEND DESIGN — replaces the PWA's hard-coded "company id 1 is undeletable".
    // UNSPECIFIED BY PWA whether this concept is wanted at all (OPEN_DECISIONS.md #14).
    protected: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'companies' }
);

companySchema.index({ status: 1 });
companySchema.index({ trialEnd: 1 });
companySchema.index({ subscriptionEnd: 1 });

module.exports = model('Company', companySchema);
