'use strict';

const { Schema } = require('mongoose');

/**
 * One person at a client: a name, what they do there, and a number.
 *
 * Owner request (5 Nov 2026): "while adding new enquiries or client there is
 * only option to add project name and contact no. Need option to add multiple
 * contact numbers with name and designation." A site has a purchase manager,
 * a maintenance in-charge and an owner, and the team was keeping the other
 * two in the remark box or not at all.
 *
 * The single `phone` field each record already had is untouched: it stays
 * the client's main number, the one WhatsApp and the dialler use, and it is
 * filled from the first contact when it was left blank. This list is the
 * rest of the people, and nothing reads it as the main number.
 */
const contactPersonSchema = new Schema(
  {
    name: { type: String },
    designation: { type: String },
    phone: { type: String },
  },
  { _id: false }
);

/** Enough for any site the team deals with, few enough to stay a list. */
const MAX_CONTACTS = 10;

function maxContacts(arr) {
  return !arr || arr.length <= MAX_CONTACTS;
}

module.exports = { contactPersonSchema, maxContacts, MAX_CONTACTS };
