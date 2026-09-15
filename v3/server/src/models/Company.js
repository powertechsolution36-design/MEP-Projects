// v3-side READ model of the same `companies` collection v2 owns.
// `divs[]` is read for legacy-display purposes only — NEVER treated as an entitlement grant
// (see v3/docs/BUILD_BASELINE.md §12, item 2, and DOCUMENT_AUTHORITY.md's entitlement precedence).
const mongoose = require('mongoose');
const { defineModel } = require('./registry');

const CompanySchema = new mongoose.Schema({
  name: String,
  code: String,
  divs: { type: [String] },                 // legacy field — read-only signal, never a grant
  disabled: { type: Boolean, default: false, index: true },
  entitlements: { type: mongoose.Schema.Types.Mixed },   // v3-additive CACHE only — see DOCUMENT_AUTHORITY.md
  settings: {
    enforceEntitlements: { type: mongoose.Schema.Types.Mixed, default: false },
    uiVersion: { type: String, default: 'v2' },
    migrationReviewRequired: { type: Boolean, default: false },
  },
}, { strict: false, collection: 'companies', timestamps: true });

module.exports = defineModel('Company', CompanySchema, 'companies');
