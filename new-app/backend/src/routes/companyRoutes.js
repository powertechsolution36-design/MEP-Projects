'use strict';

const express = require('express');
const { createCompanyWithAdmin, deleteCompany } = require('../services/companyService');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

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
      return res.status(400).json({ error: err.message });
    }
  });

  /* PWA FACT: vCompanies — list all companies */
  router.get('/', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const companies = await deps.companyRepo.listAll();
      return res.status(200).json({ companies });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /* PWA FACT: company detail for edit modal prefill */
  router.get('/:id', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const company = await deps.companyRepo.findById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Company not found.' });
      return res.status(200).json({ company });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /* PWA FACT: saveCompany — update company fields */
  router.patch('/:id', authMiddleware, requireRole('super'), async (req, res) => {
    try {
      const company = await deps.companyRepo.findById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Company not found.' });
      const allowedFields = ['name', 'city', 'address', 'gst', 'divisions', 'contactPersons',
        'subscriptionPlan', 'subscriptionStart', 'subscriptionEnd', 'maxUsers'];
      const patch = {};
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) patch[f] = req.body[f];
      }
      const updated = await deps.companyRepo.updateFields(req.params.id, patch);
      return res.status(200).json({ company: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
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
      return res.status(500).json({ error: err.message });
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
