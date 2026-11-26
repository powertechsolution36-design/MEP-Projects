'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS } = require('./shared/enums');

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

// Owner request (26 Nov 2026) -- the drawers of the Stock screen, and the
// shelves inside Machines. Kept in step with inventoryService's copies,
// which are what the API validates against.
const ITEM_GROUPS = Object.freeze(['Machines', 'Piping & Refnuts', 'PCB', 'Permanent Stock']);
const MACHINE_SUBGROUPS = Object.freeze([
  'Indoor', 'Outdoor', 'Panels', 'Remote', 'Split Indoor', 'Split Outdoor',
]);
// Owner request (26 Nov 2026): shelves inside Piping & Refnuts too.
const PIPING_SUBGROUPS = Object.freeze([
  'Copper Piping', 'Refnuts', 'Joints', 'Drain', 'Other',
]);
const ALL_SUBGROUPS = Object.freeze([...MACHINE_SUBGROUPS, ...PIPING_SUBGROUPS]);

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
    /*
     * Which side of the business the item belongs to (owner request, 24
     * Nov 2026): "add Division HVAC, Solar and MEP, or Common for all the
     * divisions." Copper pipe is HVAC's, a panel is Solar's, and a drill is
     * everybody's — "Common" says so rather than leaving it blank and
     * having people guess.
     *
     * Empty means nobody has said yet, which is every item on file before
     * today: those are left for staff to tag rather than guessed at.
     */
    division: { type: String, enum: [...DIVISIONS, 'Common', ''], default: '' },
    /*
     * Which drawer of the Stock screen the item lives in (owner request,
     * 26 Nov 2026). Division answers "whose is it"; the group answers
     * "what kind of thing is it", and the screen shows one drawer at a
     * time -- standing in Machines you see machines, not refnuts.
     *
     * Permanent Stock is the returnable drawer: a drill, a gas cylinder,
     * a multimeter -- it goes to site and comes back, so choosing it
     * turns `returnable` on (inventoryService.createItem/updateItem).
     *
     * Empty means nobody has sorted it yet. Those items are NOT hidden:
     * the screen gathers them under "Not sorted yet" (the lesson of the
     * 19 Nov assignment change, which emptied lists silently).
     */
    group: { type: String, enum: [...ITEM_GROUPS, ''], default: '' },
    /*
     * The shelf inside the drawer. Machines has Indoor, Outdoor, Panels,
     * Remote and the two Split halves; Piping & Refnuts has Copper
     * Piping, Refnuts, Joints, Drain and Other. A shelf is only valid
     * for the drawer it belongs to -- inventoryService enforces that --
     * and the other drawers have none, so it stays blank there.
     */
    subGroup: { type: String, enum: [...ALL_SUBGROUPS, ''], default: '' },
    /*
     * Which units this part fits (owner request, 26 Nov 2026): "I can
     * select in PCB that this PCB belongs to this Indoor from stock." A
     * PCB points at the machines it serves, so the storekeeper handing
     * one over can see what it is for without knowing the model numbers
     * by heart. Many-to-many: one board often fits several units.
     */
    fitsItemIds: [{ type: Schema.Types.ObjectId, ref: 'InventoryItem' }],
    // Map key: InventoryLocation id (as string); value: quantity at that location.
    stockByLocation: { type: Map, of: Number, default: {} }, // PWA FACT
  },
  { timestamps: true, collection: 'inventoryItems' }
);

inventoryItemSchema.index({ companyId: 1, categoryId: 1 });
inventoryItemSchema.index({ companyId: 1, group: 1, subGroup: 1 });
inventoryItemSchema.index({ companyId: 1, code: 1 });

module.exports = model('InventoryItem', inventoryItemSchema);
