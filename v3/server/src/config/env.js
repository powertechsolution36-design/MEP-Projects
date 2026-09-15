// Central env loader for v3. Never falls back to a *different* JWT secret than v2's —
// if JWT_SECRET is unset in production, v3 must fail loudly rather than silently mint tokens
// v2 won't recognize (and vice versa). MONGO_URI must likewise be the SAME database v2 uses.
require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 4002,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mep_projects',
  JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('[v3/env] JWT_SECRET must be set in production and must match v2 exactly'); })()
    : 'dev-secret-change-me'),
  JWT_EXPIRES: process.env.JWT_EXPIRES || '30d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  ENFORCE_ENTITLEMENTS_DEFAULT: process.env.ENFORCE_ENTITLEMENTS_DEFAULT === 'true',
};

const VALID_NODE_ENVS = ['development', 'test', 'staging', 'production'];

// PHASE 1 STEP: "environment validation". Fails loudly and *specifically* (which variable, what's
// wrong with it) but NEVER prints the actual value of anything secret-shaped — only variable names
// and, where useful, non-sensitive shape info (PORT's numeric-ness is fine to mention; MONGO_URI's
// and JWT_SECRET's actual values are never included).
function validateEnv(target = env) {
  const problems = [];

  if (!VALID_NODE_ENVS.includes(target.NODE_ENV)) {
    problems.push(`NODE_ENV must be one of ${VALID_NODE_ENVS.join('/')} (got "${target.NODE_ENV}")`);
  }
  if (!Number.isInteger(target.PORT) || target.PORT <= 0 || target.PORT > 65535) {
    problems.push('PORT must be a valid integer port number');
  }
  if (!target.MONGO_URI || typeof target.MONGO_URI !== 'string' || !/^mongodb(\+srv)?:\/\//.test(target.MONGO_URI)) {
    problems.push('MONGO_URI is missing or not a valid mongodb:// / mongodb+srv:// connection string');
  }
  if (!target.JWT_SECRET || typeof target.JWT_SECRET !== 'string' || target.JWT_SECRET.length < 8) {
    problems.push('JWT_SECRET is missing or too short');
  }
  if (target.NODE_ENV === 'production' && target.JWT_SECRET === 'dev-secret-change-me') {
    problems.push('JWT_SECRET must not be the development default in production');
  }
  if (!target.JWT_EXPIRES) {
    problems.push('JWT_EXPIRES is missing');
  }
  if (!target.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN is missing');
  }
  if (target.NODE_ENV === 'production' && target.CORS_ORIGIN === '*') {
    problems.push('CORS_ORIGIN must not be "*" in production');
  }

  if (problems.length) {
    throw new Error(`[v3/env] invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return true;
}

module.exports = { env, validateEnv, VALID_NODE_ENVS };
