/**
 * WhatsApp click-to-chat links.
 *
 * wa.me needs the full international number with no "+", spaces or leading
 * zero. Numbers in this app are usually stored the way people type them — a
 * 10-digit Indian mobile, sometimes with a 0 or +91 in front — and a bare
 * 10-digit number makes wa.me open nothing at all. So: digits only, any
 * trunk "0" removed, and 91 added to a 10-digit number.
 *
 * Who sends it: a link opens WhatsApp on the device that taps it, and the
 * message goes from whatever WhatsApp number is logged in there. That is why
 * client-facing Send buttons are shown to the service manager / admin, whose
 * device holds the company number (owner decision, 22 Oct 2026).
 */

export const DEFAULT_COUNTRY_CODE = '91';

export function waNumber(phone, countryCode = DEFAULT_COUNTRY_CODE) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^0+/, '');
  if (d.length === 10) d = countryCode + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

export function whatsappUrl(phone, text) {
  const n = waNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text || '')}`;
}

/** "7447333377" → "+91 74473 33377", for showing which number to send from. */
export function displayNumber(phone) {
  const n = waNumber(phone);
  if (!n) return String(phone || '');
  if (n.startsWith('91') && n.length === 12) return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  return `+${n}`;
}

/** Roles whose device holds the company WhatsApp number. */
export const SENDER_ROLES = ['admin', 'service_mgr'];

export function canSendToClients(role) {
  return SENDER_ROLES.includes(role);
}
