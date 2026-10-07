'use strict';

const { Schema, model } = require('mongoose');

/**
 * counters — concurrency-safe, per-company business sequences.
 *
 * DATABASE_SCHEMA.md "Sequences" section: only two PWA fields are genuine
 * externally-meaningful, human-facing sequences:
 *   - salesOrders.orderNumber ("SO-<n>")
 *   - serviceCalls.complaintNumber ("PSC-<n>")
 *
 * NEW BACKEND DESIGN: the PWA's in-memory `DB.seq.*` `x++` pattern is not
 * concurrency-safe and is replaced by this collection, incremented via an
 * atomic findOneAndUpdate/$inc (see getNextSequence in src/db/counters.js).
 * This is schema-level only — no route/controller calls it yet.
 */

const COUNTER_NAMES = Object.freeze(['salesOrder', 'serviceCall']);

const counterSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    name: {
      type: String,
      required: true,
      enum: COUNTER_NAMES,
    },
    value: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true, collection: 'counters' }
);

counterSchema.index({ companyId: 1, name: 1 }, { unique: true });

const Counter = model('Counter', counterSchema);

module.exports = { Counter, COUNTER_NAMES };
