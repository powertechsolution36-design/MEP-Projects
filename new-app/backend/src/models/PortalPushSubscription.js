'use strict';

const { Schema, model } = require('mongoose');

/**
 * portalPushSubscriptions — a client's phone, registered to receive
 * notifications from the customer app (owner decision, 31 Oct 2026).
 *
 * This is Web Push, not the Expo push the staff Android app uses: the
 * customer app is the portal added to the home screen, so the subscription
 * is minted by the browser and belongs to one browser on one device. A
 * client with a phone and a laptop has two rows; signing out removes the
 * row for the device signed out of, and nothing else.
 *
 * `endpoint` is the push service's own URL for that device and is unique by
 * itself — it is the identity. The keys beside it are what the payload is
 * encrypted to, so a push service that relays the message can never read it.
 */
const portalPushSubscriptionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    contractId: { type: Schema.Types.ObjectId, ref: 'Contract', required: true },
    customerAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerAccount', required: true },
    endpoint: { type: String, required: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    // Only ever for support ("which phone is this?"), never shown to a client.
    userAgent: { type: String, default: '' },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'portalPushSubscriptions' }
);

portalPushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
portalPushSubscriptionSchema.index({ companyId: 1, contractId: 1 });

module.exports = model('PortalPushSubscription', portalPushSubscriptionSchema);
