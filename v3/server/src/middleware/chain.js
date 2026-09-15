// STEP 13 — Authorization order. Frozen sequence:
//   Authentication -> Tenant/Company Scope -> Entitlement -> Permission -> Division Scope ->
//   Department Scope -> Project/ProjectPackage Scope -> Ownership -> Record State/Approval State ->
//   Business Validation -> Handler
//
// Division/Department/Project scope and Business Validation are feature-module-specific and are NOT
// built in this foundation pass (STEP 19) — they plug into the `extraScopeMiddleware` /
// `businessValidation` slots below without changing this file, once those modules exist. What this
// file DOES enforce today, structurally (not just by convention), is that a lower layer can never
// run before a higher one: buildProtectedRoute() always returns middleware in the fixed order below,
// so a route file cannot accidentally reorder auth/tenant/entitlement/permission/ownership/state.
const { auth } = require('./auth');
const { enforceTenantScope, loadEntitlements, requireEntitlement } = require('./tenant');
const { requirePermission } = require('./authorization');
const { requireOwnership } = require('./ownership');
const { requireEditableState } = require('./recordState');

/**
 * @param {Object} opts
 * @param {string} opts.resource
 * @param {string} [opts.permission] - a PERMISSIONS constant or resource-scoped code
 * @param {{module?:string, division?:string}} [opts.entitlement]
 * @param {Function} [opts.loadRecord] - (req) => Promise<record|null> — required if ownership/state checks are used
 * @param {'edit'|'delete'|'correct'} [opts.ownershipAction]
 * @param {Function[]} [opts.extraScopeMiddleware] - division/department/project scope, once those modules exist
 * @param {Function[]} [opts.businessValidation] - resource-specific validation, run last before the handler
 * @returns {Function[]} an Express middleware array, in the frozen order, ending just before the handler
 */
function buildProtectedRoute({
  resource,
  permission,
  entitlement,
  loadRecord,
  ownershipAction = 'edit',
  overridePermissionCode,
  extraScopeMiddleware = [],
  businessValidation = [],
  checkState = false,
}) {
  const chain = [auth, enforceTenantScope];
  if (entitlement) chain.push(loadEntitlements, requireEntitlement(entitlement));
  else chain.push(loadEntitlements);
  if (permission) chain.push(requirePermission(permission));
  chain.push(...extraScopeMiddleware); // division / department / project scope — future modules
  if (loadRecord) {
    chain.push(requireOwnership({ resource, loadRecord, action: ownershipAction, overridePermissionCode }));
    if (checkState) chain.push(requireEditableState({ resource, loadRecord: () => Promise.resolve(null) })); // req.record already set by requireOwnership
  }
  chain.push(...businessValidation);
  return chain;
}

module.exports = { buildProtectedRoute };
