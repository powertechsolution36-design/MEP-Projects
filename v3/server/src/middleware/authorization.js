// requirePermission() and scopeFilterV3() — API_ARCHITECTURE.md §7. Thin Express wrappers around
// services/permissionService.js so the decision logic itself stays framework-free and testable.
const { hasPermission } = require('../services/permissionService');
const { sendError } = require('../utils/ApiError');

const ROLE_SUPER = 'super';

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'Auth required');
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
