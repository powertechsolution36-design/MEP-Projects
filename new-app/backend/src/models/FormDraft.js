'use strict';

const { Schema, model } = require('mongoose');

/**
 * formdrafts — a half-filled form someone saved to finish later.
 *
 * Owner request (14 Nov 2026): "add save as draft option" on the quotation
 * and the sales order.
 *
 * A draft is NOT the record it will become. Nothing is numbered and nothing
 * downstream exists while it sits here: a quotation draft holds no QTN
 * number, and a sales order draft raises no project, no payment records and
 * no notifications. All of that happens when the form is finally submitted,
 * exactly as it does for a form filled in one sitting -- so an abandoned
 * draft leaves no gap in the numbering and no orphan records behind it.
 *
 * The payload is whatever the form screen puts in it, kept opaque on
 * purpose: the form's shape is the frontend's business, and a draft is only
 * ever read back by the same screen that wrote it.
 */

const formDraftSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    // Whose draft it is. Another person's half-finished form is not theirs
    // to finish, so only the owner (and the company's admin) sees it.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    kind: { type: String, enum: ['quotation', 'salesOrder'], required: true },
    // What to call it in the list -- the customer or the project name, as
    // far as the form had got. Blank is fine; the list falls back to a date.
    label: { type: String, default: '' },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'formdrafts' }
);

formDraftSchema.index({ companyId: 1, kind: 1, userId: 1, updatedAt: -1 });

module.exports = model('FormDraft', formDraftSchema);
