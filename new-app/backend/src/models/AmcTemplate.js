'use strict';

const { Schema, model } = require('mongoose');

/**
 * amctemplates — document templates for Comprehensive AMC,
 * Non-Comprehensive AMC, and AMC Letter generation.
 *
 * Source wording is preserved exactly from the reference documents
 * (directive sections 27-29, 33). Corrections require explicit
 * user approval.
 *
 * Templates are company-scoped (or global with companyId=null).
 */

const templateSectionSchema = new Schema(
  {
    key: { type: String, required: true },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const amcTemplateSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      default: null, // null = system default
    },
    type: {
      type: String,
      enum: ['comprehensive', 'non-comprehensive', 'amc-letter'],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    version: { type: Number, default: 1 },
    sections: { type: [templateSectionSchema], default: [] },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'amctemplates' }
);

amcTemplateSchema.index({ companyId: 1, type: 1, isDefault: 1 });

module.exports = model('AmcTemplate', amcTemplateSchema);
