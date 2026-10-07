'use strict';

const { Schema, model } = require('mongoose');

/**
 * inventoryIssues — one record of material handed to a staff member — the
 * core, stateful transaction tracking return/consumption over time.
 * See DATABASE_SCHEMA.md §14.
 *
 * Kept as its own collection, separate from inventoryTransactions — the PWA
 * never merges these two mechanisms, and this schema does not either
 * (no second stock ledger).
 *
 * status is DERIVED via balance = quantityIssued - quantityReturned - quantityUsed
 * (verified: issBal(x) = qty - rqty - used); the state-machine recomputation
 * itself is service-layer logic, not a schema validator, per instruction.
 */

const inventoryIssueSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA `co`
    itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true }, // PWA `item`
    quantityIssued: { type: Number, required: true }, // PWA `qty`
    // PWA `staff` (name) -> NEW BACKEND DESIGN (durable ref).
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    site: { type: String, required: true }, // PWA `site`
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // PWA `projId`
    fromLocationId: { type: Schema.Types.ObjectId, ref: 'InventoryLocation', required: true }, // PWA `loc`
    date: { type: Date, required: true }, // PWA `date`
    returnable: { type: Boolean, required: true }, // PWA `ret` — copied from the item at issue time
    quantityReturned: { type: Number, default: 0 }, // PWA `rqty` — cumulative
    quantityUsed: { type: Number, default: 0 }, // PWA `used` — cumulative
    // CURRENT IMPLEMENTATION (corrects the stale note this comment used to
    // carry): OPEN_DECISIONS.md #16 originally claimed `issStatus()` has an
    // operator-precedence bug making the literal `'Returned'` value
    // permanently unreachable. PWA_COVERAGE_AUDIT_INVENTORY.md §10/§25 item 9
    // independently re-verified this by directly EXECUTING the extracted
    // `issStatus()` expression in Node (not just re-reading it) and found the
    // opposite: `'Returned'` IS reachable (a fully-returned issue with
    // nothing marked used, e.g. qty:10,rqty:10,used:0, correctly derives
    // 'Returned'). See OPEN_DECISIONS.md #78 (supersedes #16, does not
    // delete it) and INVENTORY_DECISION_LOCK.md §24 Correction 1. The enum
    // value below also had its spacing corrected: the PWA literally emits
    // "Returned / Used" (with spaces around the slash), not "Returned/Used"
    // — see OPEN_DECISIONS.md #79 / INVENTORY_DECISION_LOCK.md §24
    // Correction 2. Both corrections are applied by the Inventory
    // implementation task (inventoryService.js's issStatus()) that added
    // this enum's spacing fix below.
    status: {
      type: String,
      enum: ['Issued', 'Return Requested', 'Partially Returned', 'Returned', 'Returned / Used', 'Consumed'],
      required: true,
      default: 'Issued',
    }, // PWA `status`, derived
    returnRequested: { type: Boolean, default: false }, // PWA `retReq`
    requestedQuantity: { type: Number, default: null }, // PWA `retReqQty`
    requestedDate: { type: Date, default: null }, // PWA `retReqDate`
    requestNote: { type: String, default: null }, // PWA `retReqNote`
    // PWA `by` (name) -> NEW BACKEND DESIGN (durable ref).
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    remark: { type: String, default: null }, // PWA `remark`
  },
  { timestamps: true, collection: 'inventoryIssues' }
);

inventoryIssueSchema.index({ companyId: 1, staffId: 1 });
inventoryIssueSchema.index({ companyId: 1, status: 1 });
inventoryIssueSchema.index({ companyId: 1, itemId: 1 });

module.exports = model('InventoryIssue', inventoryIssueSchema);
