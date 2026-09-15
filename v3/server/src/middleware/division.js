// requireDivision() — division authorization. STEP 13 pipeline position: after Permission, before
// Department. SOLAR/MEP/HVAC only (config/constants.js DIVISION_VALUES) — never UI-selected as the
// authorization itself: the division checked here is always the user's resolved division
// (req.user.division, from services/roleResolver.js) and/or the company's actual entitlement
// (req.entitlements.divisions), never a client-supplied query/body field. MEP and HVAC are never
// merged — a MEP-scoped user is denied HVAC-division resources and vice versa.
//
// Split into a pure decision function (checkDivision) and a thin Express wrapper (requireDivision),
// matching the established pattern in middleware/ownership.js and middleware/recordState.js.
const { DIVISION_VALUES } = require('../config/constants');
const { sendError } = require('../utils/ApiError');

/**
 * @param {Object} args
 * @param {{role:string, division?:string}} args.user
 * @param {string} args.targetDivision - the division the resource actually belongs to (server-resolved, never client input)
 * @param {{divisions?:string[]|'*', enforceEntitlements?:boolean}} [args.entitlements]
 * @returns {{allowed:boolean, reason?:string}}
 */
function checkDivision({ user, targetDivision, entitlements }) {
  if (!user) return { allowed: false, reason: 'Auth required' };
  if (user.role === 'super') return { allowed: true };

  if (!targetDivision) return { allowed: false, reason: 'Resource has no division — division check misconfigured' };
  if (!DIVISION_VALUES.includes(targetDivision)) {
    return { allowed: false, reason: `Unknown division: ${targetDivision}` };
  }

  // Entitlement gate — a company must actually be entitled to the division, independent of whether
  // the requesting user's own division matches (STEP 13: Entitlement runs before Division, but a
  // division-scoped middleware re-checks here too since it can be used standalone).
  if (entitlements && entitlements.enforceEntitlements !== false) {
    const entDivisions = entitlements.divisions;
    if (entDivisions !== '*' && Array.isArray(entDivisions) && !entDivisions.includes(targetDivision)) {
      return { allowed: false, reason: `Company not entitled to division: ${targetDivision}` };
    }
  }

  // company_admin is company-wide, not division-scoped — allowed across all entitled divisions.
  if (user.designation === 'company_admin') return { allowed: true };

  if (!user.division) {
    return { allowed: false, reason: 'User has no division assigned — cannot access division-scoped resource' };
  }
  if (user.division !== targetDivision) {
    return { allowed: false, reason: `Cross-division access denied (user: ${user.division}, resource: ${targetDivision})` };
  }
  return { allowed: true };
}

/**
 * `resolveTargetDivision(req)` returns the division the resource belongs to — must be computed
 * server-side (from the loaded record, or a route-fixed constant), never trusted from
 * req.body/req.query/req.params.
 */
function requireDivision(resolveTargetDivision) {
  return async (req, res, next) => {
    try {
      const targetDivision = typeof resolveTargetDivision === 'function'
        ? await resolveTargetDivision(req)
        : resolveTargetDivision;
      const decision = checkDivision({ user: req.user, targetDivision, entitlements: req.entitlements });
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.targetDivision = targetDivision;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { checkDivision, requireDivision };
