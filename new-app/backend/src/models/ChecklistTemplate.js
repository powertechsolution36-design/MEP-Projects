'use strict';

const { Schema, model } = require('mongoose');
const { DIVISIONS, SIGN_RESPONSIBILITIES } = require('./shared/enums');

/**
 * checklistTemplates — a reusable, division-scoped, named list of checklist
 * points that SEEDS a Project's checklist. See DATABASE_SCHEMA.md §10.
 *
 * Distinct from the executed checklist on projects.checklist — a template is
 * never the same document as a project's checklist; editing one never edits
 * the other after the copy is made. No separate legacy "templates" entity is
 * modeled (per instruction) — this collection fully replaces it.
 */

const templateItemSchema = new Schema(
  {
    text: { type: String, required: true }, // PWA FACT
    signResponsibility: { type: String, enum: SIGN_RESPONSIBILITIES, required: true }, // PWA FACT
  },
  { _id: false }
);

const checklistTemplateSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    division: { type: String, enum: DIVISIONS, required: true }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
    items: { type: [templateItemSchema], default: [] }, // PWA FACT — can start empty
    isDefault: { type: Boolean, required: true, default: false }, // PWA FACT
    // PWA FACT (as name) -> NEW BACKEND DESIGN (durable ref).
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdDate: { type: Date, required: true }, // PWA FACT
  },
  { timestamps: true, collection: 'checklistTemplates' }
);

checklistTemplateSchema.index({ companyId: 1, division: 1 });
checklistTemplateSchema.index({ companyId: 1, division: 1, isDefault: 1 });

module.exports = model('ChecklistTemplate', checklistTemplateSchema);
