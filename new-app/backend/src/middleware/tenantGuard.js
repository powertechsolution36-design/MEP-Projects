'use strict';

/**
 * Tenant isolation guard. Every non-super authenticated business request
 * must have a company context, and that context must come ONLY from the
 * authenticated session (req.auth.companyId, set by authMiddleware) — never
 * from client-supplied request data. This directly blocks the "change
 * companyId in the request body/query to act as another company" attack.
 *
 * Must run AFTER authMiddleware.
 */
function requireCompanyContext(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.auth.role !== 'super' && !req.auth.companyId) {
    // Should not happen in practice (non-super users always have a
    // companyId), but fail closed rather than silently proceeding without
    // tenant scope.
    return res.status(403).json({ error: 'No company context for this account.' });
  }
  return next();
}

/**
 * Rejects a request that tries to supply its OWN companyId (body or query)
 * different from the authenticated session's companyId. A non-super user's
 * companyId is fixed by their session; they can never override it by
 * changing request data. `super` is exempt (it is the only role permitted to
 * operate across companies, in future Super Admin operations only).
 */
function rejectClientSuppliedCompanyId(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.auth.role === 'super') {
    return next();
  }
  const clientCompanyId = (req.body && req.body.companyId) || (req.query && req.query.companyId);
  if (clientCompanyId && String(clientCompanyId) !== String(req.auth.companyId)) {
    return res.status(403).json({ error: 'Cannot operate on a different company.' });
  }
  return next();
}

module.exports = { requireCompanyContext, rejectClientSuppliedCompanyId };
