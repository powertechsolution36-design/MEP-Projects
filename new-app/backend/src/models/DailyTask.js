'use strict';

const { Schema, model } = require('mongoose');

const dailyTaskSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, immutable: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    taskDate: { type: Date, required: true },
    assignedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    assignedByName: { type: String, required: true, immutable: true },
    assigneeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    assigneeName: { type: String, required: true, immutable: true },
    assigneeRole: { type: String, enum: ['engineer', 'service_eng'], required: true, immutable: true },
    status: { type: String, enum: ['Assigned', 'AwaitingReview', 'Approved'], default: 'Assigned', required: true },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
  },
  { timestamps: true, collection: 'dailyTasks' }
);

dailyTaskSchema.index({ companyId: 1, assigneeUserId: 1, taskDate: 1, status: 1 });
dailyTaskSchema.index({ companyId: 1, status: 1, taskDate: 1 });

module.exports = model('DailyTask', dailyTaskSchema);
