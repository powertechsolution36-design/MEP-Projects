// Central error type for the V3 API — every handler/middleware that wants a specific HTTP status
// throws (or passes to next()) an ApiError instead of hand-rolling res.status().json(...). This is
// what lets middleware/errorHandler.js produce one consistent JSON shape for the whole API
// (PHASE 1 STEP 16): { error: { code, message, details? } }.
//
// Status <-> default code map — do not rename these codes without updating any client relying on them.
const STATUS_CODES = Object.freeze({
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  500: 'INTERNAL_ERROR',
});

class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.isApiError = true;
    this.status = status || 500;
    this.code = code || STATUS_CODES[this.status] || 'ERROR';
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) { return new ApiError(400, message, { details }); }
  static unauthorized(message = 'Unauthorized', details) { return new ApiError(401, message, { details }); }
  static forbidden(message = 'Forbidden', details) { return new ApiError(403, message, { details }); }
  static notFound(message = 'Not found', details) { return new ApiError(404, message, { details }); }
  static conflict(message = 'Conflict', details) { return new ApiError(409, message, { details }); }
  static validation(message = 'Validation failed', details) { return new ApiError(422, message, { details }); }
  static internal(message = 'Internal server error', details) { return new ApiError(500, message, { details }); }

  // Body shape returned to the client — never includes a stack trace or anything beyond
  // code/message/details. errorHandler.js is the only place that also decides whether to log more.
  toBody() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

// For call sites that are not (yet) using next(err) / asyncHandler — e.g. plain middleware that
// still wants the same consistent JSON shape without throwing. Prefer ApiError + next(err) in new
// code; this helper exists so existing middleware can be normalized without a rewrite.
function sendError(res, status, message, { code, details } = {}) {
  const err = new ApiError(status, message, { code, details });
  return res.status(status).json(err.toBody());
}

module.exports = { ApiError, sendError, STATUS_CODES };
