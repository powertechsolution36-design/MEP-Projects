// ownershipPlugin — the mandatory ownership metadata block that DATABASE_ARCHITECTURE.md rev 12
// requires on EVERY v3 business collection, implemented once as a Mongoose plugin so no feature
// module ever hand-rolls (or forgets) it:
//
//   co, createdByUserId, createdByName, createdAt, updatedByUserId, updatedAt, status,
//   deleted / deletedAt / deletedByUserId / deletionReason      (soft-delete triad, §10)
//
// Hard rules encoded here:
//   * `createdByUserId` is the authoritative owner. `createdByName` is a cached DISPLAY value and is
//     never read by any authorization check (ACCESS_MATRIX.md §13.4 forbidden relationships).
//   * No hard delete of business history — the plugin provides a soft-delete path only, and the
//     default query filter hides deleted rows unless a caller explicitly asks for them (an
//     administrative/audit view), so an ordinary list endpoint can never leak them by omission.
//   * A migrated legacy row with no reliable creator gets `createdByUserId: null` +
//     `migrationReviewRequired: true` — never an invented owner.
//
// V3 PHASE 4 spec §2 / §10 / §12 / §16.
const mongoose = require('mongoose');
const { RECORD_STATES } = require('../../config/constants');

const OWNERSHIP_PATHS = ['co', 'createdByUserId', 'createdByName', 'updatedByUserId', 'status'];
const SOFT_DELETE_PATHS = ['deleted', 'deletedAt', 'deletedByUserId', 'deletionReason'];

// Minimum length for a deletion reason — API_ARCHITECTURE.md §4 destructive action guard.
const MIN_DELETION_REASON_LENGTH = 20;

/**
 * Adds `deleted: { $ne: true }` to a query unless the caller explicitly opted in to seeing deleted
 * rows (`.setOptions({ includeDeleted: true })`) or is already filtering on `deleted` itself.
 * Exported separately from the hook so it is directly unit-testable without a live connection.
 */
function applyNotDeletedFilter(query) {
  const options = typeof query.getOptions === 'function' ? (query.getOptions() || {}) : {};
  if (options.includeDeleted === true) return query;
  const filter = typeof query.getFilter === 'function' ? (query.getFilter() || {}) : {};
  if (Object.prototype.hasOwnProperty.call(filter, 'deleted')) return query;
  query.where({ deleted: { $ne: true } });
  return query;
}

function ownershipPlugin(schema, options = {}) {
  const {
    statusEnum = Object.values(RECORD_STATES),
    defaultStatus = RECORD_STATES.DRAFT,
    withStatus = true,
    withSoftDelete = true,
    autoFilterDeleted = true,
  } = options;

  const add = {};

  // `co` may already be declared by the model (most Phase 1–3 models declare it themselves with
  // their own index) — never overwrite an existing path, only fill in what is missing.
  if (!schema.path('co')) {
    add.co = { type: mongoose.Schema.Types.ObjectId, required: true, index: true };
  }
  if (!schema.path('createdByUserId')) {
    // Nullable on purpose: a migrated legacy row with no reliable creator is recorded as
    // `null` + migrationReviewRequired, never back-filled with a guessed user.
    add.createdByUserId = { type: mongoose.Schema.Types.ObjectId, default: null, index: true };
  }
  if (!schema.path('createdByName')) {
    add.createdByName = { type: String, default: null }; // DISPLAY ONLY — never an auth input
  }
  if (!schema.path('updatedByUserId')) {
    add.updatedByUserId = { type: mongoose.Schema.Types.ObjectId, default: null, index: true };
  }
  if (!schema.path('migrationReviewRequired')) {
    add.migrationReviewRequired = { type: Boolean, default: false, index: true };
  }
  if (withStatus && !schema.path('status')) {
    add.status = { type: String, enum: statusEnum, default: defaultStatus, index: true };
  }
  if (withSoftDelete) {
    if (!schema.path('deleted')) add.deleted = { type: Boolean, default: false, index: true };
    if (!schema.path('deletedAt')) add.deletedAt = { type: Date, default: null };
    if (!schema.path('deletedByUserId')) add.deletedByUserId = { type: mongoose.Schema.Types.ObjectId, default: null };
    if (!schema.path('deletionReason')) add.deletionReason = { type: String, default: null };
  }

  if (Object.keys(add).length) schema.add(add);

  // createdAt / updatedAt — the remaining two fields of the mandatory block.
  schema.set('timestamps', true);

  // Reporting/history support (§26): "created by / modified by / deleted by / date range" queries
  // must be index-backed from day one rather than retro-fitted once collections are large.
  schema.index({ co: 1, createdByUserId: 1, createdAt: -1 });
  schema.index({ co: 1, updatedByUserId: 1, updatedAt: -1 });
  if (withSoftDelete) schema.index({ co: 1, deleted: 1 });
  if (withStatus) schema.index({ co: 1, status: 1 });

  if (withSoftDelete && autoFilterDeleted) {
    // "Normal queries should exclude deleted records unless the caller has an appropriate
    // administrative/audit view" (§10) — enforced at the schema level so an endpoint cannot leak
    // deleted rows simply by forgetting the filter.
    for (const hook of ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany']) {
      schema.pre(hook, function preNotDeleted(next) {
        applyNotDeletedFilter(this);
        next();
      });
    }
  }

  /** Stamp creator metadata on a brand-new document. `createdByUserId` is authoritative. */
  schema.statics.stampCreate = function stampCreate(payload, user) {
    return {
      ...payload,
      co: user?.co,
      createdByUserId: user?._id ?? user?.id ?? null,
      createdByName: user?.name ?? null,      // display cache only
      updatedByUserId: user?._id ?? user?.id ?? null,
    };
  };

  /** Stamp updater metadata. Never rewrites createdByUserId — ownership is permanent. */
  schema.statics.stampUpdate = function stampUpdate(payload, user) {
    const out = { ...payload };
    delete out.createdByUserId;
    delete out.createdByName;
    delete out.createdAt;
    delete out.co;
    out.updatedByUserId = user?._id ?? user?.id ?? null;
    return out;
  };

  if (withSoftDelete) {
    /**
     * Soft-delete field set. The record stays queryable by an administrative/audit view and its
     * AuditLog history is never purged alongside it (API_ARCHITECTURE.md §9).
     */
    schema.statics.softDeleteFields = function softDeleteFields(user, reason) {
      if (!reason || String(reason).trim().length < MIN_DELETION_REASON_LENGTH) {
        const err = new Error(`A deletion reason of at least ${MIN_DELETION_REASON_LENGTH} characters is required`);
        err.code = 'DELETION_REASON_REQUIRED';
        throw err;
      }
      return {
        deleted: true,
        deletedAt: new Date(),
        deletedByUserId: user?._id ?? user?.id ?? null,
        deletionReason: String(reason).trim(),
        updatedByUserId: user?._id ?? user?.id ?? null,
      };
    };

    schema.statics.restoreFields = function restoreFields(user) {
      return {
        deleted: false,
        deletedAt: null,
        deletedByUserId: null,
        deletionReason: null,
        updatedByUserId: user?._id ?? user?.id ?? null,
      };
    };
  }

  return schema;
}

module.exports = {
  ownershipPlugin,
  applyNotDeletedFilter,
  OWNERSHIP_PATHS,
  SOFT_DELETE_PATHS,
  MIN_DELETION_REASON_LENGTH,
};
