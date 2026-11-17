/**
 * Pick a client we already have, instead of typing them again.
 *
 * Owner request (16 Nov 2026, recorded call): "next time when you add the
 * client's name it should come directly to the client, in the drop down."
 *
 * Deliberately NOT a plain <select>: the list grows with every job, so this
 * is a search box that suggests as you type. Crucially it never blocks — a
 * name that is not on the list is simply typed and the enquiry or quotation
 * is saved as normal, and the client joins the list by itself.
 *
 * `onPick` is handed the whole client so the form can fill phone, GST,
 * address and the rest. `onType` is handed the raw text for the field the
 * form already had.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export default function ClientSelect({ value, onType, onPick, label = 'Client', placeholder = 'Search or type a new name', required = false }) {
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    function away(e) { if (box.current && !box.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  useEffect(() => {
    const q = String(value || '').trim();
    if (!q || picked) { setMatches([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api.get(`/api/clients?search=${encodeURIComponent(q)}`)
        .then((d) => { if (alive) setMatches((d.clients || []).slice(0, 8)); })
        .catch(() => { if (alive) setMatches([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [value, picked]);

  function choose(c) {
    setPicked(c);
    setOpen(false);
    setMatches([]);
    onPick(c);
  }

  return (
    <div className="filter-field" ref={box} style={{ position: 'relative' }}>
      <label>{label}{required ? ' *' : ''}</label>
      <input
        value={value || ''}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setPicked(null); onType(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label={label}
      />
      {picked && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          From the client list{picked.gst ? ` · GST ${picked.gst}` : ''}
        </div>
      )}
      {open && matches.length > 0 && (
        <ul
          className="client-suggestions"
          style={{
            position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0,
            listStyle: 'none', margin: 0, padding: 4, maxHeight: 240, overflowY: 'auto',
            background: 'var(--surface, #fff)', border: '1px solid var(--border, #ccd)',
            borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.18)',
          }}
        >
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => choose(c)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                  background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13,
                }}
              >
                <strong>{c.companyName || c.clientName}</strong>
                <span style={{ display: 'block', fontSize: 11, opacity: .75 }}>
                  {[c.clientName && c.companyName ? c.clientName : '', c.phone, c.gst]
                    .filter(Boolean).join(' · ') || 'no other details yet'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
