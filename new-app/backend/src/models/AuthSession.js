'use strict';

const { Schema, model } = require('mongoose');

/**
 * authSessions — NEW, ADDITIVE collection, introduced by THIS task
 * (authentication foundation), not part of DATABASE_SCHEMA.md's 15 approved
 * business collections. DATABASE_SCHEMA.md explicitly deferred authentication
 * design entirely ("Security Design ... documented as requirement — NOT
 * implemented in this step"); this collection is the schema-level home for
 * that now-implemented design and does not modify, redesign, or duplicate
 * Company/User or any of the 15 approved collections.
 *
 * Backs the signed-token logout/invalidation strategy: a JWT's `sid` claim
 * points at one of these documents. The token is valid only while its
 * signature/exp check out AND the referenced session here is un-revoked and
 * unexpired — this is what makes server-side logout possible with a
 * stateless-looking JWT.
 */

const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Nullable: role=super sessions are not scoped to a single company.
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    role: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'authSessions' }
);

authSessionSchema.index({ userId: 1 });
authSessionSchema.index({ expiresAt: 1 });

module.exports = model('AuthSession', authSessionSchema);
