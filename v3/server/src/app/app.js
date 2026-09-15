// Express app factory — deliberately separate from src/index.js's bootstrap (DB connect + listen),
// so tests can import a fully-wired `app` without ever opening a socket or a DB connection.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { env } = require('../config/env');
const { requestLogger } = require('../utils/logger');
const { notFound, errorHandler } = require('../middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger()); // never logs headers/body — see utils/logger.js

  app.use('/api/v3', require('../routes'));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, app: createApp() };
