const express = require('express');
const { buildProtectedRoute } = require('../middleware/chain');
const { auth } = require('../middleware/auth');
const { enforceTenantScope, loadEntitlements } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/authorization');
const { validate } = require('../middleware/validate');
const { PERMISSIONS } = require('../config/constants');
const ctrl = require('../controllers/projectController');
const Project = require('../models/Project');
const ProjectPackage = require('../models/ProjectPackage');
require('../config/projectPolicy');   // registers the Project / ProjectPackage resource policies

const router = express.Router();

// V3-ADDITIVE ONLY. The legacy `/api/projects` endpoints v2 serves in production are untouched
// (API_ARCHITECTURE.md §10). These routes add the v3 package architecture that v2 has no concept
// of — the package sub-tree address is frozen by API_ARCHITECTURE.md §2 as
// `/api/v3/projects/:pId/packages/:pkgId`.
//
// Every mutating route below is assembled by middleware/chain.js buildProtectedRoute(), which runs
// the frozen authorization order: auth -> company scope -> entitlement -> permission -> division ->
// department -> project/package scope -> ownership -> record state -> immutable fields ->
// validation -> handler, with the audit entry written by the service. Nothing here re-implements
// any of those layers.

const loadProject = (req) => {
  const q = Project.findById(req.params.pId);
  return typeof q?.lean === 'function' ? q.lean() : q;
};
const loadPackage = (req) => {
  const q = ProjectPackage.findById(req.params.pkgId);
  return typeof q?.lean === 'function' ? q.lean() : q;
};

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

router.get('/', auth, enforceTenantScope, loadEntitlements, requirePermission(PERMISSIONS.VIEW), ctrl.listProjects);
router.get('/:pId', auth, enforceTenantScope, loadEntitlements, requirePermission(PERMISSIONS.VIEW), ctrl.getProject);

// CREATE runs no ownership gate — there is no existing record to own (API_ARCHITECTURE.md §1).
router.post(
  '/',
  ...buildProtectedRoute({ resource: 'Project', permission: PERMISSIONS.CREATE }),
  validate({ body: { name: { type: 'string', required: true } } }),
  ctrl.createProject,
);

router.put(
  '/:pId',
  ...buildProtectedRoute({ resource: 'Project', permission: PERMISSIONS.EDIT, loadRecord: loadProject }),
  ctrl.updateProject,
);

router.delete(
  '/:pId',
  ...buildProtectedRoute({
    resource: 'Project', permission: PERMISSIONS.DELETE, loadRecord: loadProject, ownershipAction: 'delete',
  }),
  ctrl.deleteProject,
);

// SUBMIT is a business action, authorized by its own permission — deliberately NOT routed through
// the ownership gate (Phase 4 §5: a business action is never a record edit).
router.post(
  '/:pId/submit',
  ...buildProtectedRoute({ resource: 'Project', permission: PERMISSIONS.SUBMIT }),
  ctrl.submitProject,
);

// The ONE sanctioned path from a legacy single-division project to real ProjectPackage rows
// (ACCESS_MATRIX.md PART 7: "explicitly converted to v3 package architecture by a Company Admin").
// Never a bulk backfill, always audited, and it never copies legacy operational history.
router.post(
  '/:pId/convert-to-packages',
  ...buildProtectedRoute({ resource: 'Project', permission: PERMISSIONS.EDIT, loadRecord: loadProject }),
  ctrl.convertProject,
);

// ---------------------------------------------------------------------------------------------
// ProjectPackage — frozen address /api/v3/projects/:pId/packages[/:pkgId]
// ---------------------------------------------------------------------------------------------

router.get('/:pId/packages', auth, enforceTenantScope, loadEntitlements, requirePermission(PERMISSIONS.VIEW), ctrl.listPackages);
router.get('/:pId/packages/:pkgId', auth, enforceTenantScope, loadEntitlements, requirePermission(PERMISSIONS.VIEW), ctrl.getPackage);

// A package is division-scoped: requireDivision() resolves the target division from the REQUEST
// BODY's server-validated value for creation, and from the stored record for updates — never from
// a UI `selectedDivision`, which is view context only and never an authorization input.
router.post(
  '/:pId/packages',
  ...buildProtectedRoute({
    resource: 'ProjectPackage',
    permission: PERMISSIONS.CREATE,
    division: (req) => req.body?.division,
  }),
  validate({
    body: {
      division: { type: 'string', required: true },
      code: { type: 'string', required: true },
    },
  }),
  ctrl.createPackage,
);

router.put(
  '/:pId/packages/:pkgId',
  ...buildProtectedRoute({
    resource: 'ProjectPackage',
    permission: PERMISSIONS.EDIT,
    loadRecord: loadPackage,
    pkg: { loadPackage, loadProject },
  }),
  ctrl.updatePackage,
);

router.delete(
  '/:pId/packages/:pkgId',
  ...buildProtectedRoute({
    resource: 'ProjectPackage',
    permission: PERMISSIONS.DELETE,
    loadRecord: loadPackage,
    ownershipAction: 'delete',
    pkg: { loadPackage, loadProject },
  }),
  ctrl.deletePackage,
);

router.post(
  '/:pId/packages/:pkgId/submit',
  ...buildProtectedRoute({
    resource: 'ProjectPackage',
    permission: PERMISSIONS.SUBMIT,
    pkg: { loadPackage, loadProject },
  }),
  ctrl.submitPackage,
);

module.exports = router;
