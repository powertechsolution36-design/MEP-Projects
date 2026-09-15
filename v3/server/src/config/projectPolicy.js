// Resource policies for Project and ProjectPackage — declared once through the Phase 4 registry
// (config/recordPolicy.js) rather than re-implementing ownership/state/immutability rules here.
//
// This file is required for its side effect (the two defineResourcePolicy calls) by
// services/projectService.js and services/projectPackageService.js, so any code path that can
// mutate a project has the policy loaded before the ownership gate reads it.
const { defineResourcePolicy } = require('./recordPolicy');
const { RECORD_STATES } = require('./constants');
const { LEGACY_HISTORY_FIELDS } = require('../compat/legacyProjectPackageAdapter');

const PROJECT_RESOURCE = 'Project';
const PROJECT_PACKAGE_RESOURCE = 'ProjectPackage';

// Fields a v3 update may never touch on a Project, beyond the platform-wide set:
//   * the legacy operational history (`chk`, `updates`, `dc`, `engs`, `pm`) and legacy `div` —
//     v2 owns these; v3 presents them read-only and never duplicates or rewrites them
//     (DATABASE_ARCHITECTURE.md "Migration compatibility rule").
//   * the conversion markers — `packageArchitecture` flips only through the explicit, audited
//     conversion action, never through an ordinary field update.
const PROJECT_IMMUTABLE_FIELDS = Object.freeze([
  ...LEGACY_HISTORY_FIELDS,
  'packageArchitecture', 'convertedAt', 'convertedByUserId',
  'migrationReviewRequired',
]);

// A package's parent and division are its identity. Moving a package between projects, or
// re-pointing it at another division, would silently rewrite operational history and is exactly
// what the {projectId, division} unique index exists to prevent — so they are immutable here too.
const PACKAGE_IMMUTABLE_FIELDS = Object.freeze([
  'projectId', 'division', 'code',
]);

function registerProjectPolicies() {
  defineResourcePolicy(PROJECT_RESOURCE, {
    // `status` on this collection is v2's operational lifecycle; the Phase 4 governance state lives
    // on `recordState`. See models/Project.js.
    stateField: 'recordState',
    immutableFields: PROJECT_IMMUTABLE_FIELDS,
    // Delete stays at the platform default (DRAFT only) and is always a soft delete — a project
    // carries operational and, later, financial history that is never hard-deleted.
    deletableStates: [RECORD_STATES.DRAFT],
  });

  defineResourcePolicy(PROJECT_PACKAGE_RESOURCE, {
    stateField: 'recordState',
    immutableFields: PACKAGE_IMMUTABLE_FIELDS,
    deletableStates: [RECORD_STATES.DRAFT],
  });
}

// Registered on import so a policy is never missing at the moment the ownership gate consults it.
registerProjectPolicies();

module.exports = {
  registerProjectPolicies,
  PROJECT_RESOURCE,
  PROJECT_PACKAGE_RESOURCE,
  PROJECT_IMMUTABLE_FIELDS,
  PACKAGE_IMMUTABLE_FIELDS,
};
