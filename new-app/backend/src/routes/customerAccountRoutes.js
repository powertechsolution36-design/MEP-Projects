'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');
const {
  listCustomerAccounts, approveCustomerAccount, setCustomerAccountStatus,
  listProjectCandidates, setLinkedProjects,
} = require('../services/portalAuthService');
const { getAttachmentForStaff, listAttachmentsForStaff } = require('../services/portalService');

/**
 * The staff side of the customer portal (owner decision, 27 Oct 2026):
 * deciding who gets a login, and looking at the photographs a client sent.
 *
 * STAFF routes — the ordinary authentication and company guard. The
 * service layer additionally limits review to admin and service_mgr, so
 * the rule holds whatever is mounted here.
 */
function createCustomerAccountRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);
  router.use(authMiddleware, requireCompanyContext);

  /** Registrations awaiting a decision, and the accounts already decided. */
  router.get('/', async (req, res) => {
    try {
      const filters = {};
      if (req.query.status) filters.status = String(req.query.status);
      const accounts = await listCustomerAccounts(req.auth.companyId, filters, req.auth, deps);
      return res.json({ accounts });
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  /** Activate the login and bind it to one AMC / Warranty client. */
  router.post('/:accountId/approve', async (req, res) => {
    try {
      const account = await approveCustomerAccount(req.auth.companyId, req.params.accountId, req.body, req.auth, deps);
      return res.json({ account });
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  /** Refuse a registration, or switch off a login that was active. */
  router.post('/:accountId/status', async (req, res) => {
    try {
      const account = await setCustomerAccountStatus(
        req.auth.companyId, req.params.accountId, String(req.body && req.body.status), req.body, req.auth, deps
      );
      return res.json({ account });
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  /**
   * Which projects this client could be watching, likeliest first (owner
   * decision, 30 Oct 2026). A suggestion only — nothing is granted until
   * the PUT below is called.
   */
  router.get('/:accountId/project-candidates', async (req, res) => {
    try {
      const projects = await listProjectCandidates(req.auth.companyId, req.params.accountId, req.auth, deps);
      return res.json({ projects });
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  /** Replace the set of projects this client may watch. */
  router.put('/:accountId/projects', async (req, res) => {
    try {
      const result = await setLinkedProjects(
        req.auth.companyId, req.params.accountId, (req.body && req.body.projectIds) || [], req.auth, deps
      );
      return res.json(result);
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  return router;
}

/**
 * The photographs on a service call, for the people working it. Mounted
 * under the service-call routes' own authentication, so whoever may see the
 * call may see what the client attached to it.
 */
function createServiceCallAttachmentRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);
  router.use(authMiddleware, requireCompanyContext);

  router.get('/:serviceCallId/attachments', async (req, res) => {
    try {
      return res.json({ attachments: await listAttachmentsForStaff(req.auth.companyId, req.params.serviceCallId, deps) });
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  router.get('/attachments/:attachmentId', async (req, res) => {
    try {
      const file = await getAttachmentForStaff(req.auth.companyId, req.params.attachmentId, deps);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.send(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
    } catch (err) {
      return sendError(res, err, 'customerAccountRoutes');
    }
  });

  return router;
}

module.exports = { createCustomerAccountRouter, createServiceCallAttachmentRouter };
