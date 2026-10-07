'use strict';

const { Schema, model } = require('mongoose');

/**
 * inventoryCategories — a simple named grouping for items.
 * See DATABASE_SCHEMA.md §11. Delete-blocked-while-referenced is
 * application/service logic, not enforced at schema level here.
 */
const inventoryCategorySchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
  },
  { timestamps: true, collection: 'inventoryCategories' }
);

inventoryCategorySchema.index({ companyId: 1, name: 1 });

module.exports = model('InventoryCategory', inventoryCategorySchema);
