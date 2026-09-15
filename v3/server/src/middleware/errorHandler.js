// Centralized error handling (PHASE 1 STEP 16) — the only place in the app that formats an error
// response body. Every other middleware/controller should either throw/next() an ApiError, or let
// asyncHandler forward a rejected promise here.
const { ApiError } = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const { env } = require('../config/env');

// 404 handler — mounted after every route, before the error handler. Consistent shape with every
// other error response.
function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` } });
}

// Express recognizes this as an error-handling middleware purely by its 4-arg signature — do not
// drop the unused `next` param.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiError = err instanceof ApiError ? err : null;
  const status = apiError ? apiError.status : (err.status && Number.isInteger(err.status) ? err.status : 500);

  // Log server-side with full detail (message + stack) — but the stack, DB internals, and JWT
  // details never leave this function in the response body, in any environment.
  logger.error('request_error', {
    method: req.method,
    path: req.path,
    status,
    message: err.message,
    stack: env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  if (apiError) return res.status(status).json(apiError.toBody());

  // Unexpected (non-ApiError) failure — never leak the raw message in production, since it may
  // originate from a DB driver or another library and could contain connection/internal details.
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(status).json({ error: { code: 'INTERNAL_ERROR', message } });
}

module.exports = { notFound, errorHandler };
