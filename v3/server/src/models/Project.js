// v3-side model of the SAME `projects` collection v2 owns and writes live.
//
// Authority: DATABASE_ARCHITECTURE.md "Project / Package model (RESOLVED)" + rev 4 sub-trade
// addendum; ACCESS_MATRIX.md PART 7; ARCHITECTURE.md §H additive-field list.
//
// `Project` is the overall project SHELL. Division-level operational work belongs to
// `ProjectPackage` (a first-class collection, never an embedded sub-document — DOCUMENT_AUTHORITY
// .md rev 3 resolves ARCHITECTURE.md §Y's older sub-doc sketch in favour of the first-class
// decision).
//
// THREE RULES THIS FILE EXISTS TO ENFORCE:
//
//  1. `strict: false` + every v3 field defaulted — v2 writes this collection in production, so v3
//     may only ADD optional fields that v2 code paths can ignore (DATABASE_ARCHITECTURE.md
//     "Legacy-safe additions"). No legacy field is redefined, renamed, or removed.
//
//  2. `status` is NOT the Phase 4 governance state. v2's live enum is
//     planning|active|onhold|completed|cancelled and the running app writes it; redefining it as
//     DRAFT|SUBMITTED|... would corrupt production data. The Phase 4 record lifecycle therefore
//     lives on its own additive `recordState` field, and config/recordPolicy.js's `stateField`
//     declaration points ownership/immutability at it. Two axes, deliberately: `status` = where
//     delivery stands, `recordState` = whether the record may still be edited or deleted.
//
//  3. Legacy `div` is never coerced into a v3 division. v2's enum includes mixed-case 'Solar' and
//     a non-division 'Other'; mapping lives in config/constants.js LEGACY_DIV_MAP and anything
//     unmapped surfaces `migrationReviewRequired: true` with NO division granted — never
//     `|| [SOLAR, MEP, HVAC]` (PLAN_ENTITLEMENTS.md §11, DOCUMENT_AUTHORITY.md Ex 5).
const mongoose = require('mongoose');
const { defineModel } = require('./registry');
const { ownershipPlugin } = require('./plugins/ownershipPlugin');
const {
  DIVISION_VALUES, ALL_SUB_TRADES, PROJECT_STATUSES, RECORD_STATES,
} = require('../config/constants');

const ProjectSchema = new mongoose.Schema({
  // ---- Legacy fields, v2-owned. Declared so v3 can READ them with types; never redefined. ----
  co: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, trim: true, index: true },
  name: { type: String, trim: true },
  client: { type: String, trim: true },
  site: { type: String, trim: true },
  div: { type: String, index: true },        // legacy single division — enum NOT re-declared (v2 owns it)
  status: { type: String, enum: PROJECT_STATUSES, default: 'planning', index: true },
  start: Date,
  target: Date,
  value: { type: Number, default: 0 },
  pm: String,                                 // legacy PM NAME (string) — display only, never authz
  engs: { type: [String], default: undefined },   // legacy engineer NAMES — never user ids
  notes: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Legacy operational history. Read-only to v3 once a project is converted to package
  // architecture — v3 never duplicates these into ProjectPackage rows.
  chk: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  updates: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  dc: { type: [mongoose.Schema.Types.Mixed], default: undefined },

  // ---- v3 additive fields (ARCHITECTURE.md §H; all defaulted so v2 is unaffected) ----
  divisions: { type: [String], enum: DIVISION_VALUES, default: undefined },
  subTrades: { type: [String], enum: ALL_SUB_TRADES, default: undefined },
  projectMgrId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  accessList: { type: [mongoose.Schema.Types.ObjectId], default: undefined }, // read by middleware/projectScope.js
  budget: { type: Number, default: null },

  // Forward linkage only — the Sales, Finance and CRM modules are NOT built in this phase. These
  // fields exist so those modules can attach later without another migration of this collection.
  // `soNo` is the human Sales Order NUMBER proven by the legacy PWA; `salesOrderId` is the FK a
  // future SalesOrder collection will populate. Project -> SalesOrder -> payment milestones ->
  // Payment is the conceptual flow (BUSINESS_WORKFLOWS.md rev 9) and nothing here implements it.
  soNo: { type: String, trim: true, default: null, index: true },
  salesOrderId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  enquiryId: { type: mongoose.Schema.Types.ObjectId, default: null },

  // Phase 4 governance lifecycle — see rule 2 in the header.
  recordState: { type: String, enum: Object.values(RECORD_STATES), default: RECORD_STATES.DRAFT, index: true },

  // True once this project has been EXPLICITLY converted to package architecture, or created as a
  // multi-division v3 project. While false, a single-division legacy project is presented as ONE
  // VIRTUAL package by compat/legacyProjectPackageAdapter.js — no row is materialized, and no
  // legacy history is copied (DATABASE_ARCHITECTURE.md "Migration compatibility rule").
  packageArchitecture: { type: Boolean, default: false, index: true },
  convertedAt: { type: Date, default: null },
  convertedByUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { strict: false, collection: 'projects' });

// Ownership metadata + soft-delete triad (Phase 4). withStatus:false because `status` here is the
// legacy operational lifecycle, NOT the governance state the plugin would otherwise declare.
ProjectSchema.plugin(ownershipPlugin, { withStatus: false });

// DATABASE_ARCHITECTURE.md "Indexes (target)": Project -> co+status, co+divisions, code.
// co+status and code already exist from v2's own model against this collection; declared here too
// so a v3-only deployment is not missing them. Identical index specs are deduplicated by MongoDB.
ProjectSchema.index({ co: 1, status: 1 });
ProjectSchema.index({ co: 1, divisions: 1 });
ProjectSchema.index({ co: 1, recordState: 1 });

module.exports = defineModel('Project', ProjectSchema, 'projects');
