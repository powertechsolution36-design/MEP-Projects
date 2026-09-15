// ProjectPackage — the division-level operational unit, a FIRST-CLASS collection addressable at
// /api/v3/projects/:pId/packages/:pkgId (DATABASE_ARCHITECTURE.md "Project / Package model",
// API_ARCHITECTURE.md §2, DOCUMENT_AUTHORITY.md rev 3 global invariant "Project ≠ ProjectPackage").
//
// It is first-class rather than an embedded sub-document for the same reason AuditLog,
// ChecklistInstanceItem and ToolCustody are: independent indexing. Tasks, ChecklistInstances,
// DailyReports and MaterialRequests will each carry a `projectPackageId` FK, and a sub-document
// cannot be the target of one.
//
// MEP AND HVAC ARE NEVER MERGED. A package holds exactly ONE division, and the
// {projectId, division} unique index below makes a combined "MEP/HVAC" package structurally
// impossible rather than merely discouraged — one project gets at most one MEP package and at most
// one HVAC package, never a shared one.
//
// Like Project, `status` is the OPERATIONAL delivery lifecycle (Project.status is rolled up from
// its packages) and `recordState` is the Phase 4 governance lifecycle. See models/Project.js for
// the full reasoning on why these are two separate axes.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ownershipPlugin } = require('./plugins/ownershipPlugin');
const {
  DIVISION_VALUES, ALL_SUB_TRADES, PROJECT_STATUSES, RECORD_STATES,
} = require('../config/constants');

const WarrantySchema = new mongoose.Schema({
  start: Date,
  end: Date,
  terms: String,
}, { _id: false });

const ProjectPackageSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

  // Exactly one division, from the frozen three. No 'Other', no combined values, no free strings.
  division: { type: String, enum: DIVISION_VALUES, required: true, index: true },
  // Multi-select, but every value must belong to `division` — validated in
  // services/projectPackageService.js against config/constants.js SUB_TRADES (DB rev 4 addendum).
  subTrades: { type: [String], enum: ALL_SUB_TRADES, default: undefined },

  // Package identity. `code` is the human package number, unique within its project so a package
  // can be referenced on a document without the parent project id.
  code: { type: String, trim: true, required: true },
  name: { type: String, trim: true },
  scope: String,

  value: { type: Number, default: 0 },
  budget: { type: Number, default: null },

  // Division PM and engineers — real user ids, unlike the legacy Project.pm/engs name strings.
  projectMgr: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  engs: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  // Finer per-user assignment on top of the parent project's scope — read by
  // middleware/projectScope.js checkPackageScope().
  accessList: { type: [mongoose.Schema.Types.ObjectId], default: undefined },

  // Package-specific operational lifecycle, independent of its siblings: a project's SOLAR package
  // may be completed while its MEP package is still active.
  status: { type: String, enum: PROJECT_STATUSES, default: 'planning', index: true },
  startDate: Date,
  endDate: Date,
  handedOverAt: { type: Date, default: null },
  warranty: { type: WarrantySchema, default: undefined },

  // Phase 4 governance lifecycle (DRAFT -> ... -> LOCKED).
  recordState: { type: String, enum: Object.values(RECORD_STATES), default: RECORD_STATES.DRAFT, index: true },
}, { collection: 'v3_project_packages' });

// Ownership metadata + soft-delete triad (Phase 4). withStatus:false — `status` above is the
// operational lifecycle, not the governance state.
ProjectPackageSchema.plugin(ownershipPlugin, { withStatus: false });

// DATABASE_ARCHITECTURE.md "Indexes (target)": co+projectId, co+division, projectId+division unique.
ProjectPackageSchema.index({ co: 1, projectId: 1 });
ProjectPackageSchema.index({ co: 1, division: 1 });
// THE structural guarantee that MEP and HVAC stay separate and are never duplicated per project.
ProjectPackageSchema.index({ projectId: 1, division: 1 }, { unique: true });
// Package code is unique within its parent project (identity, §12).
ProjectPackageSchema.index({ projectId: 1, code: 1 }, { unique: true });
ProjectPackageSchema.index({ co: 1, recordState: 1 });

module.exports = defineModel('ProjectPackage', ProjectPackageSchema, 'v3_project_packages');
