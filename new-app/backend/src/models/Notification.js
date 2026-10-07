'use strict';

const { Schema, model } = require('mongoose');

/**
 * notifications — in-app, role/company-targeted messages generated as a
 * side effect of nearly every business action. See DATABASE_SCHEMA.md §9.
 *
 * Targeting is always a role-list or the literal "*" all-roles marker —
 * never an arbitrary individual user pick (verified against notify()/myNotifs()).
 * No SMS/email/push delivery is designed here — the PWA has none.
 */

const notificationSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true }, // PWA FACT
    text: { type: String, required: true }, // PWA FACT
    date: { type: Date, required: true }, // PWA FACT
    // "*" is a literal, documented value meaning "every role in the company".
    targetRoles: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'A notification needs at least one target role (or "*").',
      },
    },
    readByUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] }, // PWA FACT — append-only
  },
  { timestamps: true, collection: 'notifications' }
);

notificationSchema.index({ companyId: 1, targetRoles: 1, date: -1 });

module.exports = model('Notification', notificationSchema);
