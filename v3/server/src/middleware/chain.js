// STEP 13 — Authorization order. Frozen sequence:
//   Authentication -> Tenant/Company Scope -> Entitlement -> Permission -> Division Scope ->
//   Department Scope -> Project/ProjectPackage Scope -> Ownership -> Record State/Approval State ->
//   Business Validation -> Handler
//
// Division/Department/Project/Package scope now have real, reusable implementations (Phase 2:
// middleware/division.js, middleware/department.js, middleware/projectScope.js) and are wired into
// their explicit, frozen-order slots below via opts.division / opts.department / opts.project /
// opts.pkg. A resource that needs none of them simply omits the opt — "not every resource needs
// every layer, but the system must support all of them." Business Validation stays a feature-module
// slot (opts.businessValidation) since it is resource-specific and has no reusable shape.
const { auth } = require('./auth');
const { enforceTenantScope, loadEntitlements, requireEntitlement } = require('./tenant');
const { requirePermission } = require('./authorization');
const { requireDivision } = require('./division');
const { requireDepartment } = require('./department');
const { requireProjectScope, requirePackageScope } = require('./projectScope');
const { requireOwnership } = require('./ownership');
const { requireEditableState } = require('./recordState');

/**
 * @param {Object} opts
 * @param {string} opts.resource
 * @param {string} [opts.permission] - a PERMISSIONS constant or resource-scoped code
 * @param {{module?:string, division?:string}} [opts.entitlement]
 * @param {Function|string} [opts.division] - resolveTargetDivision(req) for middleware/division.js
 * @param {Function|string} [opts.department] - resolveTargetDepartment(req) for middleware/department.js
 * @param {{allowedDepartments?:string[]}} [opts.departmentOptions]
 * @param {Function} [opts.project] - loadRecord(req) for middleware/projectScope.js requireProjectScope
 * @param {{loadPackage:Function, loadProject?:Function}} [opts.pkg] - for requirePackageScope
 * @param {Function} [opts.loadRecord] - (req) => Promise<record|null> — required if ownership/state checks are used
 * @param {'edit'|'delete'|'correct'} [opts.ownershipAction]
 * @param {Function[]} [opts.extraScopeMiddleware] - any additional resource-specific scope middleware
 * @param {Function[]} [opts.businessValidation] - resource-specific validation, run last before the handler
 * @returns {Function[]} an Express middleware array, in the frozen order, ending just before the handler
 */
function buildProtectedRoute({
  resource,
  permission,
  entitlement,
  division,
  department,
  departmentOptions,
  project,
  pkg,
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
  if (division) chain.push(requireDivision(division));
  if (department) chain.push(requireDepartment(department, departmentOptions || {}));
  if (project) chain.push(requireProjectScope({ loadRecord: project }));
  if (pkg) chain.push(requirePackageScope(pkg));
  chain.push(...extraScopeMiddleware); // any further resource-specific scope middleware
  if (loadRecord) {
    chain.push(requireOwnership({ resource, loadRecord, action: ownershipAction, overridePermissionCode }));
    if (checkState) chain.push(requireEditableState({ resource, loadRecord: () => Promise.resolve(null) })); // req.record already set by requireOwnership
  }
  chain.push(...businessValidation);
  return chain;
}

module.exports = { buildProtectedRoute };
