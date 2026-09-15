// RolePermission — the per-company, per-DESIGNATION default permission map
// (DATABASE_ARCHITECTURE.md §Access/Audit "RolePermission (default role → permission map)";
// ARCHITECTURE.md §R lists `TeamPermissions.jsx` under COMPANY ADMIN, so a company edits its own).
//
// ---------------------------------------------------------------------------------------------
// DISCLOSED INTERPRETATION DECISION — keyed by `designation`, not by the legacy `role` enum.
// ---------------------------------------------------------------------------------------------
// API_ARCHITECTURE.md §2 names the endpoint `/api/v3/roles/:role/permissions` and
// DATABASE_ARCHITECTURE.md says "role → permission map". The frozen org hierarchy
// (ROLE_HIERARCHY.md §2, restated in the Phase 6.0 spec §G) distinguishes SALES MANAGER from
// SALES EXECUTIVE — but v2's legacy `role` enum has only a single `sales` value for both
// (LEGACY_ROLE_COMPATIBILITY.md). Keying this collection by legacy `role` would therefore make the
// two Sales designations permanently indistinguishable, which the spec explicitly forbids
// ("Do not make Sales Manager and Sales Executive equivalent").
//
// So: rows are keyed by the frozen DESIGNATION enum (config/constants.js DESIGNATIONS), and the
// `:role` path parameter accepts EITHER a designation or a legacy role, normalizing the latter
// through the existing services/roleResolver.js LEGACY_ROLE_MAP. The documented endpoint shape is
// preserved; the frozen hierarchy is preserved; nothing is renamed in v2.
//
// A company with NO rows here behaves exactly as it did before Phase 6.0 — see
// services/permissionResolutionService.js for the full precedence and why that matters.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ownershipPlugin } = require('./plugins/ownershipPlugin');
const { DESIGNATION_VALUES } = require('../config/constants');

const RolePermissionSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  designation: { type: String, required: true, enum: DESIGNATION_VALUES, index: true },
  permissionCode: { type: String, required: true, index: true },

  // TRUE = this designation holds the code in this company.
  // FALSE = an explicit ROLE-LEVEL REVOKE. It is NOT the same as "no row": a missing row falls
  // through to the legacy compatibility layer, whereas `granted:false` denies the code outright
  // (it can still be overridden for one individual by a UserPermissionOverride grant).
  granted: { type: Boolean, required: true, default: true, index: true },

  // Provenance — 'template' when written by an explicit applyDefaults action from
  // config/permissionCatalog.js DEFAULT_ROLE_PERMISSIONS, 'manual' when set row-by-row by an admin.
  source: { type: String, enum: ['template', 'manual'], default: 'manual', index: true },
  reason: { type: String, default: null },
}, { collection: 'v3_role_permissions' });

// Phase 4 ownership metadata block + soft-delete triad (DATABASE_ARCHITECTURE.md rev 12: the block
// is required on every v3 collection). `withStatus:false` — a permission assignment has no DRAFT/
// SUBMITTED/APPROVED business lifecycle; its governance state is the `granted` boolean itself.
RolePermissionSchema.plugin(ownershipPlugin, { withStatus: false });

// One row per (company, designation, code) — an assignment is a fact, not a log. Changes to it are
// history-tracked through AuditLog, not through duplicate rows.
RolePermissionSchema.index({ co: 1, designation: 1, permissionCode: 1 }, { unique: true });
// Resolution reads every row for one designation in one company — this is that query.
RolePermissionSchema.index({ co: 1, designation: 1, granted: 1 });

module.exports = defineModel('RolePermission', RolePermissionSchema, 'v3_role_permissions');
