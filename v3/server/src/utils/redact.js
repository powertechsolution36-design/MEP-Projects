// Canonical sensitive-data redaction for everything that PERSISTS a payload snapshot — AuditLog
// before/after, RecordCorrection oldValue/newValue, and any future history collection.
//
// V3 PHASE 4 spec §19: the audit/correction layer must never persist password, pw, JWT, token,
// secret, authorization header, credit card data, or database credentials — at any nesting depth.
// API_ARCHITECTURE.md §9 states the same rule for AuditLog ("Never store: passwords, tokens, JWT,
// secrets, credit cards").
//
// Deliberately separate from utils/logger.js's redact(): that one protects LOG LINES and is tuned
// for console output; this one protects DATABASE WRITES, preserves BSON-ish values (Date, ObjectId,
// Buffer) that a before/after snapshot must keep intact, and is circular-safe because an audit
// snapshot is frequently a hydrated Mongoose document graph rather than a plain literal.
const REDACTED = '[REDACTED]';

// Keys normalized to lowercase alphanumerics before matching, so `DB_PASSWORD`, `credit-card`,
// `card number` and `mongoUri` all collapse onto the same patterns.
const SENSITIVE_SUBSTRINGS = [
  'password', 'passwd', 'passphrase',
  'secret', 'token', 'jwt', 'bearer',
  'authorization', 'credential',
  'apikey', 'privatekey', 'accesskey', 'sessionid', 'cookie',
  'creditcard', 'cardnumber', 'cardnum', 'cvv', 'cvc',
  'connectionstring', 'mongouri', 'mongourl', 'dburi', 'dburl', 'databaseurl', 'databaseuri',
];

// Short keys that must match EXACTLY — never as a substring, so `pw` does not redact `pwaEnabled`
// and `auth` does not redact `authorId`.
const SENSITIVE_EXACT = new Set(['pw', 'pwd', 'pass', 'auth', 'otp', 'pin']);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when a field with this key must never have its real value persisted. */
function isSensitiveKey(key) {
  const k = normalizeKey(key);
  if (!k) return false;
  if (SENSITIVE_EXACT.has(k)) return true;
  return SENSITIVE_SUBSTRINGS.some((pattern) => k.includes(pattern));
}

// Values that must survive a snapshot unchanged rather than being walked as plain objects — a
// Date walked with Object.entries() collapses to `{}`, silently corrupting an audit before/after.
function isAtomicValue(value) {
  return (
    value instanceof Date
    || value instanceof RegExp
    || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
    || typeof value?.toHexString === 'function'   // Mongoose/BSON ObjectId
  );
}

/**
 * Deep-redacts a value for persistence. Sensitive keys keep their key (so the audit still shows
 * THAT a field was present/changed) but never their value.
 *
 * @param {*} input
 * @param {{depth?:number}} [options] maximum nesting depth to walk (default 8)
 */
function redact(input, options = {}) {
  const maxDepth = options.depth ?? 8;
  const seen = new WeakSet();

  function walk(value, depth) {
    if (value === null || value === undefined) return value;
    if (isAtomicValue(value)) return value;
    if (typeof value !== 'object') return value;
    if (depth >= maxDepth) return value;
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    // A hydrated Mongoose document snapshots as its plain object form.
    const source = typeof value.toObject === 'function' ? value.toObject() : value;

    if (Array.isArray(source)) return source.map((entry) => walk(entry, depth + 1));

    const out = {};
    for (const [key, entry] of Object.entries(source)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(entry, depth + 1);
    }
    return out;
  }

  return walk(input, 0);
}

/**
 * Test/verification helper — returns the dotted paths of any value that still looks like a secret
 * after redaction. Used by the Phase 4 redaction tests to assert nothing leaks at any depth.
 */
function findSensitivePaths(input, prefix = '') {
  const found = [];
  if (input === null || typeof input !== 'object' || isAtomicValue(input)) return found;
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSensitiveKey(key) && value !== REDACTED) found.push(path);
    else if (value && typeof value === 'object') found.push(...findSensitivePaths(value, path));
  }
  return found;
}

module.exports = { redact, isSensitiveKey, findSensitivePaths, REDACTED, SENSITIVE_SUBSTRINGS, SENSITIVE_EXACT };
