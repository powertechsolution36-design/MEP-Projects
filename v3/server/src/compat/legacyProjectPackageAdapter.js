// legacyProjectPackageAdapter — presents a single-division legacy Project as ONE VIRTUAL package,
// on the fly, for v3 reads.
//
// Path and purpose are frozen: V3_MIGRATION_MAP.md "Legacy Compatibility Shims" names this file
// exactly. The rules it implements are frozen too (DATABASE_ARCHITECTURE.md "Migration
// compatibility rule"; ACCESS_MATRIX.md PART 7 "Legacy migration"):
//
//   * DO NOT duplicate legacy history into packages. `chk[]`, `updates[]`, `dc[]`, `engs[]`, `pm`
//     stay on Project and are presented read-only. Nothing is copied.
//   * NO package materialization on backfill. The legacy Project remains the single source of
//     truth. A real ProjectPackage row appears only when (a) a Company Admin EXPLICITLY converts
//     the project, or (b) a new multi-division project is created.
//   * Single source of truth per record — never two writable copies.
//
// Everything this module returns is therefore a READ MODEL: `virtual: true`, no `_id`, and
// explicitly not persistable. services/projectPackageService.js refuses to write one.
const { LEGACY_DIV_MAP, RECORD_STATES } = require('../config/constants');

/**
 * resolveLegacyDivision — maps a legacy `Project.div` onto a v3 division, or refuses.
 *
 * v2's enum is ['MEP','HVAC','Solar','Other']: mixed-case 'Solar', and 'Other' which is not a
 * division at all. An unmapped, missing or unrecognized value is NEVER guessed into a division and
 * NEVER expanded to all three — it returns migrationReviewRequired, exactly as a legacy company
 * with missing division metadata does in the entitlement layer (PLAN_ENTITLEMENTS.md §11,
 * DOCUMENT_AUTHORITY.md worked example 5).
 *
 * @returns {{division: string|null, migrationReviewRequired: boolean, legacyValue: *}}
 */
function resolveLegacyDivision(legacyDiv) {
  if (legacyDiv == null || legacyDiv === '') {
    return { division: null, migrationReviewRequired: true, legacyValue: legacyDiv ?? null };
  }
  const mapped = LEGACY_DIV_MAP[legacyDiv];
  if (!mapped) {
    // 'Other', or anything else v2 may hold. Reviewable, never granted.
    return { division: null, migrationReviewRequired: true, legacyValue: legacyDiv };
  }
  return { division: mapped, migrationReviewRequired: false, legacyValue: legacyDiv };
}

/**
 * projectDivisions — the v3 division list for a project, without ever inventing one.
 *
 * A converted / v3-native project carries `divisions[]` directly. A legacy project derives its
 * single division from `div` through the map above; if that fails the list is EMPTY and the
 * project is flagged for migration review rather than being given divisions it never had.
 */
function projectDivisions(project) {
  if (!project) return { divisions: [], migrationReviewRequired: true };
  if (Array.isArray(project.divisions) && project.divisions.length) {
    return { divisions: [...project.divisions], migrationReviewRequired: !!project.migrationReviewRequired };
  }
  const resolved = resolveLegacyDivision(project.div);
  return {
    divisions: resolved.division ? [resolved.division] : [],
    migrationReviewRequired: resolved.migrationReviewRequired,
  };
}

/** True when this project's operational unit is still the legacy Project itself. */
function isLegacyProject(project) {
  return !!project && project.packageArchitecture !== true;
}

/**
 * toVirtualPackage — the single-division legacy Project presented in ProjectPackage shape.
 *
 * Returns null when the project cannot be represented as one package: it has no resolvable
 * division (migration review), or it has already been converted and has real rows instead.
 * The legacy operational arrays are referenced, not copied, and the result is marked read-only.
 */
function toVirtualPackage(project) {
  if (!project || !isLegacyProject(project)) return null;
  const { divisions, migrationReviewRequired } = projectDivisions(project);
  if (migrationReviewRequired || divisions.length !== 1) return null;

  return Object.freeze({
    virtual: true,                 // NOT a persisted row — never has an _id
    readOnly: true,                // legacy history is presented, never written through this shape
    co: project.co,
    projectId: project._id,
    division: divisions[0],
    // The legacy project IS the package, so identity mirrors the project's own.
    code: project.code ?? null,
    name: project.name ?? null,
    scope: project.notes ?? null,
    value: project.value ?? 0,
    budget: project.budget ?? null,
    // Legacy `pm`/`engs` are NAME STRINGS, not user ids. They are surfaced under legacy* keys so no
    // caller can mistake them for the ObjectId fields a real package carries, and so they can
    // never reach an authorization check (ACCESS_MATRIX.md §13.4: display values are never authz).
    projectMgr: project.projectMgrId ?? null,
    legacyPmName: project.pm ?? null,
    engs: [],
    legacyEngNames: Array.isArray(project.engs) ? [...project.engs] : [],
    status: project.status ?? 'planning',
    recordState: project.recordState ?? RECORD_STATES.DRAFT,
    startDate: project.start ?? null,
    endDate: project.target ?? null,
    handedOverAt: null,
    subTrades: Array.isArray(project.subTrades) ? [...project.subTrades] : [],
    // Read-only historical operational data, referenced in place. NEVER duplicated into a row.
    legacyHistory: Object.freeze({
      chk: project.chk ?? [],
      updates: project.updates ?? [],
      dc: project.dc ?? [],
    }),
  });
}

/**
 * presentProject — the v3 read model for ONE project, whichever architecture it uses.
 *
 * @param {Object} project              the Project document (lean)
 * @param {Array}  [packages=[]]        real ProjectPackage rows, when the project was converted
 * @returns {{project, packages, packageArchitecture, virtual, divisions, migrationReviewRequired}}
 */
function presentProject(project, packages = []) {
  const { divisions, migrationReviewRequired } = projectDivisions(project);

  if (!isLegacyProject(project)) {
    return {
      project,
      packages,
      packageArchitecture: true,
      virtual: false,
      divisions,
      migrationReviewRequired,
    };
  }

  const virtualPackage = toVirtualPackage(project);
  return {
    project,
    // A legacy project with an unresolvable division yields NO package rather than a guessed one.
    packages: virtualPackage ? [virtualPackage] : [],
    packageArchitecture: false,
    virtual: true,
    divisions,
    migrationReviewRequired,
  };
}

/**
 * legacyHistoryIsReadOnly — after conversion the legacy arrays become read-only historical fields
 * and new work goes to ProjectPackage / Task / ChecklistInstance / DailyReport. Before conversion
 * they are still v2's live data, which v3 also does not write. So the answer is always true; this
 * function exists to make that an explicit, testable rule rather than an assumption, and is used by
 * services/projectService.js to reject any v3 write touching them.
 */
const LEGACY_HISTORY_FIELDS = Object.freeze(['chk', 'updates', 'dc', 'engs', 'pm', 'div']);

function legacyHistoryIsReadOnly() { return true; }

module.exports = {
  resolveLegacyDivision,
  projectDivisions,
  isLegacyProject,
  toVirtualPackage,
  presentProject,
  legacyHistoryIsReadOnly,
  LEGACY_HISTORY_FIELDS,
};
