// Safe structured logging (PHASE 1 STEP 18). Deliberately dependency-free: a small, redacting
// wrapper around console.* rather than pulling in winston/pino for a foundation this thin — swap
// the transport later without touching call sites, since everything goes through info/warn/error/debug.
const { env } = require('../config/env');

// Matches key names that must never appear with their real value in a log line, wherever they show
// up in a nested object (headers, req.body, query, env dumps, error messages a caller passed as
// `meta`). Intentionally broad — STEP 18 explicitly lists authorization/JWT/password/secret/
// MONGO_URI credentials, and STEP 12/22 add token/creditcard/cardnumber for the same reason
// services/auditService.js redacts them.
const REDACT_KEY_PATTERN = /pass(word)?|pw|token|secret|jwt|authorization|creditcard|cardnumber|mongo_?uri/i;

function redactValue(key, value) {
  if (REDACT_KEY_PATTERN.test(key)) return '[REDACTED]';
  return value;
}

// Deep-redacts an object for logging. Bounded depth so a pathological circular/huge object can't
// hang the process — foundation-level logging should never need more than a couple of levels.
function redact(input, depth = 4) {
  if (input === null || typeof input !== 'object' || depth <= 0) return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, depth - 1));
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && typeof value === 'object') {
      out[key] = REDACT_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(value, depth - 1);
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
}

function write(level, message, meta) {
  // Keep `npm test` output readable — routine info/debug noise (e.g. the per-request access log)
  // is suppressed in the test env; warnings and errors still surface, since a test asserting on
  // error-path behavior should be able to see them if needed.
  if (env.NODE_ENV === 'test' && level !== 'error' && level !== 'warn') return;

  const entry = { time: new Date().toISOString(), level, service: 'mep-projects-v3-api', message };
  if (meta !== undefined) entry.meta = redact(meta);

  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
    // One JSON object per line — safe to ship to any log aggregator without further parsing.
    (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(entry));
  } else {
    const suffix = meta !== undefined ? ' ' + JSON.stringify(entry.meta) : '';
    (level === 'error' || level === 'warn' ? console.error : console.log)(
      `[v3][${entry.time}][${level.toUpperCase()}] ${message}${suffix}`
    );
  }
}

const logger = {
  debug: (message, meta) => { if (env.NODE_ENV !== 'production') write('debug', message, meta); },
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

// Request logging middleware — logs method/path/status/duration and the authenticated userId when
// available (auth() runs before this in practice only on protected routes; on public routes
// req.authContext is simply absent). Never logs headers, query, or body — those can carry
// Authorization/JWT/passwords, and STEP 18 says not to log request bodies indiscriminately.
function requestLogger() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.authContext?.userId,
      });
    });
    next();
  };
}

module.exports = { logger, redact, requestLogger };
