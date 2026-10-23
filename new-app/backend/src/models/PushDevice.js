'use strict';

const { Schema, model } = require('mongoose');

/**
 * push_devices — phones that receive push notifications (owner decision,
 * 21 Oct 2026). One row per Expo push token; the token moves to whichever
 * user last logged in on that phone, and is removed on logout or when Expo
 * reports the device as no longer registered.
 */
const pushDeviceSchema = new Schema(
  {
    token: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    platform: { type: String, enum: ['android', 'ios'], default: 'android' },
  },
  { timestamps: true, collection: 'pushDevices' }
);

pushDeviceSchema.index({ token: 1 }, { unique: true });
pushDeviceSchema.index({ companyId: 1, userId: 1 });

module.exports = model('PushDevice', pushDeviceSchema);
