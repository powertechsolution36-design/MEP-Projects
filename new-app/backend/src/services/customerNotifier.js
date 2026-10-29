'use strict';

/**
 * Telling a client what happened to their complaint (owner decision,
 * 27 Oct 2026).
 *
 * THE STATE OF PLAY, stated plainly because it is easy to assume otherwise:
 * this application cannot send a WhatsApp message. It has no WhatsApp
 * Business API account, no provider, no credentials and no approved
 * templates. Every WhatsApp feature in the app today is a `wa.me` link that
 * a person taps on the phone holding the company number — which is how the
 * owner chose to work on 22 Oct 2026.
 *
 * So this module is the boundary and nothing more. It decides WHAT would be
 * said and to WHOM, hands it to whatever provider is configured, and does
 * nothing at all when none is — which is the shipped state. No message has
 * been delivered through it and none is claimed to have been.
 *
 * To turn it on, someone must: open a WhatsApp Business API account (Meta
 * Cloud API direct, or an Indian BSP), verify a sender number, get each
 * template below approved, and write a provider that implements `send`.
 * Note the cost of that decision: a number moved onto the Business API stops
 * working as ordinary WhatsApp on a phone, and the company number is how
 * AMC letters and service reports go out today. PORTAL.md spells this out.
 *
 * The events are recorded whether or not anything can send them, so turning
 * a provider on later is a configuration change, not a code change.
 */

/** Every message this feature would ever send, and the template each needs. */
const EVENTS = Object.freeze({
  COMPLAINT_REGISTERED: 'complaint_registered',
  ENGINEER_ASSIGNED: 'engineer_assigned',
  APPOINTMENT_SET: 'appointment_set',
  COMPLAINT_COMPLETED: 'complaint_completed',
  ACCOUNT_APPROVED: 'account_approved',
});

/**
 * The provider that does nothing — and says so. This is what runs in
 * production until someone configures a real one.
 */
const noopProvider = {
  name: 'none',
  configured: false,
  async send() {
    return { delivered: false, reason: 'NO_PROVIDER_CONFIGURED' };
  },
};

function buildMessage(event, ctx) {
  const ref = ctx.complaintNumber ? `PSC-${ctx.complaintNumber}` : '';
  switch (event) {
    case EVENTS.COMPLAINT_REGISTERED:
      return `Dear ${ctx.customer || 'Customer'}, we have registered your complaint ${ref}. Our team will contact you shortly.`;
    case EVENTS.ENGINEER_ASSIGNED:
      return `Dear ${ctx.customer || 'Customer'}, ${ctx.engineerName || 'an engineer'} has been assigned to your complaint ${ref}.`;
    case EVENTS.APPOINTMENT_SET:
      return `Dear ${ctx.customer || 'Customer'}, your service visit for ${ref} is scheduled for ${ctx.appointmentText || 'the agreed date'}.`;
    case EVENTS.COMPLAINT_COMPLETED:
      return `Dear ${ctx.customer || 'Customer'}, your complaint ${ref} has been completed. Thank you for your business.`;
    case EVENTS.ACCOUNT_APPROVED:
      return `Dear ${ctx.customer || 'Customer'}, your service portal account is now active.`;
    default:
      return '';
  }
}

/**
 * Record that something happened and offer it to the provider.
 *
 * Never throws: a complaint must be registered, an engineer must be
 * assigned, whatever the messaging channel is doing. The caller's work is
 * not the provider's to fail.
 *
 * @returns {Promise<{event:string, to:string, delivered:boolean, reason?:string}>}
 */
async function notifyCustomer(event, ctx, deps = {}, { logger = console } = {}) {
  const provider = deps.whatsappProvider || noopProvider;
  const to = String((ctx && ctx.phone) || '').replace(/\D/g, '');
  const text = buildMessage(event, ctx || {});

  if (!to || !text) {
    return { event, to: '', delivered: false, reason: 'NO_RECIPIENT' };
  }
  // Only ever to the number on the client's own contract. Nothing a client
  // or a request supplied reaches this.
  if (!provider.configured) {
    return { event, to, delivered: false, reason: 'NO_PROVIDER_CONFIGURED' };
  }

  try {
    const res = await provider.send({ to, text, event, templateName: event });
    return { event, to, delivered: Boolean(res && res.delivered), reason: res && res.reason };
  } catch (err) {
    // The provider's failure is noted and dropped. Never the secret, never
    // the message body.
    logger.warn(`[customerNotifier] ${event} could not be delivered: ${err.code || err.name || 'error'}`);
    return { event, to, delivered: false, reason: 'PROVIDER_ERROR' };
  }
}

module.exports = { EVENTS, buildMessage, notifyCustomer, noopProvider };
