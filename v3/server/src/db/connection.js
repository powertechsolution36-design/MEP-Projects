// Isolated Mongoose connection for v3 — the canonical location for this (BUILD_BASELINE.md STEP 3).
//
// COLLISION-RISK MITIGATION: v2 registers its models on the DEFAULT mongoose connection/registry
// (`mongoose.model('User', ...)` inside v2/server/src/models/User.js). If v3 called
// `mongoose.model(...)` on that same default connection, or `require()`'d a v2 model file directly,
// it would either collide (OverwriteModelError) or silently share v2's live model object — including
// its Mongoose-level validation, which v3 must not depend on. `mongoose.createConnection()` gives v3
// its own connection object with its own independent model registry, while still addressing the SAME
// physical MongoDB / same database (this is intentional and required — v3 reads/writes the same
// `users`/`companies`/etc. collections v2 uses, just through v3's own model definitions).
const mongoose = require('mongoose');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

let connection = null;

// mongoose connection.readyState -> human string. Used by the health endpoint and logging — never
// the connection string itself.
const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized' };

function redactUri(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
}

async function connectV3DB() {
  if (connection && connection.readyState === 1) return connection;

  connection = mongoose.createConnection(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });

  // Ongoing state logging (not just the initial connect) — never logs the URI/credentials, only
  // the event name, so an operator can see "v3 lost its DB connection" in production logs without
  // any secret ever appearing in them.
  connection.on('error', (err) => logger.error('db_connection_error', { message: err.message }));
  connection.on('disconnected', () => logger.warn('db_disconnected'));
  connection.on('reconnected', () => logger.info('db_reconnected'));

  await new Promise((resolve, reject) => {
    connection.once('open', resolve);
    connection.once('error', reject);
  });
  logger.info('db_connected', { uri: redactUri(env.MONGO_URI) });
  return connection;
}

function getV3Connection() {
  if (!connection) throw new Error('[v3/db] connectV3DB() must be called before getV3Connection()');
  return connection;
}

function isConnected() {
  return !!connection && connection.readyState === 1;
}

// Used by the health endpoint (STEP 19) — a string, never the connection object or URI.
function getConnectionState() {
  if (!connection) return READY_STATES[99];
  return READY_STATES[connection.readyState] || 'unknown';
}

async function disconnectV3DB() {
  if (connection) {
    await connection.close();
    connection = null;
    logger.info('db_disconnected_clean');
  }
}

module.exports = { connectV3DB, getV3Connection, isConnected, getConnectionState, disconnectV3DB };
