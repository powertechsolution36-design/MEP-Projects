'use strict';

const { createApp } = require('./app');
const { connectToDatabase } = require('./db/connection');
const { getConfig } = require('./config/env');

/**
 * Runtime entry point — NOT executed by the test suite and not run during
 * this task's verification (no live database was used). Provided so the
 * foundation is actually startable once MONGODB_URI/AUTH_TOKEN_SECRET are
 * configured in the environment.
 */
async function start() {
  const config = getConfig();
  await connectToDatabase();
  const app = createApp(config);
  // FIX-3.3-03: start the hourly automatic delay-check job (see
  // src/jobs/delayCheckScheduler.js for the documented interpretive
  // choice of interval and its atomicity guarantees). Not started during
  // tests -- server.js's start() is not exercised by the test suite,
  // matching the existing "no live database used in tests" convention.
  app.startDelayCheckScheduler();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`New app backend listening on port ${config.port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = { start };
