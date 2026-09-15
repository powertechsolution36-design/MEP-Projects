// Project service — the shell. Division-level work belongs to services/projectPackageService.js.
//
// Built ON TOP of the Phase 4 common record service (services/recordService.js): creation,
// ownership stamping, immutable-field protection, soft delete, correction routing and audit all
// come from there. This file adds only what is specific to Project:
//
//   * division validation against the company's dynamically resolved entitlements (never a
//     hard-coded plan combination — Phase 3 remains the authority);
//   * sub-trade validation per division (DATABASE_ARCHITECTURE.md rev 4);
//   * the explicit, audited conversion from a legacy single-division project to real packages;
//   * a read model that routes through compat/legacyProjectPackageAdapter.js.
//
// Sales Order, BOQ, Material Requirements, Inventory, Finance, Service, Checklist and progress are
// deliberately NOT implemented here. Project only carries the forward linkage fields those modules
// will attach to.
const Project = require('../models/Project');
const ProjectPackage = require('../models/ProjectPackage');
const { PROJECT_RESOURCE } = require('../config/projectPolicy');
const { DIVISION_VALUES, SUB_TRADES, AUDIT_ACTIONS, RECORD_STATES } = require('../config/constants');
const recordService = require('./recordService');
const { audit } = require('./auditService');
const {
  presentProject, projectDivisions, isLegacyProject,
} = require('../compat/legacyProjectPackageAdapter');

