// Immutable system-field protection — V3 PHASE 4 spec §12 / §16.
//
// An ordinary update request must never be able to change `_id`, `companyId`/`co`,
// `createdByUserId`, `createdAt`, approval history, audit history, or a module's own declared
// immutable fields (e.g. a posted ledger line). middleware/tenant.js already strips client-supplied
// company keys as an anti-spoofing measure (Phase 1 STEP 6); this is the broader, per-resource
// guarantee that covers ownership and history fields too, enforced SERVER-SIDE regardless of what
// the client sends or what the UI renders.
//
// Two enforcement modes, both provided deliberately:
//   * STRIP (default)  — silently drop the protected keys from the payload and continue. This is
//     the right default for a normal PUT where a client echoes back a whole record it just read;
//     rejecting those would make every round-trip update fail for no security benefit.
//   * REJECT           — 422 when a protected key is present AND carries a value different from the
//     stored record's. Use for high-integrity resources where a silent drop would hide a genuine
//     client bug or a tampering attempt.
const { sendError } = require('../utils/ApiError');
const { immutableFieldsFor } = require('../config/recordPolicy');

/**
 * Pure helper — computes what an update payload is trying to change among protected fields.
 * @param {Object} payload  the incoming update body
 * @param {Object} [record] the stored record, when available (enables value-aware comparison)
 * @param {string} resource
 * @returns {{present:string[], changed:string[], fields:string[]}}
 *   present — protected keys that appeared in the payload at all
 *   changed — protected keys whose payload value differs from the stored value (or where there is
 *             no stored record to compare against, so the change cannot be ruled out)
 */
function inspectImmutableFields(payload, record, resource) {
  const fields = immutableFieldsFor(resource);
  const present = [];
  const changed = [];
  if (!payload || typeof payload !== 'object') return { present, changed, fields };

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    present.push(field);
    if (!record) { changed.push(field); continue; }
    const stored = record[field];
    const incoming = payload[field];
    // String-compare so an ObjectId and its string form are treated as equal — a client echoing
    // back `createdByUserId` it just read is not attempting a change.
    const same = stored == null && incoming == null
      ? true
      : String(stored ?? '') === String(incoming ?? '');
    if (!same) changed.push(field);
  }
  return { present, changed, fields };
}

/** Removes every protected field from the payload in place, returning the names removed. */
function stripImmutableFields(payload, resource) {
  const fields = immutableFieldsFor(resource);
  const removed = [];
  if (!payload || typeof payload !== 'object') return removed;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      delete payload[field];
      removed.push(field);
    }
  }
  return removed;
}

/**
 * Throws when an update payload attempts to change a protected field. Used by
 * services/recordService.js so the rule also holds for a service called outside an Express route.
 */
function assertNoImmutableFieldChange(payload, record, resource) {
  const { changed } = inspectImmutableFields(payload, record, resource);
  if (changed.length) {
    const err = new Error(`Immutable field(s) cannot be modified: ${changed.join(', ')}`);
    err.code = 'IMMUTABLE_FIELD';
    err.details = { fields: changed };
    err.status = 422;
    throw err;
  }
}

/**
 * Express middleware.
 * @param {Object} opts
 * @param {string} opts.resource
 * @param {'strip'|'reject'} [opts.mode='strip']
 */
function protectImmutableFields({ resource, mode = 'strip' }) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') return next();

    if (mode === 'reject') {
      const { changed } = inspectImmutableFields(req.body, req.record, resource);
      if (changed.length) {
        return sendError(res, 422, `Immutable field(s) cannot be modified: ${changed.join(', ')}`, {
          code: 'IMMUTABLE_FIELD',
          fields: changed,
        });
      }
    }

    const removed = stripImmutableFields(req.body, resource);
    if (removed.length) req.strippedImmutableFields = removed;
    next();
  };
}

module.exports = {
  inspectImmutableFields,
  stripImmutableFields,
  assertNoImmutableFieldChange,
  protectImmutableFields,
};
