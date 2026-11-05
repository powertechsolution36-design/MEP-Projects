'use strict';

const { ServiceError } = require('../../errors');
const { MAX_CONTACTS } = require('../../models/shared/contactSchema');

/**
 * Validates and tidies a list of people at a client (owner request,
 * 5 Nov 2026 — see models/shared/contactSchema.js for why it exists).
 *
 * A row with nothing in it at all is dropped rather than rejected: the form
 * always offers a blank row to type into, and submitting it untouched should
 * not be an error. A row that has a number or a designation but no name is
 * rejected, because an unnamed number on a client record is worse than none.
 *
 * `undefined` means "the caller did not mention contacts", and the answer is
 * undefined too so an edit can leave an existing list alone.
 */
function buildContacts(input) {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new ServiceError('Contacts must be a list.', 'VALIDATION_ERROR', 400);
  }
  const out = [];
  for (const row of input) {
    const name = row && typeof row.name === 'string' ? row.name.trim() : '';
    const designation = row && typeof row.designation === 'string' ? row.designation.trim() : '';
    const phone = row && typeof row.phone === 'string' ? row.phone.trim() : '';
    if (!name && !designation && !phone) continue;
    if (!name) {
      throw new ServiceError('Every contact needs a name.', 'VALIDATION_ERROR', 400);
    }
    out.push({
      name: name.slice(0, 120),
      designation: designation.slice(0, 120),
      phone: phone.slice(0, 40),
    });
  }
  if (out.length > MAX_CONTACTS) {
    throw new ServiceError(`At most ${MAX_CONTACTS} contacts can be listed.`, 'VALIDATION_ERROR', 400);
  }
  return out;
}

/**
 * The main number, which is still a single field on the record. A number
 * typed into the main field wins; otherwise the first contact who has one
 * fills it, so a record entered through the contact list alone is still
 * dialable from every screen that reads `phone`.
 */
function primaryPhone(phone, contacts) {
  const typed = typeof phone === 'string' ? phone.trim() : phone;
  if (typed) return typed;
  const withNumber = (contacts || []).find((c) => c && c.phone);
  return withNumber ? withNumber.phone : '';
}

module.exports = { buildContacts, primaryPhone };
