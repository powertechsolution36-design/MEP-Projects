// GET /api/v3/health — no auth required (STEP 19). Reports enough for an operator/monitor to see
// the service is up and whether its DB connection is healthy, without ever exposing the connection
// string, credentials, or any other secret.
const { env } = require('../config/env');
const { getConnectionState } = require('../db/connection');
const pkg = require('../../package.json');

function getHealth(req, res) {
  const dbState = getConnectionState();
  res.json({
    status: dbState === 'connected' || dbState === 'uninitialized' ? 'ok' : 'degraded',
    service: pkg.name,
    version: pkg.version,
    environment: env.NODE_ENV,
    time: new Date().toISOString(),
    database: { state: dbState },
  });
}

module.exports = { getHealth };
