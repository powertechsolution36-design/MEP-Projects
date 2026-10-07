'use strict';

const { Schema, model } = require('mongoose');

/**
 * inventoryItems — a stock-keeping unit (returnable tool/equipment or
 * non-returnable consumable) with per-location quantities.
 * See DATABASE_SCHEMA.md §13.
 *
 * Derived (NOT stored): total quantity across stockByLocation, stock state
 * (In Stock/Low Stock/Out of Stock), stock value — all computed at read
 * time in the PWA (totQty/stockState/stockValue are pure functions), so no
 * field for these is added here.
 */

const UNITS = Object.freeze(['Nos', 'Mtr', 'Kg', 'Set', 'Box', 'Roll', 'Ltr']);

const inventoryItemSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    code: { type: String }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
    categoryId: { type: Schema.Types.ObjectId, ref: 'InventoryCategory', default: null }, // PWA FACT
    unit: { type: String, enum: UNITS, required: true }, // PWA FACT
    returnable: { type: Boolean, required: true }, // PWA FACT
    minimumStockLevel: { type: Number, default: 0 }, // PWA FACT
    ratePerUnit: { type: Number, default: 0 }, // PWA FACT
    // Map key: InventoryLocation id (as string); value: quantity at that location.
    stockByLocation: { type: Map, of: Number, default: {} }, // PWA FACT
  },
  { timestamps: true, collection: 'inventoryItems' }
);

inventoryItemSchema.index({ companyId: 1, categoryId: 1 });
inventoryItemSchema.index({ companyId: 1, code: 1 });

module.exports = model('InventoryItem', inventoryItemSchema);
