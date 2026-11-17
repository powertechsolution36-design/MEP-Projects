/**
 * Pick WHICH person at a client, instead of typing their name and number.
 *
 * Owner request (17 Nov 2026): "in admin in client it will also have data of
 * admin/owner and can add multiple person under each client/company so if we
 * want to use those details in service call or in creating quotation we can
 * directly use that information to fill so it will be easy to fill."
 *
 * A client record already holds the owner (clientName, designation and the
 * main number) and up to ten more people. Until now a form could fill the
 * company's details from the client but never the PERSON, so the purchase
 * manager's name and number were still typed by hand every time.
 *
 * `peopleOf` turns any of our client-shaped records into that list — the
 * directory's clients and the AMC contracts both, since both carry a main
 * person and a `contacts` array. The main person comes first and is marked,
 * because that is the one the team means by "the client".
 *
 * Nothing here is required: a form works exactly as before if nobody is
 * picked, and a picked person can be edited afterwards like any typed text.
 */
import { useMemo } from 'react';

/** The people on a client or an AMC contract, main person first. */
export function peopleOf(client) {
  if (!client) return [];
  const out = [];
  const seen = new Set();
  const add = (name, designation, phone, main) => {
    const n = String(name || '').trim();
    const p = String(phone || '').trim();
    // Somebody with neither a name nor a number is not a person to call.
    if (!n && !p) return;
    const key = `${n.toLowerCase()}|${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, designation: String(designation || '').trim(), phone: p, main: Boolean(main) });
  };
  // A directory client calls them clientName; an AMC contract calls the same
  // person customer. Whichever this record has is the main contact.
  add(client.clientName || client.customer, client.designation, client.phone, true);
  for (const c of client.contacts || []) add(c.name, c.designation, c.phone, false);
  return out;
}

/** How a person reads on one line. */
export function personLabel(p) {
  if (!p) return '';
  return [p.name, p.designation ? `(${p.designation})` : '', p.phone ? `· ${p.phone}` : '']
    .filter(Boolean).join(' ');
}

export default function ContactPick({ client, picked, onPick, label = 'Who at the client?' }) {
  const people = useMemo(() => peopleOf(client), [client]);
  if (people.length === 0) return null;

  const same = (p) => picked && picked.name === p.name && picked.phone === p.phone;

  return (
    <div className="filter-field full-width contact-pick" style={{ marginTop: 6 }}>
      <label>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {people.map((p, i) => (
          <button
            key={`${p.name}-${p.phone}-${i}`}
            type="button"
            className={same(p) ? 'btn pri sm' : 'btn sec sm'}
            onClick={() => onPick(same(p) ? null : p)}
            title={p.phone || 'no number on file'}
          >
            {p.name || p.phone}
            {p.designation ? ` · ${p.designation}` : ''}
            {p.main ? ' ★' : ''}
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
        {picked
          ? `Filled from ${personLabel(picked)} — edit the fields below if you need to.`
          : 'Pick one to fill the name and number, or just type them.'}
      </div>
    </div>
  );
}
