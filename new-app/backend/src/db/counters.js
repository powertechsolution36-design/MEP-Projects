'use strict';

const { Counter, COUNTER_NAMES } = require('../models/Counter');

/**
 * Atomically returns the next value of a per-company business sequence.
 *
 * Uses findOneAndUpdate + $inc with upsert, MongoDB's standard
 * concurrency-safe counter pattern — replacing the PWA's non-safe
 * single-device `DB.seq.*` `x++` increment (DATABASE_SCHEMA.md "Sequences").
 *
 * This helper is schema-layer plumbing only; no route/controller invokes it
 * in this phase.
 *
 * @param {import('mongoose').Types.ObjectId|string} companyId
 * @param {'salesOrder'|'serviceCall'} name
 * @returns {Promise<number>} the newly incremented sequence value
 */
async function getNextSequence(companyId, name) {
  if (!COUNTER_NAMES.includes(name)) {
    throw new Error(
      `Unknown counter name "${name}". Only ${COUNTER_NAMES.join(', ')} are true business sequences (DATABASE_SCHEMA.md).`
    );
  }
  const doc = await Counter.findOneAndUpdate(
    { companyId, name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  return doc.value;
}

module.exports = { getNextSequence };
