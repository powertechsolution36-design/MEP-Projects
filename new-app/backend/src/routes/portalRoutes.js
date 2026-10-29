'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createPortalAuthMiddleware } = require('../middleware/portalAuthMiddleware');
const {
  registerCustomer, loginCustomer, logoutCustomer,
} = require('../services/portalAuthService');
const {
  getPortalProfile, listMyComplaints, getMyComplaint, createMyComplaint, getMyAttachment,
} = require('../services/portalService');

/**
 * The customer portal's own API (owner decision, 27 Oct 2026).
 *
 * Mounted at /api/portal. Three routes are reachable without a login —
 * register, login, and logout — and they are the only unauthenticated write
 * endpoints in the application; each is rate limited in portalAuthService.
 * Everything else requires a CLIENT session, which no staff token can
 * satisfy and which carries its own company and contract.
 *
 * There is no endpoint here that takes a company, contract, engineer or
 * customer identifier from the caller. There is nothing for a client to
 * tamper with.
 */
function createPortalRouter(deps) {
  const router = express.Router();
  const portalAuth = createPortalAuthMiddleware(deps);

  /** The caller's address, for rate limiting only. */
  const ipOf = (req) => String(req.ip || (req.connection && req.connection.remoteAddress) || 'unknown');

  /* ---------------- No login required ---------------- */

  router.post('/auth/register', async (req, res) => {
    try {
      return res.status(202).json(await registerCustomer(req.body, deps, { ip: ipOf(req) }));
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      return res.json(await loginCustomer(req.body, deps, { ip: ipOf(req) }));
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  /* ---------------- Client session required ---------------- */

  router.post('/auth/logout', portalAuth, async (req, res) => {
    try {
      return res.json(await logoutCustomer(req.portal.sessionId, deps));
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  router.get('/me', portalAuth, async (req, res) => {
    try {
      return res.json(await getPortalProfile(req.portal, deps));
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  router.get('/complaints', portalAuth, async (req, res) => {
    try {
      return res.json({ complaints: await listMyComplaints(req.portal, deps) });
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  router.post('/complaints', portalAuth, async (req, res) => {
    try {
      return res.status(201).json({ complaint: await createMyComplaint(req.portal, req.body, deps) });
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  router.get('/complaints/:id', portalAuth, async (req, res) => {
    try {
      return res.json({ complaint: await getMyComplaint(req.portal, req.params.id, deps) });
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  /**
   * One photograph. Authorized on its own: the attachment is traced back to
   * its service call and that call's contract must be the caller's.
   */
  router.get('/attachments/:id', portalAuth, async (req, res) => {
    try {
      const file = await getMyAttachment(req.portal, req.params.id, deps);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      // Nothing here is a document the browser should ever run.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.send(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
    } catch (err) {
      return sendError(res, err, 'portalRoutes');
    }
  });

  return router;
}

module.exports = { createPortalRouter };
