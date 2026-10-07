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

module.exports = { ServiceError, wrapDuplicateKeyError };
