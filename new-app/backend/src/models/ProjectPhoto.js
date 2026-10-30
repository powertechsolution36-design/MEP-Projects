'use strict';

const { Schema, model } = require('mongoose');

/**
 * projectphotos — photographs of the work done on a project (owner decision,
 * 30 Oct 2026).
 *
 * WHY its own collection, and not `photos: [String]` on the project:
 *   · the project document is read constantly — the list, the CSV export,
 *     the report, the client portal — and image bytes on it would be dragged
 *     through every one of those reads for nothing;
 *   · a BSON document stops at 16 MB, which a handful of site photographs
 *     from a phone reaches easily, and a project collects them for months;
 *   · access can then be decided per file, which is what serving them to a
 *     client safely needs.
 *
 *   (`checklist[].photos` stores data URIs inline on the project. That is
 *   existing behaviour and is left alone, but it is the pattern this
 *   deliberately does NOT repeat.)
 *
 * WHY in the database: the application still has no file storage of any kind
 * — no multipart handling, no static serving, no bucket — and adding one
 * means new infrastructure and a production change. This mirrors
 * ServiceCallAttachment, which made the same call for the same reason.
 *
 * WHAT A PHOTOGRAPH BELONGS TO: one execution update. "Here is what we did
 * on this date, and here are the pictures" is how the work is actually
 * reported, and it means there is ONE switch deciding whether a client can
 * see it — the update's `sharedWithCustomer`. A photograph cannot be visible
 * while the words beside it are private, because there is no second flag to
 * fall out of step.
 *
 * Bytes are never served from a path anyone can guess: there is no public
 * route, and every read re-checks who is asking.
 */

const ALLOWED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024;   // 3 MB per photograph, as for complaints
const MAX_PER_UPDATE = 6;            // one update's worth of site pictures
const MAX_PER_PROJECT = 200;         // a long job's worth, not a photo library

const projectPhotoSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },

    // The position of the execution update in `project.executionUpdates`.
    // That array is append-only (see Project.js), so an index stays pointing
    // at the same update for the life of the project.
    updateIndex: { type: Number, required: true, min: 0 },

    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // What the photograph shows, in the words staff typed. Shown to the
    // client when the update it belongs to is shared.
    caption: { type: String, default: '', trim: true, maxlength: 200 },

    // A name of the server's choosing. What the browser called the file is
    // never used to build a path or a response header.
    filename: { type: String, required: true },
    contentType: { type: String, enum: ALLOWED_TYPES, required: true },
    bytes: { type: Number, required: true, min: 1, max: MAX_BYTES },
    data: { type: Buffer, required: true },
  },
  { timestamps: true, collection: 'projectphotos' }
);

projectPhotoSchema.index({ companyId: 1, projectId: 1, updateIndex: 1, createdAt: 1 });

/**
 * What this collection will accept, decided by the BYTES — never by what the
 * upload claimed to be. A .jpg that is really a script, or a PNG header on a
 * file declared as JPEG, is refused here.
 *
 * It lives on the model because the model is what owns the definition of a
 * valid photograph; ServiceCallAttachment makes the same judgement for
 * complaint photographs and keeps its own copy of it in portalService.
 */
function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF'
    && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Turn one `data:` URI into the fields this collection stores, or say
 * exactly why it cannot. Throws a plain Error carrying `code`; the service
 * layer turns that into a ServiceError, so this file needs no knowledge of
 * how the application reports failures.
 */
function decodePhoto(input, index = 0) {
  const fail = (message, code) => { const e = new Error(message); e.code = code; throw e; };
  const raw = typeof input === 'string' ? input : (input && input.data);
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(raw || '').trim());
  if (!m) fail(`Photograph ${index + 1} is not an image.`, 'INVALID_IMAGE');

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { fail(`Photograph ${index + 1} could not be read.`, 'INVALID_IMAGE'); }
  if (!buf.length) fail(`Photograph ${index + 1} is empty.`, 'INVALID_IMAGE');
  if (buf.length > MAX_BYTES) {
    fail(`Each photograph must be under ${Math.floor(MAX_BYTES / (1024 * 1024))} MB.`, 'IMAGE_TOO_LARGE');
  }

  const actual = sniffImageType(buf);
  if (!actual || !ALLOWED_TYPES.includes(actual)) {
    fail(`Photograph ${index + 1} is not a JPEG, PNG or WebP image.`, 'UNSUPPORTED_IMAGE');
  }

  const ext = actual === 'image/jpeg' ? 'jpg' : actual === 'image/png' ? 'png' : 'webp';
  return {
    // The server names the file. Nothing the browser sent reaches a path or
    // a response header.
    filename: `project-${Date.now()}-${index + 1}.${ext}`,
    contentType: actual,
    bytes: buf.length,
    data: buf,
  };
}

module.exports = model('ProjectPhoto', projectPhotoSchema);
module.exports.sniffImageType = sniffImageType;
module.exports.decodePhoto = decodePhoto;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
module.exports.MAX_BYTES = MAX_BYTES;
module.exports.MAX_PER_UPDATE = MAX_PER_UPDATE;
module.exports.MAX_PER_PROJECT = MAX_PER_PROJECT;
