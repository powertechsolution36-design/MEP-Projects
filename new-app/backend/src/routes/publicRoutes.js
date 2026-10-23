'use strict';

const express = require('express');
const service = require('../services/serviceCallService');
const quotationService = require('../services/quotationService');
const amcDocumentService = require('../services/amcDocumentService');
const { ServiceError } = require('../errors');

/**
 * Public (no-login) routes.
 *
 *   GET /api/public/service-reports/:token   the client's Service Report PDF
 *   GET /api/public/quotations/:token        the customer's Quotation PDF
 *   GET /api/public/amc-letters/:token       the client's AMC Letter PDF (paid AMCs only)
 *
 * Owner decision (21 Oct 2026): the completed service report is sent to the
 * client on WhatsApp as a link. The 48-hex-character token is generated at
 * completion with crypto.randomBytes(24) and is the only key; nothing else
 * about the call or the company is reachable from here.
 */
function createPublicRouter(deps) {
  const router = express.Router();

  router.get('/service-reports/:token', async (req, res) => {
    try {
      const { filename, pdf } = await service.renderPublicServiceReport(req.params.token, deps);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      });
      return res.status(200).send(pdf);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.status).type('text/plain').send(err.status === 404 ? 'Service report not found.' : err.message);
      }
      // eslint-disable-next-line no-console
      console.error('[publicRoutes]', err);
      return res.status(500).type('text/plain').send('Could not create the service report.');
    }
  });

  router.get('/quotations/:token', async (req, res) => {
    try {
      const { filename, pdf } = await quotationService.renderPublicQuotation(req.params.token, deps);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      });
      return res.status(200).send(pdf);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.status).type('text/plain').send(err.status === 404 ? 'Quotation not found.' : err.message);
      }
      // eslint-disable-next-line no-console
      console.error('[publicRoutes]', err);
      return res.status(500).type('text/plain').send('Could not create the quotation PDF.');
    }
  });

  router.get('/amc-letters/:token', async (req, res) => {
    try {
      const { filename, pdf } = await amcDocumentService.renderPublicAmcLetter(req.params.token, deps);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      });
      return res.status(200).send(pdf);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.status).type('text/plain').send(err.status === 404 ? 'AMC letter not found.' : err.message);
      }
      // eslint-disable-next-line no-console
      console.error('[publicRoutes]', err);
      return res.status(500).type('text/plain').send('Could not create the AMC letter.');
    }
  });

  return router;
}

module.exports = { createPublicRouter };
