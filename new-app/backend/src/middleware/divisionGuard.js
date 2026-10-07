'use strict';

/**
 * Division entitlement guard.
 *
 * Validates that a request's division parameter matches the company's
 * purchased divisions (from subscription or company.divisions fallback).
 *
 * Must run AFTER authMiddleware. Uses deps.subscriptionRepo if available,
 * otherwise falls back to deps.companyRepo.findById().divisions.
 */

/**
 * Returns the effective purchased divisions for a company.
 * Checks Subscription first; falls back to Company.divisions.
 */
async function getEffectiveDivisions(companyId, deps) {
  if (deps.subscriptionRepo) {
    const sub = await deps.subscriptionRepo.findByCompany(companyId);
    if (sub && sub.status !== 'cancelled' && sub.status !== 'expired') {
      return sub.purchasedDivisions || [];
    }
  }
  // Fallback to company.divisions
  const company = await deps.companyRepo.findById(companyId);
  return (company && company.divisions) || [];
}

/**
 * Middleware factory: rejects requests where the division in body/query/params
 * is not in the company's purchased divisions.
 */
function createDivisionGuard(deps) {
  return async function divisionGuard(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required.' });
    if (req.auth.role === 'super') return next(); // super can access all

    const division =
      (req.body && req.body.division) ||
      (req.query && req.query.division) ||
      (req.params && req.params.division);

    if (!division) return next(); // no division specified, let the route handle it

    const companyId = req.auth.companyId;
    if (!companyId) return res.status(403).json({ error: 'No company context.' });

    try {
      const purchased = await getEffectiveDivisions(companyId, deps);
      if (!purchased.includes(division)) {
        return res.status(403).json({
          error: `Division "${division}" is not available for this company. Purchased: [${purchased.join(', ')}].`,
          code: 'DIVISION_NOT_ENTITLED',
        });
      }
      // Attach effective divisions to request for downstream use
      req.effectiveDivisions = purchased;
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { createDivisionGuard, getEffectiveDivisions };
