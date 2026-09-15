// ProjectPackage service — the division-level operational unit.
//
// Like services/projectService.js this sits ON TOP of the Phase 4 common record service, so
// ownership, immutable fields, soft delete, correction routing and audit are inherited rather than
// re-implemented. What is specific here:
//
//   * one package per {project, division} — MEP and HVAC never share one, and a duplicate is
//     refused at the service layer with a clear error as well as by the unique index;
//   * the package's division must be one the PARENT project actually has, and one the company is
//     entitled to (dynamically resolved — never a hard-coded plan combination);
//   * sub-trades must belong to that package's own division;
//   * a virtual (legacy) package is never writable — writing one would create the second writable
//     copy the frozen "single source of truth per record" rule forbids.
const ProjectPackage = require('../models/ProjectPackage');
const Project = require('../models/Project');
const { PROJECT_PACKAGE_RESOURCE } = require('../config/projectPolicy');
const { DIVISION_VALUES, SUB_TRADES } = require('../config/constants');
const recordService = require('./recordService');
const { projectDivisions, isLegacyProject } = require('../compat/legacyProjectPackageAdapter');

class ProjectPackageServiceError extends Error {
  constructor(message, code, status = 422, details) {
    super(message);
    this.name = 'ProjectPackageServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function resolve(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function loadProject(projectId) { return resolve(Project.findById(projectId)); }
async function loadPackage(id) { return resolve(ProjectPackage.findById(id)); }

async function listPackages({ projectId }) {
  return resolve(ProjectPackage.find({ projectId }));
}

/**
 * assertPackageDivision — the division must be a real v3 division, must be one the parent project
 * holds, and must be entitled. MEP and HVAC are distinct values throughout; there is no path by
 * which one satisfies a check for the other.
 */
function assertPackageDivision({ division, project, entitlements }) {
  if (!DIVISION_VALUES.includes(division)) {
    throw new ProjectPackageServiceError(`Unknown division: ${division}`, 'INVALID_DIVISION');
  }
  const { divisions, migrationReviewRequired } = projectDivisions(project);
  if (migrationReviewRequired && !divisions.length) {
    throw new ProjectPackageServiceError(
      'Parent project has unresolved legacy division metadata and requires migration review',
      'MIGRATION_REVIEW_REQUIRED',
    );
  }
  if (!divisions.includes(division)) {
    throw new ProjectPackageServiceError(
      `Project does not include division ${division}`, 'DIVISION_NOT_ON_PROJECT',
    );
  }
  if (entitlements && entitlements.enforceEntitlements !== false) {
    const entitled = entitlements.divisions;
    if (entitled !== '*' && Array.isArray(entitled) && !entitled.includes(division)) {
      throw new ProjectPackageServiceError(
        `Company not entitled to division: ${division}`, 'DIVISION_NOT_ENTITLED', 403,
      );
    }
  }
  return division;
}

/** Every sub-trade must belong to THIS package's single division (DB rev 4 addendum). */
function assertPackageSubTrades(subTrades, division) {
  if (subTrades == null) return undefined;
  if (!Array.isArray(subTrades)) {
    throw new ProjectPackageServiceError('subTrades must be an array', 'INVALID_SUB_TRADE');
  }
  const allowed = SUB_TRADES[division] || [];
  for (const trade of subTrades) {
    if (!allowed.includes(trade)) {
      throw new ProjectPackageServiceError(
        `Sub-trade ${trade} does not belong to division ${division}`, 'INVALID_SUB_TRADE',
      );
    }
  }
  return subTrades;
}

/**
 * createPackage — adds a division package to a project that already uses package architecture.
 *
 * A LEGACY project is refused: its single division is already presented as a virtual package by
 * compat/legacyProjectPackageAdapter.js, and adding a real row alongside it would produce exactly
 * the duplicate operational record the frozen migration rule forbids. The caller must run the
 * explicit conversion first (projectService.convertToPackageArchitecture).
 */
async function createPackage({ req, projectId, payload = {} }) {
  const project = await loadProject(projectId);
  if (!project) throw new ProjectPackageServiceError('Project not found', 'NOT_FOUND', 404);

  if (isLegacyProject(project)) {
    throw new ProjectPackageServiceError(
      'Project is still on legacy single-division architecture — convert it explicitly before adding packages',
      'CONVERSION_REQUIRED', 409,
    );
  }

  const division = assertPackageDivision({ division: payload.division, project, entitlements: req.entitlements });
  const subTrades = assertPackageSubTrades(payload.subTrades, division);

  if (!payload.code || !String(payload.code).trim()) {
    throw new ProjectPackageServiceError('Package code is required', 'CODE_REQUIRED');
  }

  // One package per division per project. The unique index is the real guarantee; this check turns
  // a raw duplicate-key error into a clear, testable business response.
  const existing = await resolve(ProjectPackage.findOne({ projectId, division }));
  if (existing) {
    throw new ProjectPackageServiceError(
      `Project already has a ${division} package`, 'DUPLICATE_PACKAGE', 409,
    );
  }

  return recordService.createRecord({
    req,
    Model: ProjectPackage,
    resource: PROJECT_PACKAGE_RESOURCE,
    payload: { ...payload, projectId, division, subTrades },
  });
}

/**
 * updatePackage — ordinary field update. `projectId`, `division` and `code` are declared immutable
 * in config/projectPolicy.js, so an attempt to re-point a package at another project or division is
 * refused by the shared immutable-field guard rather than by a rule written here.
 */
async function updatePackage({ req, id, payload = {}, reason, decision }) {
  const before = req.record || await loadPackage(id);
  if (!before) throw new ProjectPackageServiceError('ProjectPackage not found', 'NOT_FOUND', 404);

  if (before.virtual) {
    throw new ProjectPackageServiceError(
      'A legacy virtual package is read-only — it is a presentation of the Project, not a record',
      'VIRTUAL_PACKAGE_READONLY', 409,
    );
  }
  if (payload.subTrades !== undefined) assertPackageSubTrades(payload.subTrades, before.division);

  return recordService.updateOwnRecord({
    req, Model: ProjectPackage, resource: PROJECT_PACKAGE_RESOURCE, id, payload, reason, decision,
  });
}

async function deletePackage({ req, id, reason, decision }) {
  return recordService.softDeleteRecord({
    req, Model: ProjectPackage, resource: PROJECT_PACKAGE_RESOURCE, id, reason, decision,
  });
}

async function submitPackage({ req, id, reason }) {
  return recordService.submitRecord({
    req, Model: ProjectPackage, resource: PROJECT_PACKAGE_RESOURCE, id, reason,
  });
}

module.exports = {
  listPackages,
  loadPackage,
  createPackage,
  updatePackage,
  deletePackage,
  submitPackage,
  assertPackageDivision,
  assertPackageSubTrades,
  ProjectPackageServiceError,
};
