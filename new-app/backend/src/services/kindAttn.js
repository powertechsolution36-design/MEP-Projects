'use strict';

/**
 * "Kind Attn: <name>, <designation>" — the one line that says WHICH person
 * at the client a document is for.
 *
 * Owner request (17 Nov 2026): a client record holds the owner and up to ten
 * more people, and a form can now fill from any of them. This is how the
 * chosen person reads on the printed quotation and on the service report.
 *
 * It lives on its own, away from either PDF, for two reasons: the two
 * documents must word it identically, and a line of text can be tested for
 * what it says. The PDFs themselves are tested only for being real PDFs —
 * their text is drawn with subset fonts, so it cannot be read back out.
 *
 * Returns '' when nobody was picked, and the callers print nothing at all in
 * that case: a document raised before this, or without choosing anyone,
 * reads exactly as it always did rather than carrying an empty field.
 */
function kindAttn(name, designation) {
  const n = String(name || '').trim();
  if (!n) return '';
  const d = String(designation || '').trim();
  return d ? `${n}, ${d}` : n;
}

module.exports = { kindAttn };
