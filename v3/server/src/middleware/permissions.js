// Phase 6.0 — loadPermissions(): resolves the dynamic permission set ONCE per request and attaches
// it to req.user, so every downstream synchronous hasPermission() call (requirePermission,
// requireOwnership's override check, authorizationEngine, approvalService) sees the same answer
// without any of them re-querying or changing signature.
//
// Chain position: immediately after loadEntitlements() and before requirePermission() — i.e. it is a
// DATA-LOADING step in the same slot pattern as loadEntitlements, not a new gate. The frozen STEP 13
// gate order (auth -> company -> entitlement -> permission -> division -> department -> project/
// package -> ownership -> state -> validation) is untouched.
const { resolveEffectivePermissions } = require('../services/permissionResolutionService');
const { sendError } = require('../utils/ApiError');

// Super Admin never has a resolution computed for it: API_ARCHITECTURE.md §7's `if super → allow`
// is evaluated inside hasPermission() itself, which returns true before consulting any resolution.
// Marking the request explicitly (rather than leaving it undefined) keeps "we deliberately skipped
// resolution" distinguishable from "resolution never ran" when debugging.
const SUPER_SENTINEL = Object.freeze({ superAdmin: true, granted: [], revoked: [], sources: {} });

/**
 * ensurePermissionsLoaded — idempotent. Safe to call from several places in one request; the second
 * call is a no-op. Returns the resolution (or null when there is nothing to resolve).
 *
 * Throws only when the database IS connected but the assignment rows could not be read — an
 * unreadable revoke must never be silently downgraded to "no revoke".
 */
async function ensurePermissionsLoaded(req) {
  if (!req || !req.user) return null;
  if (req.user._permissionResolution !== undefined) return req.user._permissionResolution;

  if (req.user.role === 'super') {
    req.user._permissionResolution = SUPER_SENTINEL;
    return SUPER_SENTINEL;
  }

  // ALWAYS the authenticated company. req.tenantCompanyId is set by enforceTenantScope() from
  // req.user.co after every client-supplied company key has been stripped; falling back to
  // req.user.co (never to anything client-controlled) keeps this correct even on a route that has
  // not run enforceTenantScope.
  const companyId = req.user.co ?? req.tenantCompanyId;

  const resolution = await resolveEffectivePermissions({
    companyId,
    userId: req.user._id,
    designation: req.user.designation,
  });

  // `null` (no database connection in this process) is cached as null, so hasPermission() falls
  // through to the legacy compatibility layer exactly as in Phases 1-5.
  req.user._permissionResolution = resolution;
  return resolution;
}

/** Express middleware form. */
async function loadPermissions(req, res, next) {
  if (!req.user) return sendError(res, 401, 'Auth required');
  try {
    await ensurePermissionsLoaded(req);
    next();
  } catch (err) {
    return sendError(res, 500, err.message, { code: err.code || 'PERMISSION_RESOLUTION_FAILED' });
  }
}

module.exports = { loadPermissions, ensurePermissionsLoaded, SUPER_SENTINEL };
