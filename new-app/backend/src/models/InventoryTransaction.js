'use strict';

const { Schema, model } = require('mongoose');

/**
 * inventoryTransactions — the immutable, append-only ledger underlying
 * EVERY stock-affecting movement — the single audit trail for the whole
 * Inventory subsystem. See DATABASE_SCHEMA.md §15.
 *
 * This is the only stock ledger; no second ledger is modeled. No update or
 * delete workflow is exposed for this collection at the application-policy
 * level (per instruction) — this schema intentionally provides no
 * soft-delete/edit fields for it.
 */

const TRANSACTION_TYPES = Object.freeze([
  'Opening Stock',
  'Purchase In',
  'Damage / Write-off',
  'Adjustment',
  'Issue',
  'Return',
  'Transfer',
  'Consumed',
]);

const inventoryTransactionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    date: { type: Date, required: true }, // PWA FACT
    type: { type: String, enum: TRANSACTION_TYPES, required: true, immutable: true }, // PWA FACT
    itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true }, // PWA FACT
    quantity: { type: Number, required: true, immutable: true }, // PWA FACT
    fromLocationId: { type: Schema.Types.ObjectId, ref: 'InventoryLocation', default: null, immutable: true }, // PWA FACT
    toLocationId: { type: Schema.Types.ObjectId, ref: 'InventoryLocation', default: null, immutable: true }, // PWA FACT
    // PWA FACT (as name) -> NEW BACKEND DESIGN (durable ref).
    recordedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    referenceText: { type: String, default: null, immutable: true }, // PWA FACT
    remark: { type: String, default: null, immutable: true }, // PWA FACT
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'inventoryTransactions' }
);

inventoryTransactionSchema.index({ companyId: 1, itemId: 1, date: -1 });
inventoryTransactionSchema.index({ companyId: 1, date: -1 });

module.exports = model('InventoryTransaction', inventoryTransactionSchema);
