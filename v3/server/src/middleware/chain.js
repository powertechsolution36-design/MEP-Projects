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
const { loadPermissions } = require('./permissions');
const { requirePermission } = require('./authorization');
const { requireDivision } = require('./division');
const { requireDepartment } = require('./department');
const { requireProjectScope, requirePackageScope } = require('./projectScope');
const { requireOwnership } = require('./ownership');
const { requireEditableState } = require('./recordState');
const { protectImmutableFields } = require('./immutableFields');

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
 * @param {boolean} [opts.protectImmutable] - set false to skip immutable-field protection (read routes)
 * @param {'strip'|'reject'} [opts.immutableFieldMode='strip'] - 'reject' returns 422 on an attempted change
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
  protectImmutable,
  immutableFieldMode = 'strip',
}) {
  const chain = [auth, enforceTenantScope];
  if (entitlement) chain.push(loadEntitlements, requireEntitlement(entitlement));
  else chain.push(loadEntitlements);
  // Phase 6.0 — DATA LOADING, not a gate: resolves RolePermission + UserPermissionOverride once for
  // this request. Sits beside loadEntitlements in the same slot pattern, so the frozen STEP 13 GATE
  // order below (permission -> division -> department -> project/package -> ownership -> record
  // state -> immutable fields -> validation) is unchanged. It runs unconditionally — even when a
  // route declares no `permission` — because requireOwnership()'s override check consults the same
  // resolved set.
  chain.push(loadPermissions);
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
  // Phase 4 §12/§16 — immutable system fields (_id / companyId / createdByUserId / createdAt /
  // approval + audit history / any module-declared field) are protected on every mutating route,
  // AFTER ownership so the stored record is available for a value-aware comparison in 'reject' mode.
  // Runs on record-mutation routes only; a read-only route has no payload to protect.
  if (protectImmutable !== false && (loadRecord || ownershipAction !== 'edit')) {
    chain.push(protectImmutableFields({ resource, mode: immutableFieldMode }));
  }
  chain.push(...businessValidation);
  return chain;
}

module.exports = { buildProtectedRoute };
