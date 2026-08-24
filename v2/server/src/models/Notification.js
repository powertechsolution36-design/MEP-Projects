const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  co: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  title: String,
  body: String,
  type: { type: String, default: 'info' },
  link: String,
  roles: { type: [String], default: ['*'] },
  read: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

NotificationSchema.index({ co: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
