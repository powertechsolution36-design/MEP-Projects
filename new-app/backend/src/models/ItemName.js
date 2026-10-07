'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

/**
 * itemnames — permanent reusable item-name library.
 *
 * This is NOT InventoryItem. This is a commercial-document convenience:
 * a user types an item name once, and it becomes permanently reusable
 * across quotations, delivery challans, and other document line items.
 *
 * HARD RULE: This model stores NAME ONLY — no permanent price.
 * Prices are entered per-document, per-line.
 *
 * Company + division + normalizedName must be unique. Case/spacing
 * variations should not create duplicates.
 */

const itemNameSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    division: {
      type: String,
      enum: DIVISIONS,
      required: true,
    },
    name: { type: String, required: true, trim: true }, // original case
    normalizedName: { type: String, required: true }, // lowercase, trimmed, collapsed spaces
    defaultSection: {
      type: String,
      enum: ['Equipment', 'Accessories', ''],
      default: '',
    }, // convenience only, overridable per document line
    unit: { type: String, default: '' }, // default unit suggestion, overridable
    usageCount: { type: Number, default: 1 },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'itemnames' }
);

// Uniqueness: one canonical name per company per division
itemNameSchema.index({ companyId: 1, division: 1, normalizedName: 1 }, { unique: true });
// Autocomplete performance
itemNameSchema.index({ companyId: 1, division: 1, normalizedName: 'text' });
itemNameSchema.index({ companyId: 1, division: 1, usageCount: -1 });

module.exports = model('ItemName', itemNameSchema);
