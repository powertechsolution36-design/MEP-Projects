// requirePermission() and scopeFilterV3() — API_ARCHITECTURE.md §7. Thin Express wrappers around
// services/permissionService.js so the decision logic itself stays framework-free and testable.
const { hasPermission } = require('../services/permissionService');
const { ensurePermissionsLoaded } = require('./permissions');
const { sendError } = require('../utils/ApiError');

const ROLE_SUPER = 'super';

/**
 * PHASE 6.0: self-sufficient. It resolves the dynamic permission set itself if some earlier
 * middleware has not already done so, so that EVERY route using requirePermission() — including the
 * Phase 5 read routes that assemble their chain by hand rather than through buildProtectedRoute() —
 * gets dynamic RolePermission/UserPermissionOverride enforcement with no change to the route file.
 * ensurePermissionsLoaded() is idempotent, so the buildProtectedRoute() chain's own loadPermissions
 * step makes this a no-op rather than a second query.
 */
function requirePermission(code) {
  return async (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'Auth required');
    try {
      await ensurePermissionsLoaded(req);
    } catch (err) {
      return sendError(res, 500, err.message, { code: err.code || 'PERMISSION_RESOLUTION_FAILED' });
    }
    if (hasPermission(req.user, code)) return next();
    return sendError(res, 403, `Missing permission: ${code}`);
  };
}

// Pure function — no req/res — so it is directly unit-testable (see tests/authorization.test.js).
function scopeFilterV3(user, resource, extra = {}) {
  const filter = { ...extra };
  if (user.role !== ROLE_SUPER) filter.co = user.co;

  const DIVISIONAL_MANAGERS = ['solar_manager', 'mep_manager', 'hvac_manager'];
  if (DIVISIONAL_MANAGERS.includes(user.designation) && user.division) {
    filter.division = user.division;
  }

  if (['engineer', 'technician'].includes(user.designation)) {
    if (user.projectAccess && user.projectAccess.length) {
      filter._project_in = user.projectAccess;
    } else {
      filter.assignedTo = user._id;
    }
    if (user.division) filter.division = user.division;
  }

  if (['service_manager', 'inventory_manager'].includes(user.designation)) {
    const divisions = Array.isArray(user._entitledDivisions) ? user._entitledDivisions : [];
    filter._division_in = [...divisions, 'COMMON'];
  }

  return filter;
}

module.exports = { requirePermission, scopeFilterV3 };
