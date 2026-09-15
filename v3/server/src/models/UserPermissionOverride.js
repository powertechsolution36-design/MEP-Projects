// UserPermissionOverride — per-user grant/revoke, applied AFTER the role defaults
// (DATABASE_ARCHITECTURE.md §Access/Audit "UserPermissionOverride (per-user grants/revokes)";
// API_ARCHITECTURE.md §7 "effective = UserPermissionOverride ∪ RolePermission[user.role]";
// ARCHITECTURE.md §P `/api/v3/users/:id/permissions`).
//
// `granted` distinguishes the two directions explicitly — a revoke is a first-class row, never the
// absence of one. This is what lets an administrator take a single permission away from one
// individual who would otherwise receive it from their designation, which is the entire purpose of
// this collection (V3 PHASE 6.0 spec §B: "an explicit revoke able to remove a role-derived
// permission").
//
// COMPANY ISOLATION (spec §H): every row carries `co`, every resolution query filters on it, and a
// row belonging to another company can never reach a user's effective set — see
// services/permissionResolutionService.js and tests/permissionResolution.test.js.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ownershipPlugin } = require('./plugins/ownershipPlugin');

const UserPermissionOverrideSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  permissionCode: { type: String, required: true, index: true },

  // TRUE  = explicit per-user GRANT   — wins over a role-level revoke (more specific wins).
  // FALSE = explicit per-user REVOKE  — wins over everything except Super Admin, including a
  //         role-level grant and the legacy `User.permissions[]` compatibility layer (including its
  //         '*' wildcard). This is the highest-priority rule in the whole resolution, mirroring
  //         DOCUMENT_AUTHORITY.md's frozen "EXPLICIT MANUAL DISABLE wins" entitlement precedence.
  granted: { type: Boolean, required: true, index: true },

  // Why this individual differs from their designation's default. Not enforced as mandatory at the
  // schema level; the administration service requires it (services/permissionAdminService.js) so a
  // per-person exception always carries a written justification into AuditLog.
  reason: { type: String, default: null },
}, { collection: 'v3_user_permission_overrides' });

// Phase 4 ownership metadata block + soft-delete triad. `withStatus:false` for the same reason as
// RolePermission — `granted` is the state.
UserPermissionOverrideSchema.plugin(ownershipPlugin, { withStatus: false });

// One row per (company, user, code).
UserPermissionOverrideSchema.index({ co: 1, userId: 1, permissionCode: 1 }, { unique: true });
// Resolution reads every override for one user in one company — this is that query.
UserPermissionOverrideSchema.index({ co: 1, userId: 1, granted: 1 });

module.exports = defineModel('UserPermissionOverride', UserPermissionOverrideSchema, 'v3_user_permission_overrides');
