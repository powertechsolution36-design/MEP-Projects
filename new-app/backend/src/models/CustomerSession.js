'use strict';

const { Schema, model } = require('mongoose');

/**
 * customersessions — the server side of a client's login (owner decision,
 * 27 Oct 2026).
 *
 * Deliberately NOT the `authsessions` collection the staff use. A client's
 * token names a session id that only this collection holds, so presenting it
 * to a staff endpoint fails at the session lookup — and a staff token fails
 * the same way here. Neither side has to remember to check the other's kind;
 * they simply cannot find each other's sessions.
 */

const customerSessionSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'CustomerAccount', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'customersessions' }
);

customerSessionSchema.index({ accountId: 1 });
// Expired sessions clear themselves out; a revoked one is rejected before
// this ever matters.
customerSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('CustomerSession', customerSessionSchema);
