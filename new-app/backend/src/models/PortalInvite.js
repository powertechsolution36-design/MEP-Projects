'use strict';

const { Schema, model } = require('mongoose');

/**
 * portalinvites — a client's own link to the service portal (owner decision,
 * 31 Oct 2026).
 *
 * THE PROBLEM IT SOLVES: registration matches a client by the mobile number
 * on their AMC contract. A client who registers from a different number — a
 * new phone, a colleague's, the office line — matches nothing, lands with no
 * company, and was invisible to staff. An invite carries the identity, so
 * the number no longer has to.
 *
 * WHAT IT IS AND IS NOT: the link says WHO is registering. It does NOT
 * activate the account. A registration through an invite still arrives
 * Pending and still needs a member of staff to approve it, exactly as the
 * owner asked. That distinction is the whole security model: a link that
 * activated by itself would hand the client's account — their projects,
 * their service history — to whoever the link was forwarded to, and these
 * links are meant to be sent over WhatsApp and kept.
 *
 * WHY IT DOES NOT EXPIRE: the owner wants to re-send it from the client's
 * record months later. So it lives as long as the record does. Two things
 * keep that safe: approval (above), and `usedByAccountId` — once an account
 * has been created through an invite, a second registration on the same link
 * is refused rather than quietly making a rival login. Staff can revoke one
 * at any time, and mint a fresh one.
 */

const portalInviteSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },

    // The unguessable half of the link. 24 random bytes, as the quotation
    // and AMC-letter public links already use.
    token: { type: String, required: true },

    // What the holder is being invited AS. At least one of these is set:
    // the AMC/Warranty record, the projects, or both.
    contractId: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
    projectIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },

    // Shown to the person opening the link, so they can see it is meant for
    // them before they type anything. Copied at mint time: an invite is a
    // record of what was sent, not a live view of the contract.
    customerName: { type: String, default: '' },
    site: { type: String, default: '' },

    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Set when a registration comes through this link. A second one is
    // refused while this is set.
    usedByAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerAccount', default: null },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'portalinvites' }
);

// The link is looked up by token alone — it has to be, the person opening it
// has no session and names no company.
portalInviteSchema.index({ token: 1 }, { unique: true });
portalInviteSchema.index({ companyId: 1, contractId: 1 });
portalInviteSchema.index({ companyId: 1, projectIds: 1 });

module.exports = model('PortalInvite', portalInviteSchema);
