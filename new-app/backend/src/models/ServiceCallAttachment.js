'use strict';

const { Schema, model } = require('mongoose');

/**
 * servicecallattachments — the photographs a client sends with a complaint
 * (owner decision, 27 Oct 2026).
 *
 * WHY its own collection rather than a field on `ServiceCall`:
 *   · a service call document is read constantly — lists, exports, the PDF —
 *     and image bytes on it would be carried through every one of those
 *     reads, for nothing;
 *   · a BSON document stops at 16 MB, which a handful of phone photographs
 *     reaches easily;
 *   · access can be decided per file, which is what serving them safely
 *     needs.
 *
 * WHY in the database at all, rather than on disk or in object storage: this
 * application has no file storage of any kind today — no multipart handling,
 * no static serving, no bucket. Adding one would mean new infrastructure and
 * a production configuration change, which this task is not allowed to make.
 * The database is where everything else already lives and is already backed
 * up. The limits below keep that honest; see PORTAL.md for what moving to
 * object storage would involve if the volume ever justifies it.
 *
 * Bytes are never served from a path a client could guess. There is no
 * public route: an attachment is read through an authenticated request that
 * re-checks who is asking.
 */

const ALLOWED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB per image
const MAX_PER_CALL = 5;

const serviceCallAttachmentSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    serviceCallId: { type: Schema.Types.ObjectId, ref: 'ServiceCall', required: true },

    // Exactly one of these is set, so it is always clear who put the file here.
    customerAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerAccount', default: null },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // A name of the server's choosing. What the browser called the file is
    // never used to build a path or a response header.
    filename: { type: String, required: true },
    contentType: { type: String, enum: ALLOWED_TYPES, required: true },
    bytes: { type: Number, required: true, min: 1, max: MAX_BYTES },
    data: { type: Buffer, required: true },
  },
  { timestamps: true, collection: 'servicecallattachments' }
);

serviceCallAttachmentSchema.index({ companyId: 1, serviceCallId: 1, createdAt: 1 });

module.exports = model('ServiceCallAttachment', serviceCallAttachmentSchema);
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
module.exports.MAX_BYTES = MAX_BYTES;
module.exports.MAX_PER_CALL = MAX_PER_CALL;
