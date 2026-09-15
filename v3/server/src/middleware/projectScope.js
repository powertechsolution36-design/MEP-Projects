// requireProjectScope() / requirePackageScope() — Project & ProjectPackage scope authorization.
// No Project/ProjectPackage model exists yet in this foundation (they are future feature modules —
// V3_MIGRATION_MAP.md), so this is deliberately GENERIC: it works against an injected
// `loadRecord(req)` / `loadPackage(req)` function returning a plain object shaped like
// { co, division, department, assignedUserId, accessList: [userId,...] } (a Project) or
// { co, division, projectId, accessList: [userId,...] } (a ProjectPackage) — API_ARCHITECTURE.md
// §"scope" snippet (projectAccess[] / assignedUserId / projectId_in). Real Project/ProjectPackage
// modules reuse checkProjectScope/checkPackageScope directly once their models exist, rather than
// re-implementing this logic (STEP 13 reusability requirement).
const { sendError } = require('../utils/ApiError');
const { checkDivision } = require('./division');

const DIVISIONAL_MANAGER_DESIGNATIONS = ['solar_manager', 'mep_manager', 'hvac_manager'];

/**
 * @param {Object} args
 * @param {Object} args.user
 * @param {Object} args.project - { co, division, department, assignedUserId, accessList }
 * @param {Object} [args.entitlements]
 */
function checkProjectScope({ user, project, entitlements }) {
  if (!user) return { allowed: false, reason: 'Auth required' };
  if (!project) return { allowed: false, reason: 'Project not found' };
  if (user.role === 'super') return { allowed: true };

  if (String(project.co) !== String(user.co)) {
    return { allowed: false, reason: 'Cross-company access denied' };
  }

  if (user.designation === 'company_admin') return { allowed: true };

  if (project.division && DIVISIONAL_MANAGER_DESIGNATIONS.includes(user.designation)) {
    // Divisional Manager (SOLAR/MEP/HVAC) — allowed only within their own division; delegates to
    // the shared division decision function rather than re-implementing the entitlement check.
    const div = checkDivision({ user, targetDivision: project.division, entitlements });
    if (!div.allowed) return { allowed: false, reason: div.reason };
    return { allowed: true };
  }

  if (user.designation === 'project_manager') {
    const access = Array.isArray(user.projectAccess) ? user.projectAccess.map(String) : [];
    if (project.division && user.division && project.division !== user.division) {
      return { allowed: false, reason: `Wrong division for project manager (user: ${user.division}, project: ${project.division})` };
    }
    if (project._id != null && access.length && !access.includes(String(project._id))) {
      return { allowed: false, reason: 'Project not assigned to this project manager' };
    }
    return { allowed: true };
  }

  if (['engineer', 'technician'].includes(user.designation)) {
    const isAssigned = project.assignedUserId != null && String(project.assignedUserId) === String(user._id ?? user.userId);
    const accessList = Array.isArray(project.accessList) ? project.accessList.map(String) : [];
    const inAccessList = accessList.includes(String(user._id ?? user.userId));
    if (!isAssigned && !inAccessList) {
      return { allowed: false, reason: 'Not assigned to this project' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: `Designation ${user.designation || 'unknown'} has no project-scope access rule` };
}

/**
 * @param {Object} args.pkg - { co, division, projectId, accessList }
 */
function checkPackageScope({ user, pkg, project, entitlements }) {
  if (!user) return { allowed: false, reason: 'Auth required' };
  if (!pkg) return { allowed: false, reason: 'Package not found' };
  if (user.role === 'super') return { allowed: true };
  if (String(pkg.co) !== String(user.co)) {
    return { allowed: false, reason: 'Cross-company access denied' };
  }
  if (user.designation === 'company_admin') return { allowed: true };

  // A package's authorization is the same as its parent project's, plus an optional
  // package-level accessList for finer per-user assignment (e.g. a specific technician on a
  // specific package within a larger project).
  if (project) {
    const projectDecision = checkProjectScope({ user, project, entitlements });
    if (!projectDecision.allowed) return projectDecision;
  }
  if (Array.isArray(pkg.accessList) && pkg.accessList.length) {
    const inAccessList = pkg.accessList.map(String).includes(String(user._id ?? user.userId));
    if (!inAccessList && ['engineer', 'technician'].includes(user.designation)) {
      return { allowed: false, reason: 'Not assigned to this package' };
    }
  }
  return { allowed: true };
}

function requireProjectScope({ loadRecord }) {
  return async (req, res, next) => {
    try {
      const project = req.project || await loadRecord(req);
      const decision = checkProjectScope({ user: req.user, project, entitlements: req.entitlements });
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.project = project;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

function requirePackageScope({ loadPackage, loadProject }) {
  return async (req, res, next) => {
    try {
      const pkg = req.projectPackage || await loadPackage(req);
      const project = loadProject ? (req.project || await loadProject(req, pkg)) : null;
      const decision = checkPackageScope({ user: req.user, pkg, project, entitlements: req.entitlements });
      if (!decision.allowed) return sendError(res, 403, decision.reason || 'Forbidden');
      req.projectPackage = pkg;
      if (project) req.project = project;
      next();
    } catch (err) {
      sendError(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    }
  };
}

module.exports = { checkProjectScope, checkPackageScope, requireProjectScope, requirePackageScope };
