'use strict';

const express = require('express');
const { sendError } = require('../errors');
const { createCompanyWithAdmin, deleteCompany, updateMyCompanyProfile, updateCompany, getPlatformUsage } = require('../services/companyService');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { requireCompanyContext } = require('../middleware/tenantGuard');

/**
 * Company administration API — super-only.
 *
 * PWA FACT (`vCompanies`): super role manages all companies.
 *   POST   /api/companies                create company + admin user
 *   GET    /api/companies                list all companies (super only)
 *   GET    /api/companies/:id            single company detail (super only)
 *   PATCH  /api/companies/:id            update company fields (super only)
 *   POST   /api/companies/:id/status     set status: Active/Suspended/Trial (super only)
 *   DELETE /api/companies/:id            delete company + cascade 8 collections (super only)
 *
 * Stage 7 Company Profile (own company only, company id from the session):
 *   GET    /api/companies/my-profile     read own company profile (any company user)
 *   PATCH  /api/companies/my-profile     edit own branding fields (company admin only)
 */
function createCompanyRouter(deps) {
  const router = express.Router();
  const authMiddleware = createAuthMiddleware(deps);

  router.post('/', authMiddleware, requireRole('super'), async (req, res) => {
    const { company, admin } = req.body || {};
    try {
      const result = await createCompanyWithAdmin({ company, admin }, deps);
      return res.status(201).json(result);
    } catch (err) {
      if (!err.status) err.status = 400;
      return sendError(res, err, 'companyRoutes');
    }
  });

  // ── Company Profile (Stage 7) ──
  // The caller's OWN company only — the company id always comes from the
  // authenticated session (req.auth.companyId), never from the request, so a
  // user can never read or edit another tenant's profile. Declared before
  // '/:id' so 'my-profile' is not captured as a company id by the
  // super-only routes below.
  //   GET   /api/companies/my-profile   any authenticated company user
  //         (quotation/AMC print views need the tenant's branding)
  //   PATCH /api/companies/my-profile   company admin only
  router.get('/my-profile', authMiddleware, requireCompanyContext, async (req, res) => {
    try {
      if (!req.auth.companyId) {
        return res.status(400).json({ error: 'This account has no company profile.' });
      }
      const company = await deps.companyRepo.findById(req.auth.companyId);
      if (!company) return res.status(404).json({ error: 'Company not found.' });
      return res.status(200).json({ company });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  router.patch('/my-profile', authMiddleware, requireCompanyContext, requireRole('admin'), async (req, res) => {
    try {
      const updated = await updateMyCompanyProfile(req.auth.companyId, req.body || {}, deps);
      return res.status(200).json({ company: updated });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  /* PWA FACT: coStats() for superDash / vUsage / vCompanies (super only).
     Declared before '/:id'. */
  router.get('/platform/usage', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const usage = await getPlatformUsage(deps);
      return res.status(200).json({ usage });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  /* PWA FACT: vCompanies — list all companies */
  router.get('/', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const companies = await deps.companyRepo.listAll();
      return res.status(200).json({ companies });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  /* PWA FACT: company detail for edit modal prefill */
  router.get('/:id', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const company = await deps.companyRepo.findById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Company not found.' });
      // PWA FACT: mCompany(id) prefills the company admin's Login ID
      // (index.html:1693, 1717). The password is never returned — the new
      // app stores only a hash, so the edit form leaves it blank = unchanged.
      const users = deps.userWriteRepo && deps.userWriteRepo.listByCompany
        ? await deps.userWriteRepo.listByCompany(req.params.id) : [];
      const admin = users.find((u) => u.role === 'admin');
      return res.status(200).json({ company, adminUsername: admin ? admin.username : '' });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  /* PWA FACT: saveCompany — update company fields */
  router.patch('/:id', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const company = await updateCompany(req.params.id, req.body || {}, deps);
      return res.status(200).json({ company });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  /* PWA FACT: setCoStatus(id,s) — suspend/activate/trial */
  router.post('/:id/status', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const company = await deps.companyRepo.findById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Company not found.' });
      const { status } = req.body || {};
      if (!['Active', 'Suspended', 'Trial'].includes(status)) {
        return res.status(400).json({ error: 'Status must be Active, Suspended, or Trial.' });
      }
      const updated = await deps.companyRepo.updateFields(req.params.id, { status });
      return res.status(200).json({ company: updated });
    } catch (err) {
      return sendError(res, err, 'companyRoutes');
    }
  });

  // FIX-6-03 (B2 -- Company deletion/cascade).
  router.delete('/:id', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const result = await deleteCompany(req.params.id, req.auth, deps);
      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 400;
      return res.status(status).json({ error: err.message, code: err.code });
    }
  });

  return router;
}

module.exports = { createCompanyRouter };
