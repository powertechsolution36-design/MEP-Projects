'use strict';

/**
 * Shared service-layer error type carrying an HTTP status and a machine
 * code, so routes can translate it consistently without string-matching
 * error messages. Used by src/services/enquiryService.js.
 */
class ServiceError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ServiceError';
    this.code = code || 'SERVICE_ERROR';
    this.status = status || 400;
  }
}

// FIX-6-02: translate a raw MongoDB E11000 duplicate-key error into the
// application's existing ServiceError shape. `friendlyMessage`/`code` let each
// call site describe the specific uniqueness constraint in domain terms; any
// other error is re-thrown unchanged so this never masks a real failure.
function wrapDuplicateKeyError(err, friendlyMessage, code) {
  if (err && (err.code === 11000 || err.code === 11001)) {
    throw new ServiceError(friendlyMessage, code || 'DUPLICATE', 409);
  }
  throw err;
}

/**
 * Translates persistence-layer errors that are really client errors into
 * the ServiceError shape, so a route never answers 500 for bad input:
 *   - Mongoose ValidationError (e.g. an enum value not in the list) -> 400
 *   - Mongoose CastError (e.g. a malformed id in the URL)            -> 404
 *   - MongoDB duplicate key (E11000)                                  -> 409
 * Returns null for anything else (a genuine server error).
 */
function mapPersistenceError(err) {
  if (!err) return null;
  if (err instanceof ServiceError) return err;
  if (err.name === 'ValidationError' && err.errors) {
    const first = Object.values(err.errors)[0];
    const detail = first && first.message ? first.message : 'Invalid data.';
    return new ServiceError(detail, 'VALIDATION_ERROR', 400);
  }
  if (err.name === 'CastError') {
    return new ServiceError('Record not found.', 'NOT_FOUND', 404);
  }
  if (err.code === 11000 || err.code === 11001) {
    return new ServiceError('A record with these details already exists.', 'DUPLICATE', 409);
  }
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
    return new ServiceError(err.message, err.code || 'REQUEST_ERROR', err.status);
  }
  return null;
}

/**
 * Sends a consistent JSON error: mapped client errors with their status,
 * anything else as a generic 500 (logged server-side, never echoed).
 */
function sendError(res, err, tag) {
  const mapped = mapPersistenceError(err);
  if (mapped) return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  // eslint-disable-next-line no-console
  console.error(`[${tag || 'api'}]`, err);
  return res.status(500).json({ error: 'Internal error.' });
}

module.exports = { ServiceError, wrapDuplicateKeyError, mapPersistenceError, sendError };
