// Reporting / history foundation — V3 PHASE 4 spec §26.
//
// Future reporting modules need to answer "created by / modified by / deleted by / approved by /
// corrected by / reversed by, within a date range, for a module, within a company" WITHOUT each of
// them inventing its own query shape or — far worse — its own tenant filter. No reporting UI is
// built here (explicitly out of scope for Phase 4); this is the query layer those screens will call.
//
// TENANT SAFETY: `companyId` is mandatory on every builder. A history query with no company filter
// would be the easiest possible cross-tenant leak, so it is a thrown programming error rather than
// something a caller can forget.
const AuditLog = require('../models/AuditLog');
const RecordCorrection = require('../models/RecordCorrection');
const { AUDIT_ACTIONS } = require('../config/constants');

class HistoryQueryError extends Error {
  constructor(message, code = 'INVALID_HISTORY_QUERY') {
    super(message);
    this.name = 'HistoryQueryError';
    this.code = code;
  }
}

function requireCompany(companyId) {
  if (!companyId) throw new HistoryQueryError('companyId is required for any history query — a history query is never cross-tenant');
  return companyId;
}

function dateRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = from instanceof Date ? from : new Date(from);
  if (to) range.$lte = to instanceof Date ? to : new Date(to);
  return range;
}

/**
 * buildRecordQuery — a filter against any business collection carrying the ownership plugin block.
 * Answers created-by / modified-by / deleted-by / date-range / status questions.
 *
 * @param {Object} params
 * @param {*} params.companyId          REQUIRED
 * @param {*} [params.createdBy]        createdByUserId
 * @param {*} [params.modifiedBy]       updatedByUserId
 * @param {*} [params.deletedBy]        deletedByUserId (implies includeDeleted)
 * @param {string|string[]} [params.status]
 * @param {Date|string} [params.from]   createdAt lower bound
 * @param {Date|string} [params.to]     createdAt upper bound
 * @param {boolean} [params.includeDeleted=false]
 */
function buildRecordQuery({ companyId, createdBy, modifiedBy, deletedBy, status, from, to, includeDeleted = false }) {
  const filter = { co: requireCompany(companyId) };
  if (createdBy) filter.createdByUserId = createdBy;
  if (modifiedBy) filter.updatedByUserId = modifiedBy;
  if (deletedBy) filter.deletedByUserId = deletedBy;
  if (status) filter.status = Array.isArray(status) ? { $in: status } : status;

  const range = dateRange(from, to);
  if (range) filter.createdAt = range;

  // Deleted rows stay out unless the caller is explicitly an administrative/audit view (§10).
  // Asking "what did this user delete" is itself such a view, so deletedBy implies it.
  if (!includeDeleted && !deletedBy) filter.deleted = { $ne: true };
  return filter;
}

/**
 * buildAuditQuery — a filter against AuditLog. approved-by / corrected-by / reversed-by are not
 * separate fields anywhere; they are AuditLog entries with the corresponding frozen action, which
 * is exactly why "do not create another audit system" (§8) also makes the reporting layer simpler.
 *
 * @param {Object} params
 * @param {*} params.companyId          REQUIRED
 * @param {string} [params.resource]    module/collection name
 * @param {*} [params.resourceId]
 * @param {*} [params.actorId]          the acting user, whatever the action
 * @param {*} [params.approvedBy]       shorthand for actorId + action APPROVE
 * @param {*} [params.correctedBy]      shorthand for actorId + actions CORRECT/OVERRIDE
 * @param {*} [params.reversedBy]       shorthand for actorId + action REVERSE
 * @param {*} [params.deletedBy]        shorthand for actorId + action DELETE
 * @param {string|string[]} [params.actions]
 * @param {Date|string} [params.from]
 * @param {Date|string} [params.to]
 */
function buildAuditQuery({
  companyId, resource, resourceId, actorId, approvedBy, correctedBy, reversedBy, deletedBy,
  actions, from, to,
}) {
  const filter = { co: requireCompany(companyId) };
  if (resource) filter.resource = resource;
  if (resourceId) filter.resourceId = resourceId;

  const actionSet = new Set(
    actions ? (Array.isArray(actions) ? actions : [actions]) : [],
  );
  let actor = actorId;
  if (approvedBy) { actor = approvedBy; actionSet.add(AUDIT_ACTIONS.APPROVE); }
  if (correctedBy) { actor = correctedBy; actionSet.add(AUDIT_ACTIONS.CORRECT); actionSet.add(AUDIT_ACTIONS.OVERRIDE); }
  if (reversedBy) { actor = reversedBy; actionSet.add(AUDIT_ACTIONS.REVERSE); }
  if (deletedBy) { actor = deletedBy; actionSet.add(AUDIT_ACTIONS.DELETE); }

  if (actor) filter.user = actor;
  if (actionSet.size === 1) [filter.action] = [...actionSet];
  else if (actionSet.size > 1) filter.action = { $in: [...actionSet] };

  const range = dateRange(from, to);
  if (range) filter.timestamp = range;
  return filter;
}

/**
 * buildCorrectionQuery — a filter against RecordCorrection: every controlled Manager/Admin override
 * of another user's record, with its before/after and reason.
 */
function buildCorrectionQuery({ companyId, resource, recordId, overrideBy, originalOwner, supportOp, from, to }) {
  const filter = { co: requireCompany(companyId) };
  if (resource) filter.originalCollection = resource;
  if (recordId) filter.originalRecordId = recordId;
  if (overrideBy) filter.overrideByUserId = overrideBy;
  if (originalOwner) filter.originalCreatedByUserId = originalOwner;
  if (supportOp != null) filter.supportOp = !!supportOp;

  const range = dateRange(from, to);
  if (range) filter.overrideAt = range;
  return filter;
}

async function queryAuditTrail(params, { limit = 100, skip = 0 } = {}) {
  return AuditLog.find(buildAuditQuery(params)).sort({ timestamp: -1 }).skip(skip).limit(limit).lean();
}

async function queryCorrections(params, { limit = 100, skip = 0 } = {}) {
  return RecordCorrection.find(buildCorrectionQuery(params)).sort({ overrideAt: -1 }).skip(skip).limit(limit).lean();
}

/**
 * getRecordHistory — the full, combined trail for ONE record: its audit entries and any controlled
 * corrections applied to it. Audit history survives a soft delete and is never purged alongside the
 * record (API_ARCHITECTURE.md §9), so this still returns a complete story for a deleted record.
 */
async function getRecordHistory({ companyId, resource, recordId }, options = {}) {
  const [auditTrail, corrections] = await Promise.all([
    queryAuditTrail({ companyId, resource, resourceId: recordId }, options),
    queryCorrections({ companyId, resource, recordId }, options),
  ]);
  return { resource, recordId, auditTrail, corrections };
}

module.exports = {
  buildRecordQuery,
  buildAuditQuery,
  buildCorrectionQuery,
  queryAuditTrail,
  queryCorrections,
  getRecordHistory,
  HistoryQueryError,
};
