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

async function connectToDatabase(overrideUri) {
  const { mongoUri, dbName } = getConfig();
  const uri = overrideUri || mongoUri;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Configure it in your environment (see .env.example). ' +
        'Refusing to connect without an explicit connection string.'
    );
  }

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
  connectToDatabase,
  disconnectFromDatabase,
};
