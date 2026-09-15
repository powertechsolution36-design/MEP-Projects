// Phase 6.0 resource policies — declared through the SAME Phase 4 registry every other v3 resource
// uses (config/recordPolicy.js), never a second ownership/state mechanism (spec §F).
//
// Required for its side effect (the defineResourcePolicy calls) by
// services/permissionAdminService.js, so the policy is registered before any ownership gate reads
// it — the same import-for-side-effect pattern config/projectPolicy.js established in Phase 5.
const { defineResourcePolicy } = require('./recordPolicy');
const { RECORD_STATES } = require('./constants');

const PERMISSION_RESOURCE = 'Permission';
const ROLE_PERMISSION_RESOURCE = 'RolePermission';
const USER_PERMISSION_OVERRIDE_RESOURCE = 'UserPermissionOverride';

// A permission ASSIGNMENT's identity is (company, subject, code). Re-pointing an existing row at a
// different designation, user or code would rewrite history — an administrator revokes the old row
// and grants a new one instead, leaving both actions in AuditLog.
const ROLE_PERMISSION_IMMUTABLE_FIELDS = Object.freeze(['designation', 'permissionCode']);
const USER_OVERRIDE_IMMUTABLE_FIELDS = Object.freeze(['userId', 'permissionCode']);

// The catalog code itself is the primary key every assignment references.
const PERMISSION_IMMUTABLE_FIELDS = Object.freeze(['code', 'systemManaged']);

function registerPermissionPolicies() {
  // The platform catalog. `softDelete:false` — a code is deactivated (`active:false`), never
  // deleted, because assignment rows and historical AuditLog entries reference it by code.
  defineResourcePolicy(PERMISSION_RESOURCE, {
    immutableFields: PERMISSION_IMMUTABLE_FIELDS,
    softDelete: false,
  });

  // Assignments carry no DRAFT/SUBMITTED/APPROVED lifecycle — `granted` is their state — so both
  // declare a `stateField` that no document sets. stateOf() then returns undefined, which
  // canEditInState()/canDeleteInState() treat as "stateless record, nothing to enforce". This is
  // deliberate and explicit rather than letting them inherit the default `status` field they do not
  // have.
  defineResourcePolicy(ROLE_PERMISSION_RESOURCE, {
    stateField: 'assignmentState',
    immutableFields: ROLE_PERMISSION_IMMUTABLE_FIELDS,
    deletableStates: [RECORD_STATES.DRAFT],
  });

  defineResourcePolicy(USER_PERMISSION_OVERRIDE_RESOURCE, {
    stateField: 'assignmentState',
    immutableFields: USER_OVERRIDE_IMMUTABLE_FIELDS,
    deletableStates: [RECORD_STATES.DRAFT],
  });
}

registerPermissionPolicies();

module.exports = {
  registerPermissionPolicies,
  PERMISSION_RESOURCE,
  ROLE_PERMISSION_RESOURCE,
  USER_PERMISSION_OVERRIDE_RESOURCE,
  ROLE_PERMISSION_IMMUTABLE_FIELDS,
  USER_OVERRIDE_IMMUTABLE_FIELDS,
  PERMISSION_IMMUTABLE_FIELDS,
};
