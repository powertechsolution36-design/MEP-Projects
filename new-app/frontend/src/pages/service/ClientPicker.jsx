import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';

/**
 * Who is the complaint for? (owner request, 22 Oct 2026)
 *
 * Search the AMC / Warranty clients by name, phone or site and pick one, or
 * say it is not one of them — then it is a Chargeable call. Expired clients
 * are listed too: a service given after the AMC ran out is still kept on that
 * client's history, it is just no longer covered.
 *
 * value: the picked client ({ id, customer, phone, site, category, status,
 *        endDate, … }) or null, plus `chargeable` true once "not a client" is
 *        chosen.
 */

export const COVERAGE_TEXT = {
  AMC: 'Covered by AMC',
  Warranty: 'Covered by warranty',
  'AMC expired': 'AMC expired — chargeable',
  'Warranty expired': 'Warranty expired — chargeable',
  Chargeable: 'Chargeable',
};

export function coverageOf(client) {
  if (!client) return 'Chargeable';
  const category = client.category === 'Warranty' ? 'Warranty' : 'AMC';
  return client.status === 'Expired' ? `${category} expired` : category;
}

function statusClass(status) {
  if (status === 'Active') return 'status-won';
  if (status === 'Expiring Soon') return 'status-pending';
  return 'status-lost';
}

export default function ClientPicker({ value, chargeable, onPick, onChargeable, initialClientId }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  // Pre-select a client when arriving from that client's page.
  useEffect(() => {
    if (!initialClientId) return;
    api.get(`/api/contracts/clients?limit=100`)
      .then((d) => {
        const c = (d.clients || []).find((x) => String(x.id) === String(initialClientId));
        if (c) onPick(c);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId]);

  function search(text) {
    setQ(text);
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await api.get(`/api/contracts/clients?q=${encodeURIComponent(text)}&limit=25`);
        setResults(d.clients || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }

  if (value) {
    const cov = coverageOf(value);
    return (
      <div className="client-picked">
        <div>
          <div style={{ fontWeight: 700 }}>{value.customer || '(no name)'}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {[value.site, value.phone].filter(Boolean).join(' · ')}
          </div>
          <div style={{ marginTop: 4 }}>
            <span className={`status-badge ${statusClass(value.status)}`}>{value.category} · {value.status}</span>{' '}
            <span style={{ fontSize: 13 }}>
              {value.endDate ? `until ${fmtDate(value.endDate)}` : 'no end date'} — <strong>{COVERAGE_TEXT[cov]}</strong>
            </span>
          </div>
          {value.status === 'Expired' && (
            <div style={{ fontSize: 13, marginTop: 4, color: '#8a5a00' }}>
              Their {value.category} has expired. The call is still kept on this client&apos;s history, as a chargeable service.
            </div>
          )}
        </div>
        <button type="button" className="btn sec sm" onClick={() => { onPick(null); setQ(''); setResults([]); }}>Change</button>
      </div>
    );
  }

  if (chargeable) {
    return (
      <div className="client-picked">
        <div>
          <div style={{ fontWeight: 700 }}>Not an AMC / Warranty client</div>
          <div className="muted" style={{ fontSize: 13 }}>This call is <strong>Chargeable</strong>. Enter the customer below.</div>
        </div>
        <button type="button" className="btn sec sm" onClick={() => onChargeable(false)}>Change</button>
      </div>
    );
  }

  return (
    <div className="client-search">
      <input
        type="search"
        value={q}
        onChange={(e) => search(e.target.value)}
        onFocus={() => { if (!results.length) search(q); }}
        placeholder="Search AMC / Warranty client by name, phone or site"
        aria-label="Search AMC or Warranty client"
        autoComplete="off"
      />
      {open && (
        <ul className="client-results" role="listbox">
          {loading && <li className="muted" style={{ padding: 8 }}>Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="muted" style={{ padding: 8 }}>No AMC / Warranty client matches.</li>
          )}
          {results.map((c) => (
            <li key={c.id} role="option" aria-selected="false">
              <button type="button" onClick={() => { onPick(c); setOpen(false); }}>
                <span style={{ fontWeight: 600 }}>{c.customer || '(no name)'}</span>
                <span className="muted" style={{ fontSize: 12 }}>{[c.site, c.phone].filter(Boolean).join(' · ')}</span>
                <span className={`status-badge ${statusClass(c.status)}`}>{c.category} · {c.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn sec sm" style={{ marginTop: 8 }} onClick={() => onChargeable(true)}>
        Not an AMC / Warranty client — Chargeable
      </button>
    </div>
  );
}
