// requireDepartment() — department authorization. Kept deliberately SEPARATE from division
// (middleware/division.js): a Project Manager has department=PROJECTS with division=SOLAR/MEP/HVAC,
// while a Divisional Manager has department == division (e.g. department=HVAC, division=HVAC) — the
// two concepts overlap for some designations but are never the same check (ROLE_HIERARCHY.md §1-§4).
// Frozen department enum only: ADMIN/PROJECTS/SALES/SOLAR/MEP/HVAC/SERVICE/INVENTORY/FINANCE
// (config/constants.js DEPARTMENT_VALUES).
const { DEPARTMENT_VALUES } = require('../config/constants');
const { sendError } = require('../utils/ApiError');

/**
 * @param {Object} args
 * @param {{role:string, department?:string, designation?:string}} args.user
 * @param {string} args.targetDepartment - server-resolved, never client input
 * @param {string[]} [args.allowedDepartments] - optional whitelist of departments this route accepts
 *   in addition to an exact user-department match (e.g. a PROJECTS-department PM route also allowing
 *   ADMIN). Defaults to just an exact match.
 */
function checkDepartment({ user, targetDepartment, allowedDepartments }) {
  if (!user) return { allowed: false, reason: 'Auth required' };
  if (user.role === 'super') return { allowed: true };

  if (!targetDepartment) return { allowed: false, reason: 'Resource has no department — department check misconfigured' };
  if (!DEPARTMENT_VALUES.includes(targetDepartment)) {
    return { allowed: false, reason: `Unknown department: ${targetDepartment}` };
  }

  if (user.designation === 'company_admin') return { allowed: true };

  // Exact-match by default: user.department must equal the resource's targetDepartment. An
  // explicit `allowedDepartments` whitelist can widen this for a route that intentionally accepts
  // more than one department (e.g. a PROJECTS-department route also allowing ADMIN) — but the
  // whitelist only ever widens which departments a route accepts, it never substitutes for the
  // user actually being in one of them.
  const allowed = Array.isArray(allowedDepartments) && allowedDepartments.length
    ? allowedDepartments
    : [targetDepartment];

  if (!user.department || !allowed.includes(user.department)) {
    return { allowed: false, reason: `Wrong department (user: ${user.department || 'none'}, resource: ${targetDepartment})` };
  }
  return { allowed: true };
}

function requireDepartment(resolveTargetDepartment, opts = {}) {
  return async (req, res, next) => {
    try {
      const targetDepartment = typeof resolveTargetDepartment === 'function'
        ? await resolveTargetDepartment(req)
        : resolveTargetDepartment;
      const decision = checkDepartment({ user: req.user, targetDepartment, allowedDepartments: opts.allowedDepartments });
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.targetDepartment = targetDepartment;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { checkDepartment, requireDepartment };
