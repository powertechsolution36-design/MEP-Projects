import { useId } from 'react';

/**
 * The people at a client: a name, what they do there, and a number each.
 *
 * Owner request (5 Nov 2026): "while adding new enquiries or client there is
 * only option to add project name and contact no. Need option to add multiple
 * contact numbers with name and designation." A site has a purchase manager,
 * a maintenance in-charge and an owner; the team was keeping the other two in
 * the remark box or losing them altogether.
 *
 * The record's single Phone field is left exactly where it was — it is the
 * main number, the one WhatsApp and the dialler use. This list is everybody
 * else. The server fills a blank main number from the first contact who has
 * one, so a record entered through this list alone is still dialable.
 *
 * `value` is an array of { name, designation, phone }; `onChange` is handed
 * the next array. A row is removed with its own Remove button; a wholly blank
 * row is simply ignored when the form is saved.
 */
const MAX_CONTACTS = 10;
const BLANK = { name: '', designation: '', phone: '' };

export default function ContactsField({ value, onChange, label = 'Contacts at this client' }) {
  const rows = Array.isArray(value) ? value : [];
  const baseId = useId();

  function setRow(i, key, v) {
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: v } : r)));
  }
  function addRow() {
    if (rows.length >= MAX_CONTACTS) return;
    onChange([...rows, { ...BLANK }]);
  }
  function removeRow(i) {
    onChange(rows.filter((_, n) => n !== i));
  }

  return (
    <fieldset className="contacts-field">
      <legend>{label}</legend>
      <p className="muted contacts-hint">
        Name and designation of each person at the site — purchase, maintenance, owner.
        Leave it empty if there is only the one number above.
      </p>

      {rows.length > 0 && (
        <ul className="contacts-rows">
          {rows.map((r, i) => (
            <li key={i} className="contacts-row">
              <div className="filter-field">
                <label htmlFor={`${baseId}-n-${i}`}>Name</label>
                <input
                  id={`${baseId}-n-${i}`}
                  value={r.name || ''}
                  onChange={(e) => setRow(i, 'name', e.target.value)}
                />
              </div>
              <div className="filter-field">
                <label htmlFor={`${baseId}-d-${i}`}>Designation</label>
                <input
                  id={`${baseId}-d-${i}`}
                  value={r.designation || ''}
                  onChange={(e) => setRow(i, 'designation', e.target.value)}
                  placeholder="Purchase Manager"
                />
              </div>
              <div className="filter-field">
                <label htmlFor={`${baseId}-p-${i}`}>Phone</label>
                <input
                  id={`${baseId}-p-${i}`}
                  inputMode="tel"
                  value={r.phone || ''}
                  onChange={(e) => setRow(i, 'phone', e.target.value)}
                />
              </div>
              <button type="button" className="btn sec sm contacts-remove" onClick={() => removeRow(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn sec sm" onClick={addRow} disabled={rows.length >= MAX_CONTACTS}>
        + Add contact
      </button>
      {rows.length >= MAX_CONTACTS && (
        <span className="muted contacts-hint"> At most {MAX_CONTACTS} contacts.</span>
      )}
    </fieldset>
  );
}

/**
 * How a saved contact list is shown on a detail screen. Kept beside the
 * editor so the two can never drift apart.
 */
export function ContactsList({ contacts }) {
  const rows = (contacts || []).filter((c) => c && (c.name || c.phone));
  if (rows.length === 0) return null;
  return (
    <ul className="contacts-read">
      {rows.map((c, i) => (
        <li key={i}>
          <strong>{c.name}</strong>
          {c.designation ? <span className="muted"> · {c.designation}</span> : null}
          {c.phone ? <> — <a href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`}>{c.phone}</a></> : null}
        </li>
      ))}
    </ul>
  );
}
