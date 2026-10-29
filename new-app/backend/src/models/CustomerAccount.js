'use strict';

const { Schema, model } = require('mongoose');

/**
 * customeraccounts — a login for the company's OWN client (owner decision,
 * 27 Oct 2026).
 *
 * WHY a separate collection, not a twelfth role on `users`:
 *   · `users` are staff. Everything downstream — roleMiddleware, division
 *     entitlements, menus, notifications, assignment — assumes a staff role,
 *     and verifySession re-reads `users` on every request. Putting clients
 *     there would make every one of those checks answer a question it was
 *     never asked.
 *   · Keeping clients out of `users` means a client's token can never satisfy
 *     staff authentication: its session lives in `customersessions`, which
 *     the staff session store knows nothing about. The isolation is a
 *     property of the data, not of a condition someone must remember to
 *     write.
 *
 * WHAT a client account is attached to: a `Contract` — the AMC or Warranty
 * record. That is the only durable customer record this application has;
 * `customer` everywhere else is free text typed per document. The contract
 * already carries the client's name, phone, site and whole service history.
 *
 * A registration is never trusted on its own. It arrives `Pending`, matched
 * to a contract by phone number only when exactly one contract matches, and
 * an authorized member of staff decides whether it becomes `Active`. A
 * registrant can never name the company or the contract they want.
 */

const STATUSES = Object.freeze(['Pending', 'Active', 'Rejected', 'Disabled']);

const customerAccountSchema = new Schema(
  {
    // The tenant whose client this is. Set by the server from the matched
    // contract — never from anything the registrant sent.
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    // The client record this login speaks for. Null while a registration
    // could not be matched to exactly one contract; staff set it on approval.
    contractId: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },

    // Digits only, country code included (see portalAuthService.normalizePhone).
    phone: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    passwordHash: { type: String, required: true },

    status: { type: String, enum: STATUSES, required: true, default: 'Pending' },

    // What the registrant typed, kept so staff can see what they claimed
    // even when it matched nothing.
    claimedSite: { type: String, default: '' },
    // Why the match was not automatic: 'matched' | 'no-match' | 'ambiguous'.
    matchResult: { type: String, default: 'no-match' },

    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'customeraccounts' }
);

// One account per phone number, full stop — a second registration on the same
// number is refused rather than quietly creating a rival login.
customerAccountSchema.index({ phone: 1 }, { unique: true });
customerAccountSchema.index({ companyId: 1, status: 1 });
customerAccountSchema.index({ companyId: 1, contractId: 1 });

module.exports = model('CustomerAccount', customerAccountSchema);
module.exports.STATUSES = STATUSES;