class ProjectServiceError extends Error {
  constructor(message, code, status = 422, details) {
    super(message);
    this.name = 'ProjectServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// --------------------------------------------------------------------------------------------
// validation
// --------------------------------------------------------------------------------------------

/**
 * assertValidDivisions — only SOLAR / MEP / HVAC, and only those the COMPANY is actually entitled
 * to. Entitlements are whatever the Phase 3 engine resolved for this request
 * (req.entitlements); this function never reasons about plan names or fixed combinations.
 */
function assertValidDivisions(divisions, entitlements) {
  if (!Array.isArray(divisions) || divisions.length === 0) {
    throw new ProjectServiceError('At least one division is required', 'DIVISION_REQUIRED');
  }
  for (const division of divisions) {
    if (!DIVISION_VALUES.includes(division)) {
      throw new ProjectServiceError(`Unknown division: ${division}`, 'INVALID_DIVISION');
    }
  }
  if (new Set(divisions).size !== divisions.length) {
    throw new ProjectServiceError('Duplicate division in divisions[]', 'DUPLICATE_DIVISION');
  }
  if (entitlements && entitlements.enforceEntitlements !== false) {
    const entitled = entitlements.divisions;
    if (entitled !== '*' && Array.isArray(entitled)) {
      for (const division of divisions) {
        if (!entitled.includes(division)) {
          throw new ProjectServiceError(
            `Company not entitled to division: ${division}`, 'DIVISION_NOT_ENTITLED', 403,
          );
        }
      }
    }
  }
  return divisions;
}

/**
 * assertValidSubTrades — every sub-trade must belong to one of the record's own divisions
 * (DATABASE_ARCHITECTURE.md rev 4: "Validation ensures each sub-trade belongs to the package's
 * division"). An HVAC sub-trade on an MEP-only project is rejected — this is one of the concrete
 * places the MEP/HVAC separation is enforced rather than merely stated.
 */
function assertValidSubTrades(subTrades, divisions) {
  if (subTrades == null) return undefined;
  if (!Array.isArray(subTrades)) {
    throw new ProjectServiceError('subTrades must be an array', 'INVALID_SUB_TRADE');
  }
  const allowed = new Set(divisions.flatMap((division) => SUB_TRADES[division] || []));
  for (const trade of subTrades) {
    if (!allowed.has(trade)) {
      throw new ProjectServiceError(
        `Sub-trade ${trade} does not belong to division(s) ${divisions.join(', ')}`,
        'INVALID_SUB_TRADE',
      );
    }
  }
  return subTrades;
}

// --------------------------------------------------------------------------------------------
// reads
// --------------------------------------------------------------------------------------------

async function loadProject(id) {
  const query = Project.findById(id);
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function loadPackages(projectId) {
  const query = ProjectPackage.find({ projectId });
  return typeof query?.lean === 'function' ? query.lean() : query;
}

/**
 * getProjectView — the v3 read model. A converted project returns its real packages; a legacy
 * single-division project returns ONE VIRTUAL package assembled on the fly, with no row written
 * and no legacy history duplicated.
 */
async function getProjectView(id) {
  const project = await loadProject(id);
  if (!project) throw new ProjectServiceError('Project not found', 'NOT_FOUND', 404);
  const packages = isLegacyProject(project) ? [] : await loadPackages(project._id);
  return presentProject(project, packages);
}

// --------------------------------------------------------------------------------------------
// writes
// --------------------------------------------------------------------------------------------

/**
 * createProject — a v3-native project. Multi-division projects materialize a real ProjectPackage
 * per division immediately (ACCESS_MATRIX.md PART 7 case (b)); a single-division v3 project is
 * created in package architecture too, because it is new data with no legacy history to preserve.
 */
async function createProject({ req, payload = {} }) {
  const divisions = assertValidDivisions(payload.divisions, req.entitlements);
  const subTrades = assertValidSubTrades(payload.subTrades, divisions);

  const project = await recordService.createRecord({
    req,
    Model: Project,
    resource: PROJECT_RESOURCE,
    payload: {
      ...payload,
      divisions,
      subTrades,
      packageArchitecture: true,     // v3-native — never a legacy single-div shell
      migrationReviewRequired: false,
    },
  });

  const packages = [];
  for (const division of divisions) {
    packages.push(await createPackageRow({
      req,
      project,
      division,
      payload: { code: `${payload.code || project._id}-${division}`, name: `${payload.name || ''} ${division}`.trim() },
    }));
  }
  return { project, packages };
}

/**
 * updateProject — ordinary field update through the shared record service, which enforces the
 * ownership decision made upstream, the immutable-field list (legacy history included) and the
 * governance state, and writes the audit entry / RecordCorrection.
 */
async function updateProject({ req, id, payload = {}, reason, decision }) {
  const before = req.record || await loadProject(id);
  if (!before) throw new ProjectServiceError('Project not found', 'NOT_FOUND', 404);

  if (payload.divisions !== undefined) {
    const divisions = assertValidDivisions(payload.divisions, req.entitlements);
    // Divisions may be added but never silently removed — a removed division would orphan its
    // package and its operational history. Removal is a separate, deliberate workflow.
    const existing = projectDivisions(before).divisions;
    for (const division of existing) {
      if (!divisions.includes(division)) {
        throw new ProjectServiceError(
          `Division ${division} cannot be removed from a project through a field update`,
          'DIVISION_REMOVAL_FORBIDDEN', 422,
        );
      }
    }
    assertValidSubTrades(payload.subTrades, divisions);
  } else if (payload.subTrades !== undefined) {
    assertValidSubTrades(payload.subTrades, projectDivisions(before).divisions);
  }

  return recordService.updateOwnRecord({
    req, Model: Project, resource: PROJECT_RESOURCE, id, payload, reason, decision,
  });
}

async function deleteProject({ req, id, reason, decision }) {
  return recordService.softDeleteRecord({
    req, Model: Project, resource: PROJECT_RESOURCE, id, reason, decision,
  });
}

async function submitProject({ req, id, reason }) {
  return recordService.submitRecord({ req, Model: Project, resource: PROJECT_RESOURCE, id, reason });
}

/**
 * convertToPackageArchitecture — the ONLY sanctioned path from a legacy single-division project to
 * real ProjectPackage rows (ACCESS_MATRIX.md PART 7 case (a): "explicitly converted to v3 package
 * architecture by a Company Admin").
 *
 * What it deliberately does NOT do:
 *   * run as a backfill or bulk migration — one project, one explicit request, always audited;
 *   * copy `chk[]` / `updates[]` / `dc[]` / `engs[]` / `pm` into the new package. Legacy history
 *     stays on the Project and becomes read-only historical; the new package starts empty and new
 *     operational work goes to it from that point forward;
 *   * invent a division. A project whose legacy `div` does not map (v2's 'Other', or missing) is
 *     refused and left flagged for migration review.
 */
async function convertToPackageArchitecture({ req, id, divisions, reason }) {
  const project = req.record || await loadProject(id);
  if (!project) throw new ProjectServiceError('Project not found', 'NOT_FOUND', 404);
  if (!isLegacyProject(project)) {
    throw new ProjectServiceError('Project already uses package architecture', 'ALREADY_CONVERTED', 409);
  }

  const resolved = projectDivisions(project);
  if (resolved.migrationReviewRequired && !divisions) {
    throw new ProjectServiceError(
      'Legacy division could not be resolved — this project requires migration review and cannot be auto-converted',
      'MIGRATION_REVIEW_REQUIRED', 422,
    );
  }

  // An explicit division list may be supplied (that is what makes a legacy single-division project
  // multi-division), but it must still contain the project's existing division so no history is
  // orphaned, and it is still validated against live entitlements.
  const target = assertValidDivisions(divisions || resolved.divisions, req.entitlements);
  for (const existing of resolved.divisions) {
    if (!target.includes(existing)) {
      throw new ProjectServiceError(
        `Conversion must retain the project's existing division ${existing}`,
        'DIVISION_REMOVAL_FORBIDDEN', 422,
      );
    }
  }

  const packages = [];
  for (const division of target) {
    packages.push(await createPackageRow({
      req,
      project,
      division,
      payload: { code: `${project.code || project._id}-${division}`, name: `${project.name || ''} ${division}`.trim() },
    }));
  }

  const update = {
    divisions: target,
    packageArchitecture: true,
    convertedAt: new Date(),
    convertedByUserId: req.user?._id ?? null,
    updatedByUserId: req.user?._id ?? null,
  };
  const after = await Project.findByIdAndUpdate(id, { $set: update }, { new: true });

  await audit({
    req,
    action: AUDIT_ACTIONS.UPDATE,
    resource: PROJECT_RESOURCE,
    resourceId: id,
    before: { packageArchitecture: false, divisions: resolved.divisions },
    after: { packageArchitecture: true, divisions: target },
    reason: reason || 'Converted to v3 package architecture',
  });

  return { project: after, packages };
}

// Shared by createProject and convertToPackageArchitecture so a package row is only ever built one
// way. Kept private: package CRUD proper lives in services/projectPackageService.js.
async function createPackageRow({ req, project, division, payload }) {
  return recordService.createRecord({
    req,
    Model: ProjectPackage,
    resource: 'ProjectPackage',
    payload: {
      ...payload,
      projectId: project._id,
      division,
      status: 'planning',
      recordState: RECORD_STATES.DRAFT,
    },
  });
}

module.exports = {
  assertValidDivisions,
  assertValidSubTrades,
  getProjectView,
  createProject,
  updateProject,
  deleteProject,
  submitProject,
  convertToPackageArchitecture,
  ProjectServiceError,
};
