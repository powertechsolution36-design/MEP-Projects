'use strict';

const { Schema, model } = require('mongoose');

/**
 * inventoryLocations — a physical stock point (godown/site store/service van).
 * See DATABASE_SCHEMA.md §12.
 */
const inventoryLocationSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
  },
  { timestamps: true, collection: 'inventoryLocations' }
);

inventoryLocationSchema.index({ companyId: 1, name: 1 });

module.exports = model('InventoryLocation', inventoryLocationSchema);
