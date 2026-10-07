'use strict';

const { Schema, model } = require('mongoose');
const { ROLES } = require('./shared/enums');

/**
 * users — one login per person, one role, belongs to exactly one company
 * (except role=super). See DATABASE_SCHEMA.md §2 and its
 * "User Reference Migration" subsection.
 *
 * Uniqueness scope (companyId+username vs. global) is a NEW BACKEND DESIGN
 * DECISION, not a PWA rule (OPEN_DECISIONS.md #12) — this schema proposes
 * the per-company scope as the safer default, per DATABASE_SCHEMA.md §2.
 */

const userSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: function () {
        return this.role !== 'super';
      },
    }, // PWA FACT
    name: { type: String, required: true }, // PWA FACT
    role: { type: String, enum: ROLES, required: true }, // PWA FACT
    username: { type: String, required: true }, // PWA FACT
    // NEW BACKEND DESIGN — replaces the PWA's plaintext `pw`. Plaintext
    // passwords must never be stored, logged, or displayed.
    passwordHash: { type: String, required: true },
    // NEW BACKEND DESIGN — proposed, not mandatory; the PWA has no deactivate
    // state, only hard delete (delUser). UNSPECIFIED BY PWA whether needed.
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.index({ companyId: 1, role: 1 });
// NEW BACKEND DESIGN DECISION (not a PWA rule) — see OPEN_DECISIONS.md #12.
userSchema.index({ companyId: 1, username: 1 }, { unique: true });

module.exports = model('User', userSchema);
