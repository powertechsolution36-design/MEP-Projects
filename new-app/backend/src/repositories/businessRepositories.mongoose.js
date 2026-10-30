'use strict';

const mongoose = require('mongoose');
const { wrapDuplicateKeyError, ServiceError } = require('../errors');
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
  Quotation,
  ItemName,
  AmcTemplate,
  PaymentTermTemplate,
  QuotationTemplate,
  DailyTask,
  PushDevice,
  CustomerAccount,
  CustomerSession,
  ServiceCallAttachment,
  ProjectPhoto,
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
  async findById(companyId, id, session) {
    const doc = await Project.findOne({ _id: id, companyId }).session(session || null).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await Project.find({ companyId }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  /**
   * The customer portal's only way to reach a project (owner decision,
   * 30 Oct 2026). Both halves of the filter matter: `_id: $in` is the
   * client's explicit grant, `companyId` is the tenant. Ids that are not
   * valid ObjectIds are dropped rather than thrown on, so one stale entry
   * in an account's list cannot break the whole page.
   */
  async listByIdsForCompany(companyId, ids) {
    const clean = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id));
    if (clean.length === 0) return [];
    const docs = await Project.find({ _id: { $in: clean }, companyId }).lean();
    return docs.map(toPlainLean);
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
  async update(companyId, id, patch, session, options = {}) {
    const filter = { _id: id, companyId };
    // Optimistic lock: `expectedRevision` is the `revision` of the copy the
    // caller read and modified. undefined revision = a pre-existing document
    // that has never been written through this guard.
    const guarded = Object.prototype.hasOwnProperty.call(options, 'expectedRevision');
    if (guarded) {
      filter.revision = options.expectedRevision == null ? { $in: [null, 0] } : options.expectedRevision;
    }
    const doc = await Project.findOneAndUpdate(filter, { $set: patch, $inc: { revision: 1 } }, { new: true, session }).lean();
    if (!doc && guarded && (await Project.exists({ _id: id, companyId }).session(session || null))) {
      throw new ServiceError('This project was just changed by someone else. Reload and try again.', 'CONFLICT', 409);
    }
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

// Part-payment subdocuments come back from .lean() with only `_id`; the
// services and the frontend address them by `id` (the in-memory test fakes
// always carried `id`, which hid this). Add `id` to every entry.
function toPlainPayment(doc) {
  const plain = doc && doc.toObject ? toPlain(doc) : toPlainLean(doc);
  if (plain && Array.isArray(plain.partPayments)) {
    plain.partPayments = plain.partPayments.map((pp) => ({ ...pp, id: String(pp._id) }));
  }
  return plain;
}

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
      return toPlainPayment(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A payment record already exists for this sales order milestone.', 'PAYMENT_ALREADY_EXISTS');
    }
  },
  async findById(companyId, id) {
    const doc = await Payment.findOne({ _id: id, companyId }).lean();
    return toPlainPayment(doc);
  },
  async findBySalesOrderAndMilestone(companyId, salesOrderId, milestoneIndex) {
    const doc = await Payment.findOne({ companyId, salesOrderId, milestoneIndex }).lean();
    return toPlainPayment(doc);
  },
  async listByCompany(companyId, { status } = {}) {
    const query = { companyId };
    if (status) query.status = status;
    const docs = await Payment.find(query).lean();
    return docs.map(toPlainPayment);
  },
  async update(companyId, id, patch, session) {
    const doc = await Payment.findOneAndUpdate({ _id: id, companyId }, { $set: patch }, { new: true, session }).lean();
    return toPlainPayment(doc);
  },
  async pushPartPayment(companyId, id, partPayment, session) {
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId },
      { $push: { partPayments: partPayment } },
      { new: true, session }
    ).lean();
    return toPlainPayment(doc);
  },
  async updatePartPayment(companyId, id, partPaymentId, patch, session) {
    const setPatch = {};
    for (const [k, v] of Object.entries(patch)) setPatch[`partPayments.$.${k}`] = v;
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId, 'partPayments._id': partPaymentId },
      { $set: setPatch },
      { new: true, session }
    ).lean();
    return toPlainPayment(doc);
  },
  async removePartPayment(companyId, id, partPaymentId, session) {
    const doc = await Payment.findOneAndUpdate(
      { _id: id, companyId },
      { $pull: { partPayments: { _id: partPaymentId } } },
      { new: true, session }
    ).lean();
    return toPlainPayment(doc);
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
  /** Owner request (22 Oct 2026): payment and renewal on the AMC client. */
  async update(companyId, id, patch, session) {
    const doc = await Contract.findOneAndUpdate(
      { _id: id, companyId },
      { $set: patch },
      { new: true, runValidators: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  /** Renewal: archive the old period and switch to the new one in one write. */
  async renew(companyId, id, { archived, patch }, session) {
    const doc = await Contract.findOneAndUpdate(
      { _id: id, companyId },
      { $push: { renewals: archived }, $set: patch },
      { new: true, runValidators: true, session }
    ).lean();
    return toPlainLean(doc);
  },
  async findByLetterToken(token) {
    const doc = await Contract.findOne({ letterToken: token }).lean();
    return toPlainLean(doc);
  },
  /**
   * Candidate contracts for a phone number, across all tenants.
   *
   * Deliberately NOT company-scoped: a client registering for the portal
   * does not know their company and must never be allowed to name one — the
   * number is what decides which tenant they belong to. Used only by
   * portalAuthService.registerCustomer, which creates nothing a member of
   * staff has not approved.
   *
   * Contracts store the number as somebody typed it — "9422011234",
   * "+91 94220 11234", "094220-11234" are all the same client. This narrows
   * the scan with a regex that tolerates anything non-numeric between the
   * digits; the caller then compares properly normalised values, so the
   * regex only has to be generous, never exact.
   *
   * @param {string} nationalDigits the last ten digits, digits only
   */
  async findCandidatesByPhoneDigits(nationalDigits) {
    const d = String(nationalDigits || '').replace(/\D/g, '');
    if (d.length !== 10) return [];
    const pattern = new RegExp(`^\\D*(?:\\+?91\\D*)?${d.split('').join('\\D*')}\\D*$`);
    const docs = await Contract.find({ phone: pattern })
      .select('_id companyId customer site category phone').limit(50).lean();
    return docs.map(toPlainLean);
  },
  async setLetterTokenIfMissing(companyId, id, token) {
    await Contract.updateOne(
      { _id: id, companyId, $or: [{ letterToken: { $exists: false } }, { letterToken: null }] },
      { $set: { letterToken: token } }
    );
    const doc = await Contract.findOne({ _id: id, companyId }).lean();
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
  /** Owner request (22 Oct 2026): every call of one AMC / Warranty client, newest first. */
  async listByContract(companyId, contractId) {
    const docs = await ServiceCall.find({ companyId, contractId })
      .sort({ registeredDate: -1, _id: -1 })
      .select('-clientSignatureImage')
      .lean();
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
  // Service Report PDF link (owner decision 21 Oct 2026). The token is the
  // only key: it is unguessable and unique, so this lookup is not
  // company-scoped by design (the client has no login).
  async findByReportToken(token) {
    const doc = await ServiceCall.findOne({ reportToken: token }).lean();
    return toPlainLean(doc);
  },
  async setReportTokenIfMissing(companyId, id, token) {
    await ServiceCall.updateOne(
      { _id: id, companyId, $or: [{ reportToken: { $exists: false } }, { reportToken: null }] },
      { $set: { reportToken: token } }
    );
    const doc = await ServiceCall.findOne({ _id: id, companyId }).lean();
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
  // `session` (optional): reads made inside a transaction must use the
  // transaction's session, otherwise they see data outside its snapshot.
  async findById(companyId, id, session) {
    const doc = await InventoryItem.findOne({ _id: id, companyId }).session(session || null).lean();
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
   * synchronous, no-lock `moveStock()` read-modify-write.
   * UPDATE (Completion order): a decrement is applied only when the location
   * still holds enough stock (conditional `$gte` filter) and is otherwise
   * rejected with INSUFFICIENT_STOCK. The PWA's zero-floor clamp was only
   * reachable through a concurrent race (every PWA caller pre-checks stock),
   * where clamping would silently hide an over-issue. The legacy clamp pass
   * below only repairs a location that is already negative.
   */
  async incrementStockAtLocation(companyId, id, locationId, delta, session) {
    const key = `stockByLocation.${String(locationId)}`;
    // A decrement only applies when the location still holds enough stock
    // (checked atomically in the same update), so two concurrent issues or
    // transfers can never take a location below zero / over-issue. The
    // services already pre-check availability; this is the authoritative
    // guard.
    const filter = { _id: id, companyId };
    if (delta < 0) filter[key] = { $gte: -delta };
    const res = await InventoryItem.updateOne(filter, { $inc: { [key]: delta } }, { session });
    if (delta < 0 && res.matchedCount === 0) {
      const exists = await InventoryItem.exists({ _id: id, companyId }).session(session || null);
      if (!exists) return null;
      throw new ServiceError('Insufficient stock at this location.', 'INSUFFICIENT_STOCK', 400);
    }
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
  async findById(companyId, id, session) {
    const doc = await InventoryIssue.findOne({ _id: id, companyId }).session(session || null).lean();
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
  // Push notifications (owner decision 21 Oct 2026): confirms a notification
  // really exists (its transaction committed) before it is pushed to phones.
  async findById(companyId, id) {
    const doc = await Notification.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
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

const dailyTaskRepo = {
  async deleteManyByCompany(companyId, session) {
    await DailyTask.deleteMany({ companyId }, { session });
  },
  async create(data) {
    const doc = await DailyTask.create(data);
    return toPlain(doc);
  },
  async findById(companyId, id) {
    const doc = await DailyTask.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId, filters = {}) {
    const query = { companyId };
    if (filters.assigneeUserId) query.assigneeUserId = filters.assigneeUserId;
    if (filters.taskDate) {
      const start = new Date(filters.taskDate);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      query.taskDate = { $gte: start, $lt: end };
    }
    const docs = await DailyTask.find(query).sort({ taskDate: -1, createdAt: -1, _id: -1 }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  },
  async transition(companyId, id, expectedStatus, patch) {
    const doc = await DailyTask.findOneAndUpdate(
      { _id: id, companyId, status: expectedStatus },
      { $set: patch },
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

/**
 * Push devices (owner decision 21 Oct 2026) -- see src/models/PushDevice.js.
 */
const pushDeviceRepo = {
  async upsert({ token, userId, companyId, platform }) {
    const doc = await PushDevice.findOneAndUpdate(
      { token },
      { $set: { userId, companyId, platform: platform || 'android' } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    return toPlainLean(doc);
  },
  async removeByToken(token, filter) {
    const q = { token, ...(filter && filter.userId ? { userId: filter.userId } : {}) };
    const res = await PushDevice.deleteOne(q);
    return res.deletedCount > 0;
  },
  async listByUserIds(companyId, userIds) {
    if (!userIds.length) return [];
    const docs = await PushDevice.find({ companyId, userId: { $in: userIds } }).lean();
    return docs.map((d) => ({ token: d.token, userId: String(d.userId), companyId: String(d.companyId), platform: d.platform }));
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
  async deleteByCompany(companyId, session) {
    await Subscription.deleteMany({ companyId }, { session });
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

// ── Stage 7: Item Name Library ──
//
// Name-only, reusable library (NOT InventoryItem — no stock, no price).
// Scoped by companyId + division. Interface consumed by
// services/itemNameService.js.

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const itemNameRepo = {
  async findByNormalized(companyId, division, normalizedName) {
    const doc = await ItemName.findOne({ companyId, division, normalizedName }).lean();
    return toPlainLean(doc);
  },
  async incrementUsage(id) {
    const doc = await ItemName.findByIdAndUpdate(
      id,
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true }
    ).lean();
    return toPlainLean(doc);
  },
  async create(data) {
    try {
      const doc = await ItemName.create(data);
      return toPlain(doc);
    } catch (err) {
      // Concurrent first-save of the same name (unique companyId +
      // division + normalizedName index): the name already exists, so this
      // save counts as one more usage of it rather than failing the
      // document save that triggered it.
      if (err && err.code === 11000) {
        const doc = await ItemName.findOneAndUpdate(
          { companyId: data.companyId, division: data.division, normalizedName: data.normalizedName },
          { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
          { new: true }
        ).lean();
        if (doc) return toPlainLean(doc);
      }
      throw err;
    }
  },
  async listByCompanyDivision(companyId, division, limit) {
    const docs = await ItemName.find({ companyId, division })
      .sort({ usageCount: -1, normalizedName: 1 })
      .limit(limit || 20)
      .lean();
    return docs.map(toPlainLean);
  },
  /** Case-insensitive prefix + substring match on the normalized name. */
  async search(companyId, division, query, limit) {
    const normalizedQuery = String(query || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const docs = await ItemName.find({
      companyId,
      division,
      normalizedName: { $regex: escapeRegex(normalizedQuery) },
    })
      .sort({ usageCount: -1, normalizedName: 1 })
      .limit(limit || 20)
      .lean();
    return docs.map(toPlainLean);
  },
  async findById(companyId, id) {
    const doc = await ItemName.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async delete(companyId, id) {
    await ItemName.deleteOne({ _id: id, companyId });
  },
};

// ── Stage 7: Quotation ──
//
// Interface consumed by services/quotationService.js. Every query is
// company-scoped. No inventory collection is read or written here.

const quotationRepo = {
  async create(data) {
    try {
      const doc = await Quotation.create(data);
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A quotation with that number already exists.', 'QUOTATION_NUMBER_DUPLICATE');
    }
  },
  async findById(companyId, id) {
    const doc = await Quotation.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId, filters = {}) {
    const query = { companyId };
    if (filters.division) query.division = filters.division;
    if (filters.status) query.status = filters.status;
    if (filters.customerName) {
      query.customerName = { $regex: escapeRegex(filters.customerName), $options: 'i' };
    }
    const docs = await Quotation.find(query).sort({ createdAt: -1 }).lean();
    return docs.map(toPlainLean);
  },
  async updateFields(companyId, id, patch) {
    const doc = await Quotation.findOneAndUpdate(
      { _id: id, companyId },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();
    return toPlainLean(doc);
  },
  async delete(companyId, id) {
    await Quotation.deleteOne({ _id: id, companyId });
  },
  async findByPdfToken(token) {
    const doc = await Quotation.findOne({ pdfToken: token }).lean();
    return toPlainLean(doc);
  },
  async setPdfTokenIfMissing(companyId, id, token) {
    await Quotation.updateOne(
      { _id: id, companyId, $or: [{ pdfToken: { $exists: false } }, { pdfToken: null }] },
      { $set: { pdfToken: token } }
    );
    const doc = await Quotation.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
};

// ── Stage 7: AMC document templates (company overrides only) ──
//
// System default wording lives in services/amcDocumentService.js and is
// never written to the database; this repo stores only a company's own
// saved override (one per company per template type).

const amcTemplateRepo = {
  async findDefault(companyId, type) {
    const doc = await AmcTemplate.findOne({ companyId, type, isDefault: true }).lean();
    return toPlainLean(doc);
  },
  async upsertDefault(companyId, data) {
    if (!data.name || !String(data.name).trim()) {
      throw new ServiceError('Template name is required.');
    }
    const doc = await AmcTemplate.findOneAndUpdate(
      { companyId, type: data.type, isDefault: true },
      {
        $set: { name: data.name, sections: data.sections || [] },
        $inc: { version: 1 },
        $setOnInsert: { companyId, type: data.type, isDefault: true },
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    return toPlainLean(doc);
  },
  async listByCompany(companyId) {
    const docs = await AmcTemplate.find({ companyId }).sort({ type: 1 }).lean();
    return docs.map(toPlainLean);
  },
};

// ── Stage 7: Payment term templates ──
//
// Interface consumed by routes/paymentTermTemplateRoutes.js.

const quotationTemplateRepo = {
  async listByCompany(companyId, filters = {}) {
    const query = { companyId };
    if (filters.division) query.division = filters.division;
    const docs = await QuotationTemplate.find(query).sort({ name: 1 }).lean();
    return docs.map(toPlainLean);
  },
  async findById(companyId, id) {
    const doc = await QuotationTemplate.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async create(data) {
    try {
      const doc = await QuotationTemplate.create(data);
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A quotation starting point with that name already exists.', 'QUOTATION_TEMPLATE_DUPLICATE');
    }
  },
  async updateFields(companyId, id, patch) {
    try {
      const doc = await QuotationTemplate.findOneAndUpdate(
        { _id: id, companyId },
        { $set: patch },
        { new: true, runValidators: true }
      ).lean();
      return toPlainLean(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A quotation starting point with that name already exists.', 'QUOTATION_TEMPLATE_DUPLICATE');
    }
  },
  async delete(companyId, id) {
    await QuotationTemplate.deleteOne({ _id: id, companyId });
  },
  /** Only one starting point per division may be the automatic one. */
  async clearDefaults(companyId, division, exceptId) {
    const filter = { companyId, division, isDefault: true };
    if (exceptId) filter._id = { $ne: exceptId };
    await QuotationTemplate.updateMany(filter, { $set: { isDefault: false } });
  },
};

const paymentTermTemplateRepo = {
  async listByCompany(companyId, filters = {}) {
    const query = { companyId };
    if (filters.division) query.division = filters.division;
    if (filters.documentType) query.documentType = filters.documentType;
    const docs = await PaymentTermTemplate.find(query).sort({ name: 1 }).lean();
    return docs.map(toPlainLean);
  },
  async findById(companyId, id) {
    const doc = await PaymentTermTemplate.findOne({ _id: id, companyId }).lean();
    return toPlainLean(doc);
  },
  async create(data) {
    try {
      const doc = await PaymentTermTemplate.create(data);
      return toPlain(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A payment term template with that name already exists.', 'PAYMENT_TERM_TEMPLATE_DUPLICATE');
    }
  },
  async updateFields(companyId, id, patch) {
    try {
      const doc = await PaymentTermTemplate.findOneAndUpdate(
        { _id: id, companyId },
        { $set: patch },
        { new: true, runValidators: true }
      ).lean();
      return toPlainLean(doc);
    } catch (err) {
      wrapDuplicateKeyError(err, 'A payment term template with that name already exists.', 'PAYMENT_TERM_TEMPLATE_DUPLICATE');
    }
  },
  async delete(companyId, id) {
    await PaymentTermTemplate.deleteOne({ _id: id, companyId });
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

/* ================= Customer portal (owner decision, 27 Oct 2026) ================= */

const customerAccountRepo = {
  async create(data) {
    try {
      const doc = await CustomerAccount.create(data);
      return toPlainLean(doc.toObject());
    } catch (err) {
      throw wrapDuplicateKeyError(err, 'An account already exists for that mobile number.');
    }
  },
  /** Global by design: a registrant's phone number is what finds their tenant. */
  async findByPhone(phone) {
    return toPlainLean(await CustomerAccount.findOne({ phone }).lean());
  },
  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await CustomerAccount.findById(id).lean());
  },
  /** Company-scoped: what staff may act on. */
  async findByIdForCompany(companyId, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await CustomerAccount.findOne({ _id: id, companyId }).lean());
  },
  async listByCompany(companyId, filters = {}) {
    const q = { companyId };
    if (filters.status) q.status = filters.status;
    const docs = await CustomerAccount.find(q).sort({ createdAt: -1 }).limit(500).lean();
    return docs.map(toPlainLean);
  },
  /** Registrations that matched nothing, so belong to no company yet. */
  async listUnassigned() {
    const docs = await CustomerAccount.find({ companyId: null }).sort({ createdAt: -1 }).limit(200).lean();
    return docs.map(toPlainLean);
  },
  async updateFields(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await CustomerAccount.findOneAndUpdate({ _id: id }, { $set: patch }, { new: true }).lean());
  },
  async deleteManyByCompany(companyId, session) {
    await CustomerAccount.deleteMany({ companyId }, { session });
  },
};

const customerSessionRepo = {
  async create(data) {
    const doc = await CustomerSession.create(data);
    return toPlainLean(doc.toObject());
  },
  async findActive(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await CustomerSession.findOne({ _id: id, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
    return toPlainLean(doc);
  },
  async revoke(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await CustomerSession.findOneAndUpdate({ _id: id }, { $set: { revokedAt: new Date() } }, { new: true }).lean());
  },
  async revokeAllForAccount(accountId) {
    await CustomerSession.updateMany({ accountId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  },
  async deleteManyByCompany(companyId, session) {
    await CustomerSession.deleteMany({ companyId }, { session });
  },
};

const attachmentRepo = {
  async create(data) {
    const doc = await ServiceCallAttachment.create(data);
    return toPlainLean(doc.toObject());
  },
  /** Never returns the bytes — listings must stay cheap. */
  async listForCall(companyId, serviceCallId) {
    if (!mongoose.isValidObjectId(serviceCallId)) return [];
    const docs = await ServiceCallAttachment.find({ companyId, serviceCallId })
      .select('-data').sort({ createdAt: 1 }).lean();
    return docs.map(toPlainLean);
  },
  /** The bytes, for a request that has already been authorized. */
  async findById(companyId, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await ServiceCallAttachment.findOne({ _id: id, companyId }).lean());
  },
  async countForCall(companyId, serviceCallId) {
    if (!mongoose.isValidObjectId(serviceCallId)) return 0;
    return ServiceCallAttachment.countDocuments({ companyId, serviceCallId });
  },
  async deleteManyByCompany(companyId, session) {
    await ServiceCallAttachment.deleteMany({ companyId }, { session });
  },
};

/**
 * Photographs of work done on a project (owner decision, 30 Oct 2026).
 * Listings NEVER carry the bytes — only the one authorized read does.
 */
const projectPhotoRepo = {
  async create(data) {
    const doc = await ProjectPhoto.create(data);
    const out = toPlainLean(doc.toObject());
    delete out.data;
    return out;
  },
  async listForProject(companyId, projectId) {
    if (!mongoose.isValidObjectId(projectId)) return [];
    const docs = await ProjectPhoto.find({ companyId, projectId })
      .select('-data').sort({ updateIndex: 1, createdAt: 1 }).lean();
    return docs.map(toPlainLean);
  },
  async countForUpdate(companyId, projectId, updateIndex) {
    if (!mongoose.isValidObjectId(projectId)) return 0;
    return ProjectPhoto.countDocuments({ companyId, projectId, updateIndex });
  },
  async countForProject(companyId, projectId) {
    if (!mongoose.isValidObjectId(projectId)) return 0;
    return ProjectPhoto.countDocuments({ companyId, projectId });
  },
  /** The bytes, for a request that has already been authorized. */
  async findById(companyId, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toPlainLean(await ProjectPhoto.findOne({ _id: id, companyId }).lean());
  },
  async deleteById(companyId, id) {
    if (!mongoose.isValidObjectId(id)) return false;
    const res = await ProjectPhoto.deleteOne({ _id: id, companyId });
    return res.deletedCount > 0;
  },
  async deleteManyByCompany(companyId, session) {
    await ProjectPhoto.deleteMany({ companyId }, { session });
  },
};

module.exports = {
  enquiryRepo,
  projectPhotoRepo,
  salesOrderRepo,
  projectRepo,
  paymentRepo,
  contractRepo,
  serviceCallRepo,
  notificationRepo,
  dailyTaskRepo,
  checklistTemplateRepo,
  userRepoForEnquiry,
  counterRepo,
  pushDeviceRepo,
  withTransaction,
  inventoryCategoryRepo,
  inventoryLocationRepo,
  inventoryItemRepo,
  inventoryIssueRepo,
  inventoryTransactionRepo,
  planRepo,
  subscriptionRepo,
  itemNameRepo,
  quotationRepo,
  amcTemplateRepo,
  paymentTermTemplateRepo,
  quotationTemplateRepo,
  customerAccountRepo,
  customerSessionRepo,
  attachmentRepo,
};
