/**
 * What stops a quotation being saved, in words the person can act on.
 *
 * The quotation forms used to rely on the browser's own `required` checks.
 * When one of those fails the browser refuses to submit and shows a small
 * bubble — and inside the Android app's web view, or when the field has been
 * scrolled out of sight, that bubble is never seen: the Save button simply
 * appears to do nothing. The forms now carry `noValidate` and call this
 * instead, so there is always a message on screen.
 *
 * Returns an empty string when the quotation can be saved.
 */
export function quotationProblem(form) {
  const f = form || {};
  if (!String(f.division || '').trim()) return 'Choose a division before saving.';
  if (!String(f.customerName || '').trim()) return 'Enter the customer name before saving.';
  return '';
}

export default quotationProblem;
