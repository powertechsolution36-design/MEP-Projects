'use strict';

/**
 * Environment/configuration loader for the new application's backend.
 *
 * NEW BACKEND DESIGN — this module and its defaults are not derived from the
 * PWA (which has no server, config, or auth concept at all). It exists so the
 * MongoDB connection and the new authentication system are configured via
 * environment variables — never hard-coded credentials/secrets, and never
 * pointed at or reusing v2/v3 databases, tokens, or secrets.
 */

function getConfig(env = process.env) {
  const mongoUri = env.MONGODB_URI || '';
  const dbName = env.MONGODB_DB_NAME || 'mep_new_app';

  const authTokenSecret = env.AUTH_TOKEN_SECRET || '';
  const authTokenExpiry = env.AUTH_TOKEN_EXPIRY || '15m';
  const port = Number(env.PORT) || 4000;

  return {
    mongoUri,
    dbName,
    authTokenSecret,
    authTokenExpiry,
    port,
  };
}

module.exports = { getConfig };
