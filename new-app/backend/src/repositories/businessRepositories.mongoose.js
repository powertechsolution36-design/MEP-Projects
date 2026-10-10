'use strict';

const mongoose = require('mongoose');
const { wrapDuplicateKeyError } = require('../errors');
const {
  Enquiry,
  SalesOrder,
  Project,
  Payment,
  Notification,
  ChecklistTemplate,
  User,
  Contract,
  ServiceCall,
  InventoryCategory,
  InventoryLocation,
  InventoryItem,
  InventoryIssue,
  InventoryTransaction,
  Plan,
  Subscription,
} = require('../models');
const { Counter } = require('../models/Counter');

/**
 * Real, Mongoose-backed repositories for the Enquiry, SalesOrder, and
 * Payment/Finance business modules (DATABASE_SCHEMA.md §4/§5/§8,
 * PWA_COVERAGE_AUDIT_ENQUIRY.md, PWA_COVERAGE_AUDIT_SALESORDER.md).
 *
 * As with src/auth/repositories.mongoose.js, this module wires the pure
 * business logic in src/services/*.js to a real database for actual
 * deployment (via src/app.js), but is NOT exercised by the test suite —
 * tests inject in-memory fakes (tests/enquiryFakes.js) implementing the
 * exact same interface, so "no live database used in tests" stays true.
 */

function toPlain(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return { ...obj, id: String(obj._id) };
}

function toPlainLean(doc) {
  return doc ? { ...doc, id: String(doc._id) } : null;
}

const enquiryRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await Enquiry.deleteMany({ companyId }, { session });
  },
  async create(data) {
    const doc = await Enquiry.create(data);
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await Enquiry.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await Enquiry.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async updateFields(companyId, id, patch) {
    const doc = await Enquiry.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true }).lean();
    return toPlainLean(doc);
  },
  async pushFollowUp(companyId, id, patch, logEntry) {
    const doc = await Enquiry.findOneAndUpdate(
      { _id: id, companyId },
      { $set: patch, $push: { followUpLog: logEntry } },
      { new: true }
    ).lean();
    return toPlainLean(doc);
  },
  async reopenIfLost(companyId, id, logEntry) {
    // #18=A (preserve PWA behavior): only status + followUpLog change here —
    // lostReason/lostDate are intentionally left untouched.
    const doc = await Enquiry.findOneAndUpdate(
      { _id: id, companyId, status: 'Lost' },
      { $set: { status: 'Open' }, $push: { followUpLog: logEntry } },
      { new: true }
    ).lean();
    return toPlainLean(doc);
  },
  /**
   * #19=B (Won/Conversion Guard, NEW BACKEND DESIGN): atomic, race-safe
   * conditional update — the transition only happens if this Enquiry is
   * STILL `Open` at the instant of this single findOneAndUpdate, never via
   * a separate read-then-write pair (which would be racy).
   */
  async markWonIfOpen(companyId, id, { remark, logEntry }, session) {
    const doc = await Enquiry.findOneAndUpdate(
      { _id: id, companyId, status: 'Open' },
      { $set: { status: 'Won', remark }, $push: { followUpLog: logEntry } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
};

const DUPLICATE_KEY_ERROR_CODE = 11000;

const salesOrderRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await SalesOrder.deleteMany({ companyId }, { session });
  },
  async findByEnquiryId(companyId, enquiryId) {
    const doc = await SalesOrder.findOne({ companyId, enquiryId }).lean();
    return toPlainLean(doc);
  },
  /**
   * #20=D (durable reference + enforcement): relies on SalesOrder.js's
   * unique+sparse index on `enquiryId` as the final, database-level
   * race-safe guard against a second conversion of the same Enquiry — a
   * concurrent duplicate raises a MongoDB duplicate-key error (code 11000),
   * translated here into the same DUPLICATE_CONVERSION error the
   * pre-check in enquiryService.js raises. Also used, with `enquiryId:
   * null`, for the standalone "+ New SO" creation path
   * (src/services/salesOrderService.js) — the same unique+sparse index
   * never blocks two SOs both having `enquiryId: null` (sparse).
   */
  async create(data, session) {
    try {
      const [doc] = await SalesOrder.create([data], { session });
      return toPlain(doc);
    } catch (err) {
      if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
        const dup = new Error('This Enquiry has already been converted to a SalesOrder.');
        dup.code = 'DUPLICATE_CONVERSION';
        throw dup;
      }
      throw err;
    }
  },
  async findById(companyId, id) {
    const doc = await SalesOrder.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await SalesOrder.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  /** Plain field merge — PWA FACT (`saveSO`'s edit branch): no cascade re-run on edit. */
  async update(companyId, id, patch) {
    const doc = await SalesOrder.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true }).lean();
    return toPlainLean(doc);
  },
  /**
   * Payment-side milestone amount edit writes FORWARD onto the SO's own
   * milestone row (locked decision "SO milestone amount synchronization =
   * A" — PWA FACT `mPayEdit`'s `if(x.soNo){...so.pay[x.mi].a=amt}`).
   */
  async setMilestoneAmount(companyId, id, milestoneIndex, amount, session) {
    const doc = await SalesOrder.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { [`paymentMilestones.${milestoneIndex}.amount`]: amount } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  /**
   * `syncPayStatus`'s write-back of the milestone `rcv` flag (PWA FACT) —
   * the ONLY place a Payment mutation is allowed to touch the SO, per the
   * locked asymmetric-synchronization decision.
   */
  async setMilestoneReceived(companyId, id, milestoneIndex, received, session) {
    const doc = await SalesOrder.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { [`paymentMilestones.${milestoneIndex}.received`]: received } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
};

const projectRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await Project.deleteMany({ companyId }, { session });
  },
  async create(data, session) {
    // FIX-6-02: Project has a unique (companyId, salesOrderId) index — a
    // concurrent duplicate create (e.g. a raced double-submit) must surface a
    // friendly application error, never a raw E11000/driver message.
    try {
      const [doc] = await Project.create([data], { session });
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A project already exists for this sales order.', 'PROJECT_ALREADY_EXISTS');
    }
  },
  async findBySalesOrderId(companyId, salesOrderId) {
    const doc = await Project.findOne({ companyId, salesOrderId }).lean();
    return toPlainLean(doc);
  },
  async findById(companyId, id) {
    const doc = await Project.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await Project.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  /**
   * Generic plain-field/whole-array merge -- projectService.js reads the
   * full project into memory, transforms it (including the embedded
   * checklist/executionUpdates/deliveryChallans arrays, which are all
   * `_id:false` subdocuments -- see Project.js's class comment), and
   * passes back only the top-level keys that changed. This whole-array-
   * replace approach (rather than per-item positional `$set`/`$push`
   * operators for every one of the many checklist/DC mutation shapes) was
   * chosen deliberately: it keeps this repository small and uniform, and
   * every mutating call in projectService.js that touches more than one
   * field already goes through `deps.withTransaction`, so a whole-array
   * replace is no less safe than a positional update for this module's
   * actual concurrency profile (one project, one PM/engineer acting on it
   * at a time in practice) -- consistent with the task instructions'
   * explicit allowance to decide this per-item-by-index question during
   * implementation.
   */
  async update(companyId, id, patch, session) {
    const doc = await Project.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  /**
   * FIX-3.3-03: cross-company candidate set for the scheduled delay-check
   * job -- every project that could possibly be eligible for
   * `runDelayCheckForProject` (PWA FACT: `status==="Ongoing"` and
   * `timelineReady`, i.e. `timelineSet===true` -- the day-level throttle
   * itself is re-checked per project inside that function, not here).
   */
  async listEligibleForDelayCheck() {
    const docs = await Project.find({ status: 'Ongoing', timelineSet: true }, { _id: 1, companyId: 1 }).lean();
    return docs.map((d) => ({ id: String(d._id), companyId: String(d.companyId) }));
  },
};

const paymentRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await Payment.deleteMany({ companyId }, { session });
  },
  async create(data, session) {
    // FIX-6-02: Payment has a unique, sparse (companyId, salesOrderId,
    // milestoneIndex) index — raiseToFinance's "create on the fly" path can race
    // with itself; translate the resulting E11000 into a friendly error.
    try {
      const [doc] = await Payment.create([data], { session });
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A payment record already exists for this sales order milestone.', 'PAYMENT_ALREADY_EXISTS');
    }
  },
  async findById(companyId, id) {
    const doc = await Payment.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async findBySalesOrderAndMilestone(companyId, salesOrderId, milestoneIndex) {
    const doc = await Payment.findOne({ companyId, salesOrderId, milestoneIndex }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId, { status } = {}) {
    const query = { companyId };
    if (status) query.status = status;
    const docs = await Payment.find(query).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async update(companyId, id, patch, session) {
    const doc = await Payment.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  async pushPartPayment(companyId, id, partPayment, session) {
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId },
      { $push: { partPayments: partPayment } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  async updatePartPayment(companyId, id, partPaymentId, patch, session) {
    const setPatch = {};
    for (const [k, v] of Object.entries(patch)) setPatch[`partPayments.$.${k}`] = v;
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId, 'partPayments._id': partPaymentId },
      { $set: setPatch },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  async removePartPayment(companyId, id, partPaymentId, session) {
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId },
      { $pull: { partPayments: { _id: partPaymentId } } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  /** PWA FACT (`delPayRow`): whole-record delete, only ever offered for a
   * non-SO-linked Payment — enforced at the service layer, not here. */
  async remove(companyId, id) {
    await Payment.deleteOne({ _id: id, companyId });
    return true;
  },
};

/**
 * contractRepo — backs src/services/contractService.js (Contract / AMC /
 * Warranty). See PWA_COVERAGE_AUDIT_CONTRACT.md / CONTRACT_DECISION_LOCK.md.
 * No update/remove-whole-record method exists here on purpose: Contract has
 * no edit/delete function anywhere in the PWA (Decisions 2-3) — the only
 * post-creation mutation is `setVisitCompleted`, the one automatic
 * `scheduledVisits[i].completedDate` stamp (Decision 4).
 */
const contractRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await Contract.deleteMany({ companyId }, { session });
  },
  async create(data, session) {
    const [doc] = await Contract.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await Contract.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await Contract.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  /**
   * CONTRACT_DECISION_LOCK.md Decision 4/§7 (the Contract-facing half of
   * the ServiceCall completion boundary): a positional update stamping
   * ONE scheduledVisits[visitIndex].completedDate — the caller
   * (contractService.completePmVisitForContract) has already recomputed
   * the due-visit list fresh and chosen the first-due index itself.
   */
  async setVisitCompleted(companyId, id, visitIndex, completedDate, session) {
    const doc = await Contract.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { [`scheduledVisits.${visitIndex}.completedDate`]: completedDate } },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
};

/**
 * serviceCallRepo — backs src/services/serviceCallService.js. See
 * PWA_COVERAGE_AUDIT_SERVICECALL.md / SERVICECALL_DECISION_LOCK.md.
 *
 * `listByCompany` sorts by `_id: 1` (ObjectIds are monotonically
 * increasing) to give a deterministic, true insertion-order result set --
 * the service layer then reverses it to reproduce the PWA's
 * `.slice().reverse()` "newest-pushed-first" list behavior
 * (SERVICECALL_DECISION_LOCK.md §18) without depending on MongoDB's
 * unspecified natural-order guarantee.
 *
 * `completeIfNotCompleted` is the ONE new-backend-only concurrency-safety
 * primitive (SERVICECALL_DECISION_LOCK.md Decision 7/10): an atomic
 * conditional transition (`status: { $ne: 'Completed' }`), the same
 * race-safe pattern already established by `enquiryRepo.markWonIfOpen`.
 * This is NOT a re-completion guard/business rule (the PWA has none, and
 * none is added here) -- a losing/retried call simply receives `null` back
 * and the service layer treats that as an idempotent no-op (returns the
 * already-Completed record, performs no side effects again), never a
 * rejection error.
 */
const serviceCallRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await ServiceCall.deleteMany({ companyId }, { session });
  },
  async create(data, session) {
    const [doc] = await ServiceCall.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await ServiceCall.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await ServiceCall.find({ companyId }).sort({ _id: 1 }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async update(companyId, id, patch, session) {
    const doc = await ServiceCall.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  async completeIfNotCompleted(companyId, id, patch, session) {
    const doc = await ServiceCall.findOneAndUpdate(
      { _id: id, companyId, status: { $ne: 'Completed' } },
      { $set: patch },
      { new: true, session }
    ).lean();
    return toPlainLean(doc);
  },
};


/**
 * Inventory repositories — back src/services/inventoryService.js. See
 * PWA_COVERAGE_AUDIT_INVENTORY.md / INVENTORY_DECISION_LOCK.md. Every
 * lookup (including single-record ones) is company-scoped — closing the
 * PWA's own cross-tenant `itemById()`/`catName()`/`locName()` gap is the
 * one mandatory infra/security fix this document requires
 * (INVENTORY_DECISION_LOCK.md Decision 41).
 */
const inventoryCategoryRepo = {
  async create(data, session) {
    const [doc] = await InventoryCategory.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await InventoryCategory.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await InventoryCategory.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async rename(companyId, id, name, session) {
    const doc = await InventoryCategory.findOneAndUpdate({ _id: id, companyId }, { $set: { name } }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  async remove(companyId, id, session) {
    const res = await InventoryCategory.deleteOne({ _id: id, companyId }, { session });
    return res.deletedCount > 0;
  },
};

const inventoryLocationRepo = {
  async create(data, session) {
    const [doc] = await InventoryLocation.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await InventoryLocation.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await InventoryLocation.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async rename(companyId, id, name, session) {
    const doc = await InventoryLocation.findOneAndUpdate({ _id: id, companyId }, { $set: { name } }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  async remove(companyId, id, session) {
    const res = await InventoryLocation.deleteOne({ _id: id, companyId }, { session });
    return res.deletedCount > 0;
  },
};

const inventoryItemRepo = {
  async create(data, session) {
    const [doc] = await InventoryItem.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await InventoryItem.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await InventoryItem.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async update(companyId, id, patch, session) {
    const doc = await InventoryItem.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  /**
   * Concurrency-safe stock mutation (INVENTORY_DECISION_LOCK.md Decision
   * 10/§25 item 6) — an atomic `$inc` on the Map path replaces the PWA's
   * synchronous, no-lock `moveStock()` read-modify-write, then a follow-up
   * clamp-to-zero pass reproduces `moveStock()`'s own zero-floor exactly
   * (PRESERVE PWA — the clamp is a real, independently verified PWA quirk,
   * not something to "fix" into a rejection).
   */
  async incrementStockAtLocation(companyId, id, locationId, delta, session) {
    const key = `stockByLocation.${String(locationId)}`;
    await InventoryItem.updateOne({ _id: id, companyId }, { $inc: { [key]: delta } }, { session });
    const doc = await InventoryItem.findOne({ _id: id, companyId }).session(session || null);
    if (!doc) return null;
    const current = Number(doc.stockByLocation.get(String(locationId))) || 0;
    if (current < 0) {
      doc.stockByLocation.set(String(locationId), 0);
      await doc.save({ session });
    }
    return toPlainLean(doc.toObject());
  },
  async remove(companyId, id, session) {
    const res = await InventoryItem.deleteOne({ _id: id, companyId }, { session });
    return res.deletedCount > 0;
  },
};

const inventoryIssueRepo = {
  async create(data, session) {
    const [doc] = await InventoryIssue.create([data], { session });
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await InventoryIssue.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await InventoryIssue.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async listByStaff(companyId, staffId) {
    const docs = await InventoryIssue.find({ companyId, staffId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async update(companyId, id, patch, session) {
    const doc = await InventoryIssue.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
};

/**
 * inventoryTransactionRepo — append-only ledger writer
 * (INVENTORY_DECISION_LOCK.md Decision 29: no update/delete method exists
 * here on purpose, matching the schema's own `immutable: true` fields and
 * the PWA's own confirmed lack of any edit/delete function for `invTxns`).
 */
const inventoryTransactionRepo = {
  async create(data, session) {
    const [doc] = await InventoryTransaction.create([data], { session });
    return toPlain(doc);
  },
  async listByCompany(companyId) {
    const docs = await InventoryTransaction.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async listByItem(companyId, itemId) {
    const docs = await InventoryTransaction.find({ companyId, itemId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
};

const notificationRepo = {
  // FIX-6-03 (B2 -- Company deletion/cascade): part of the PWA's
  // literal 8-collection cascade list (delCompany, index.html:1811-1817).
  async deleteManyByCompany(companyId, session) {
    await Notification.deleteMany({ companyId }, { session });
  },
  async create(data, session) {
    const [doc] = await Notification.create([data], { session });
    return toPlain(doc);
  },
  /**
   * FIX-B1: list notifications targeted at a role (or the "*" all-roles
   * marker) within a company, newest first. Recipients are role-based only
   * (PWA FACT -- notify() never targets an individual user), so listing is
   * "any notification whose targetRoles includes this actor's role or '*'".
   */
  async listForRole(companyId, role, options) {
    const limit = (options && options.limit) || 200;
    const docs = await Notification.find({
      companyId,
      targetRoles: { $in: [role, '*'] },
    })
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async markRead(companyId, id, userId) {
    const doc = await Notification.findOneAndUpdate(
      { _id: id, companyId },
      { $addToSet: { readByUserIds: userId } },
      { new: true }
    ).lean();
    return toPlainLean(doc);
  },
};

const checklistTemplateRepo = {
  /** Mirrors PWA `defaultChkList(div)`: prefers isDefault=true, falls back to any template for the division, else null. */
  async findDefaultForDivision(companyId, division) {
    const preferred = await ChecklistTemplate.findOne({ companyId, division, isDefault: true }).lean();
    if (preferred) return toPlainLean(preferred);
    const any = await ChecklistTemplate.findOne({ companyId, division }).lean();
    return toPlainLean(any);
  },
  // Used by projectService.js's applyChecklistTemplate (reading a named
  // template to seed/replace a project's checklist) AND by
  // checklistTemplateService.js (FIX-3.3-01 Checklist Library CRUD).
  async findById(companyId, id) {
    const doc = await ChecklistTemplate.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  /** Mirrors PWA `chkLists(div)` with a division filter. */
  async listByDivision(companyId, division) {
    const docs = await ChecklistTemplate.find({ companyId, division }).sort({ createdAt: 1 }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  /** Mirrors PWA `chkLists()` with no division filter (all divisions). */
  async listByCompany(companyId) {
    const docs = await ChecklistTemplate.find({ companyId }).sort({ createdAt: 1 }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async create(data, session) {
    const [doc] = await ChecklistTemplate.create([data], { session });
    return toPlain(doc);
  },
  async updateFields(companyId, id, patch, session) {
    const doc = await ChecklistTemplate.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainLean(doc);
  },
  /** Mirrors PWA `setDefChkList`/`createChkList`'s `chkLists(dv).forEach(c=>c.def=false)` step. */
  async unsetDefaultsForDivision(companyId, division, session) {
    await ChecklistTemplate.updateMany({ companyId, division, isDefault: true }, { $set: { isDefault: false } }, { session });
  },
  async countByDivision(companyId, division) {
    return ChecklistTemplate.countDocuments({ companyId, division });
  },
  async deleteById(companyId, id, session) {
    await ChecklistTemplate.deleteOne({ _id: id, companyId }, { session });
  },
};

const userRepoForEnquiry = {
  async findById(id) {
    const doc = await User.findById(id).lean();
    return doc ? { id: String(doc._id), name: doc.name, role: doc.role, companyId: String(doc.companyId) } : null;
  },
  // Added for projectService.js's engineer-name search (listProjects) and
  // CSV export (exportProjectsCsv) -- resolving assignedEngineerIds back to
  // display names for the free-text search / report columns.
  async listByCompany(companyId) {
    const docs = await User.find({ companyId }).lean();
    return docs.map((d) => ({ id: String(d._id), name: d.name, role: d.role, companyId: String(d.companyId) }));
  },
};

const counterRepo = {
  async getNextSequence(companyId, name, session) {
    const doc = await Counter.findOneAndUpdate(
      { companyId, name },
      { $inc: { value: 1 } },
      { new: true, upsert: true, session }
    );
    return doc.value;
  },
};

// ── Plan catalog ──

const planRepo = {
  async listAll() {
    const docs = await Plan.find({}).lean();
    return docs.map(toPlainLean);
  },
  async findByCode(code) {
    const doc = await Plan.findOne({ code: code.toUpperCase() }).lean();
    return toPlainLean(doc);
  },
  async create(data) {
    try {
      const doc = await Plan.create(data);
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A plan with that code already exists.', 'PLAN_CODE_DUPLICATE');
    }
  },
  async updateByCode(code, patch) {
    const doc = await Plan.findOneAndUpdate(
      { code: code.toUpperCase() },
      { $set: patch },
      { new: true }
    ).lean();
    return toPlainLean(doc);
  },
};

// ── Subscription (one per company) ──

const subscriptionRepo = {
  async findByCompany(companyId) {
    const doc = await Subscription.findOne({ companyId }).lean();
    return toPlainLean(doc);
  },
  async create(data) {
    const doc = await Subscription.create(data);
    return toPlain(doc);
  },
  /**
   * Update an existing subscription. Handles the `$push` operator used by
   * subscriptionService.createOrUpdateSubscription (line 121) — separates
   * `$push` from the flat field data so Mongoose applies the array append
   * correctly instead of storing `$push` as a literal field name.
   */
  async update(id, data) {
    const ops = {};
    const rest = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '$push') {
        ops.$push = value;
      } else {
        rest[key] = value;
      }
    }
    if (Object.keys(rest).length > 0) ops.$set = rest;
    const doc = await Subscription.findByIdAndUpdate(id, ops, { new: true }).lean();
    return toPlainLean(doc);
  },
};

/**
 * Runs fn(txnDeps) inside a real MongoDB transaction (a Mongoose session),
 * committing on success and aborting on any thrown error. Used by the
 * Enquiry -> SalesOrder cascade, the standalone SO creation cascade, and
 * every Payment mutation that must keep the linked SalesOrder milestone's
 * `rcv`/`amount` fields consistent with the Payment record in one atomic
 * step (never a separate, non-atomic read-then-write pair).
 *
 * txnDeps is the same deps object with a `session` key attached so every
 * repo call in the cascade can participate in the same transaction.
 */
async function withTransaction(deps, fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn({ ...deps, session });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  enquiryRepo,
  salesOrderRepo,
  projectRepo,
  paymentRepo,
  contractRepo,
  serviceCallRepo,
  notificationRepo,
  checklistTemplateRepo,
  userRepoForEnquiry,
  counterRepo,
  withTransaction,
  inventoryCategoryRepo,
  inventoryLocationRepo,
  inventoryItemRepo,
  inventoryIssueRepo,
  inventoryTransactionRepo,
  planRepo,
  subscriptionRepo,
};
