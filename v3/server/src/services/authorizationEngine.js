// Centralized authorization engine — can()/authorize()/requirePermission(). Composes the existing
// decision functions (permission/tenant/entitlement/division/department/project/package/ownership/
// record-state) into ONE reusable evaluation so feature-module controllers never scatter their own
// role checks (`if (user.role === 'admin')`) — they call can()/authorize() instead.
//
// This does NOT replace middleware/chain.js's buildProtectedRoute() (route-level middleware chain,
// STEP 13 order) — it is the same decision logic exposed as a plain function for use inside a
// controller/service when a route-level middleware slot is not the right shape (e.g. checking a
// second, related resource inline, or a business-rule branch that needs a permission decision
// without a full Express middleware).
const { hasPermission } = require('./permissionService');
const { checkOwnership } = require('../middleware/ownership');
const { checkDivision } = require('../middleware/division');
const { checkDepartment } = require('../middleware/department');
const { checkProjectScope, checkPackageScope } = require('../middleware/projectScope');
const { isStateEditable } = require('../middleware/recordState');
const { sendError } = require('../utils/ApiError');

/**
 * can(user, permission, context) — read-only YES/NO check, never throws, never writes audit.
 * context may include any of: { record, division, department, project, pkg, entitlements,
 *   overridePermissionCode, action, supportOp, supportReason }
 * @returns {boolean}
 */
function can(user, permission, context = {}) {
  return authorize(user, permission, context).allowed;
}

/**
 * authorize(user, permission, context) — full decision with reason, composing every applicable
 * layer in the frozen STEP 13 order. A layer is skipped when its context input is absent (e.g. no
 * `context.division` -> division layer not evaluated) — "not every resource needs every layer,
 * but the system must support all of them."
 * @returns {{allowed:boolean, reason?:string, requiresCorrection?:boolean, supportOp?:boolean}}
 */
function authorize(user, permission, context = {}) {
  if (!user) return { allowed: false, reason: 'Auth required' };

  // Tenant scope — cross-company is denied outright for anyone but super (business-record edit
  // crossing companies is handled separately by ownership's Support-Op path).
  if (context.record && user.role !== 'super') {
    if (String(context.record.co) !== String(user.co)) {
      return { allowed: false, reason: 'Cross-company access denied' };
    }
  }

  // Entitlement
  if (context.entitlements && (context.division || context.entitlementModule)) {
    const ent = context.entitlements;
    if (ent.enforceEntitlements !== false) {
      if (context.division && ent.divisions !== '*' && Array.isArray(ent.divisions) && !ent.divisions.includes(context.division)) {
        return { allowed: false, reason: `Company not entitled to division: ${context.division}` };
      }
      if (context.entitlementModule && ent.modules !== '*' && Array.isArray(ent.modules) && !ent.modules.includes(context.entitlementModule)) {
        return { allowed: false, reason: `Module not entitled: ${context.entitlementModule}` };
      }
    }
  }

  // Permission
  if (permission && !hasPermission(user, permission)) {
    return { allowed: false, reason: `Missing permission: ${permission}` };
  }

  // Division
  if (context.division) {
    const div = checkDivision({ user, targetDivision: context.division, entitlements: context.entitlements });
    if (!div.allowed) return div;
  }

  // Department
  if (context.department) {
    const dep = checkDepartment({ user, targetDepartment: context.department, allowedDepartments: context.allowedDepartments });
    if (!dep.allowed) return dep;
  }

  // Project scope
  if (context.project) {
    const proj = checkProjectScope({ user, project: context.project, entitlements: context.entitlements });
    if (!proj.allowed) return proj;
  }

  // ProjectPackage scope
  if (context.pkg) {
    const pkg = checkPackageScope({ user, pkg: context.pkg, project: context.project, entitlements: context.entitlements });
    if (!pkg.allowed) return pkg;
  }

  // Ownership (creator-only edit/delete/correct). checkOwnership() expects `user.id` (its own
  // established shape — see middleware/ownership.js's requireOwnership wrapper), while callers of
  // authorize()/can() naturally pass a full user record keyed by `_id` — normalize here rather than
  // pushing this mapping onto every caller.
  let ownershipDecision;
  if (context.record && context.action && ['edit', 'delete', 'correct'].includes(context.action)) {
    ownershipDecision = checkOwnership({
      record: context.record,
      user: { id: user._id ?? user.id, co: user.co, role: user.role, permissions: user.permissions },
      action: context.action,
      overridePermissionCode: context.overridePermissionCode,
      supportOp: context.supportOp,
      supportReason: context.supportReason,
    });
    if (!ownershipDecision.allowed) return ownershipDecision;
  }

  // Record state (creator ownership never bypasses locking)
  if (context.record && context.record.status != null && context.checkState !== false) {
    if (!isStateEditable(context.record.status) && context.action !== 'correct') {
      return { allowed: false, reason: `Record is ${context.record.status} — locked, use correction/reversal` };
    }
  }

  return { allowed: true, ...(ownershipDecision || {}) };
}

/**
 * requirePermission(permission, contextResolver) — Express middleware built on top of authorize(),
 * for controllers that want the FULL composed decision (not just middleware/authorization.js's
 * bare permission-only check) behind one route-chain slot.
 * `contextResolver(req)` returns the `context` object passed to authorize(); may be async.
 */
function requirePermission(permission, contextResolver) {
  return async (req, res, next) => {
    try {
      const context = contextResolver
        ? await contextResolver(req)
        : { record: req.record, entitlements: req.entitlements };
      const decision = authorize(req.user, permission, context);
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.authorizationDecision = decision;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { can, authorize, requirePermission };
