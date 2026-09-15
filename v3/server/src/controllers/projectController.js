// Project + ProjectPackage controllers — thin. All business logic is in
// services/projectService.js and services/projectPackageService.js, and all authorization has
// already run in the route's middleware chain (middleware/chain.js buildProtectedRoute).
const { asyncHandler } = require('../utils/asyncHandler');
const { sendError } = require('../utils/ApiError');
const projectService = require('../services/projectService');
const packageService = require('../services/projectPackageService');
const Project = require('../models/Project');
const { scopeFilterV3 } = require('../middleware/authorization');

// Both services raise errors carrying { code, status }; anything else is a genuine fault and is
// rethrown for middleware/errorHandler.js.
function handleServiceError(res, err) {
  if (err && err.status && err.code) {
    return sendError(res, err.status, err.message, { code: err.code, ...(err.details || {}) });
  }
  throw err;
}

function run(handler) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res); } catch (err) { handleServiceError(res, err); }
  });
}

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

// Listing is scoped by the shared scopeFilterV3() — a divisional manager sees their division, an
// engineer sees their assigned projects, and `co` is always pinned server-side.
const listProjects = run(async (req, res) => {
  const filter = scopeFilterV3(req.user, 'Project', { co: req.tenantCompanyId || req.user.co });
  // scopeFilterV3 emits `_division_in` / `_project_in` markers for scopes Mongo expresses
  // differently; translate the two that apply to Project and drop the rest rather than passing
  // an unknown operator straight to the driver.
  const query = { co: filter.co };
  if (filter.division) query.divisions = filter.division;
  if (filter._division_in) query.divisions = { $in: filter._division_in };
  if (filter._project_in) query._id = { $in: filter._project_in };
  if (filter.assignedTo) query.accessList = filter.assignedTo;

  const projects = await Project.find(query).limit(Math.min(Number(req.query.limit) || 50, 200)).lean();
  res.json({ projects, count: projects.length });
});

// The v3 read model: a converted project returns real packages, a legacy single-division project
// returns one VIRTUAL package assembled by the compat adapter with nothing written.
const getProject = run(async (req, res) => {
  const view = await projectService.getProjectView(req.params.pId);
  if (req.user.role !== 'super' && String(view.project.co) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  res.json(view);
});

const createProject = run(async (req, res) => {
  const result = await projectService.createProject({ req, payload: req.body });
  res.status(201).json(result);
});

const updateProject = run(async (req, res) => {
  const project = await projectService.updateProject({
    req, id: req.params.pId, payload: req.body, reason: req.body._reason,
  });
  res.json({ project });
});

const deleteProject = run(async (req, res) => {
  const project = await projectService.deleteProject({
    req, id: req.params.pId, reason: req.body?.deletionReason,
  });
  res.json({ project });
});

const submitProject = run(async (req, res) => {
  const project = await projectService.submitProject({ req, id: req.params.pId, reason: req.body?.reason });
  res.json({ project });
});

const convertProject = run(async (req, res) => {
  const result = await projectService.convertToPackageArchitecture({
    req, id: req.params.pId, divisions: req.body?.divisions, reason: req.body?.reason,
  });
  res.status(201).json(result);
});

// ---------------------------------------------------------------------------------------------
// ProjectPackage
// ---------------------------------------------------------------------------------------------

const listPackages = run(async (req, res) => {
  const view = await projectService.getProjectView(req.params.pId);
  if (req.user.role !== 'super' && String(view.project.co) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  res.json({ packages: view.packages, virtual: view.virtual, packageArchitecture: view.packageArchitecture });
});

const getPackage = run(async (req, res) => {
  const pkg = await packageService.loadPackage(req.params.pkgId);
  if (!pkg) return sendError(res, 404, 'ProjectPackage not found');
  if (req.user.role !== 'super' && String(pkg.co) !== String(req.user.co)) {
    return sendError(res, 403, 'Cross-company access denied');
  }
  res.json({ package: pkg });
});

const createPackage = run(async (req, res) => {
  const pkg = await packageService.createPackage({ req, projectId: req.params.pId, payload: req.body });
  res.status(201).json({ package: pkg });
});

const updatePackage = run(async (req, res) => {
  const pkg = await packageService.updatePackage({
    req, id: req.params.pkgId, payload: req.body, reason: req.body._reason,
  });
  res.json({ package: pkg });
});

const deletePackage = run(async (req, res) => {
  const pkg = await packageService.deletePackage({
    req, id: req.params.pkgId, reason: req.body?.deletionReason,
  });
  res.json({ package: pkg });
});

const submitPackage = run(async (req, res) => {
  const pkg = await packageService.submitPackage({ req, id: req.params.pkgId, reason: req.body?.reason });
  res.json({ package: pkg });
});

module.exports = {
  listProjects, getProject, createProject, updateProject, deleteProject, submitProject, convertProject,
  listPackages, getPackage, createPackage, updatePackage, deletePackage, submitPackage,
};
