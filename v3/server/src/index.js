// V3 API entry point — Phase 0/1/2/4 foundation only (BUILD_BASELINE.md STEP 17/19 scope).
// Runs as its own PM2 process on its own port; never imports v2 route/model files; uses its own
// isolated Mongoose connection (db/connection.js). Socket.IO is attached here (not in app.js) since
// it needs the raw http.Server, which tests never need to spin up.
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');

const { env, validateEnv } = require('./config/env');
const { connectV3DB, disconnectV3DB } = require('./db/connection');
const { app } = require('./app/app');
const { logger } = require('./utils/logger');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CORS_ORIGIN, methods: ['GET', 'POST'], credentials: true },
});

let shuttingDown = false;

async function start() {
  try {
    validateEnv(); // fail loudly before ever opening a socket or a DB connection
    await connectV3DB();
    server.listen(env.PORT, () => {
      logger.info('server_started', { port: env.PORT, env: env.NODE_ENV });
    });
  } catch (err) {
    logger.error('startup_failed', { message: err.message });
    process.exit(1);
  }
}

// Graceful shutdown — stop accepting new connections, close the DB connection cleanly, then exit.
// Exported (rather than only wired to process signals) so tests can call it directly against a
// mocked server/DB without actually spawning a process.
async function gracefulShutdown(signal, { serverRef = server, exit = process.exit } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });
  try {
    await new Promise((resolve, reject) => {
      serverRef.close((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error('shutdown_server_close_error', { message: err.message });
  }
  try {
    await disconnectV3DB();
  } catch (err) {
    logger.error('shutdown_db_close_error', { message: err.message });
  }
  logger.info('shutdown_complete');
  exit(0);
}

if (require.main === module) start();

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { message: reason?.message || String(reason) }));
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { message: err.message });
  // An uncaught exception means the process is in an unknown state — attempt a graceful shutdown,
  // but do not loop forever trying if shutdown itself is what's failing.
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});

module.exports = { app, server, io, start, gracefulShutdown };
