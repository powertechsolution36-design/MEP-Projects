// Permission — the PLATFORM CATALOG of permission codes (DATABASE_ARCHITECTURE.md §Access/Audit
// "Permission (catalog)"; GAP_ANALYSIS.md §5 `{ code, label, category }`; ARCHITECTURE.md §P
// "`GET /api/v3/permissions` — list all permission codes").
//
// DELIBERATELY NOT COMPANY-SCOPED (no `co`), exactly like models/Plan.js and models/AddOn.js: this
// collection is the platform's VOCABULARY — the set of codes that exist at all — not a grant. It
// contains no company data, so it cannot leak any. Who actually holds a code is expressed by the two
// company-scoped collections that reference it:
//
//     Permission (this file, platform)  ->  RolePermission (per company, per designation)
//                                       ->  UserPermissionOverride (per company, per user)
//
// Company isolation (V3 PHASE 6.0 spec §H) therefore lives on those two collections, which is where
// a cross-company read would actually be a leak. A code's mere existence is not a grant of it.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { CATEGORIES } = require('../config/permissionCatalog');

const PermissionSchema = new mongoose.Schema({
  // The code an authorization check actually tests — e.g. 'EDIT', 'Project.override',
  // 'permissions.manage'. Unique platform-wide; the seed upserts by this key.
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: null },

  // Grouping metadata for the administration UI. `resource`/`action` are decomposed from `code` at
  // seed time so the matrix screen can group by resource without re-parsing strings.
  category: { type: String, enum: Object.values(CATEGORIES), required: true, index: true },
  module: { type: String, default: null, index: true },
  resource: { type: String, default: null, index: true },
  action: { type: String, default: null },

  // A deactivated code stops being offered by the administration UI. Existing assignments are NOT
  // cascade-deleted (no hard delete of history) — resolution simply ignores an inactive code.
  active: { type: Boolean, default: true, index: true },

  // Seeded codes are part of the frozen architecture and are never deletable through an API.
  systemManaged: { type: Boolean, default: false, index: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { collection: 'v3_permissions', timestamps: true });

module.exports = defineModel('Permission', PermissionSchema, 'v3_permissions');
