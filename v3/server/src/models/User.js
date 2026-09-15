// v3-side READ model of the same `users` collection v2 owns and writes.
// `strict: false` deliberately — v3 must never impose its own validation on a collection it does
// not own the write path for in this foundation phase. Only the fields v3's auth/authorization
// layer actually needs are declared.
const mongoose = require('mongoose');
const { defineModel } = require('./registry');

const UserSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, index: true },
  un: { type: String, index: true },
  name: String,
  role: { type: String, index: true },          // legacy flat role — still authoritative fallback
  designation: { type: String, index: true },     // v3-preferred field, per ROLE_HIERARCHY.md
  department: { type: String, index: true },
  division: { type: String, index: true },
  jobTitle: String,                                // v3-additive, display only — never used for authz
  disabled: { type: Boolean, default: false, index: true },
  permissions: { type: [String], default: undefined },  // v3-additive (UserPermissionOverride replaces this in a later phase)
  projectAccess: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
}, { strict: false, collection: 'users', timestamps: true });

// Never allow `pw` to leak through a v3 .lean()/.toJSON() read even though strict:false would
// otherwise pass it through from the underlying document.
UserSchema.set('toJSON', {
  transform(_doc, ret) { delete ret.pw; return ret; },
});

module.exports = defineModel('User', UserSchema, 'users');
