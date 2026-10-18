'use strict';

const mongoose = require('mongoose');
const { getConfig } = require('../config/env');

/**
 * MongoDB connection module for the NEW application only.
 *
 * - Reads MONGODB_URI from the environment. Never hard-codes credentials.
 * - Never connects to a v2 or v3 database — this module has no knowledge of
 *   those systems' connection strings, models, or collections at all.
 * - Does not run migrations, does not seed data, does not touch a production
 *   database — this is schema/connection plumbing only.
 */

let connectionPromise = null;

// Databases that belong to other applications on the same server. The new app
// must never read or write them, whatever MONGODB_URI / MONGODB_DB_NAME say.
const FORBIDDEN_DATABASES = ['mep_projects', 'employee-management', 'employee_management', 'glampower'];

function assertAllowedDatabaseName(dbName) {
  const name = String(dbName || '').trim();
  if (!name) throw new Error('No database name configured (MONGODB_DB_NAME). Refusing to connect.');
  if (FORBIDDEN_DATABASES.includes(name.toLowerCase())) {
    throw new Error(`Database "${name}" belongs to another application. The new app may only use its own database (default mep_new_app). Refusing to connect.`);
  }
  return name;
}

async function connectToDatabase(overrideUri) {
  const { mongoUri, dbName } = getConfig();
  const uri = overrideUri || mongoUri;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Configure it in your environment (see .env.example). ' +
        'Refusing to connect without an explicit connection string.'
    );
  }

  assertAllowedDatabaseName(dbName);

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      dbName,
    });
  }

  await connectionPromise;
  return mongoose.connection;
}

async function disconnectFromDatabase() {
  connectionPromise = null;
  await mongoose.disconnect();
}

module.exports = {
  mongoose,
  assertAllowedDatabaseName,
  FORBIDDEN_DATABASES,
  connectToDatabase,
  disconnectFromDatabase,
};
