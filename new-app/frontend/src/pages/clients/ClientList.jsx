/**
 * The client directory (owner request, 16 Nov 2026, recorded call).
 *
 * "On the admin page the client's list should be shown ... I can edit the
 * client there ... the company's name, client's name, client's GST address
 * ... and there should be multiple contact numbers added in it."
 *
 * Everyone but the engineers works from this list; only an admin removes
 * from it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import ContactsField from '../../components/ContactsField';

const BLANK = {
  companyName: '', clientName: '', designation: '', phone: '', sites: [],
  gst: '', address: '', email: '', notes: '', contacts: [],
};

/**
 * What a client edit changed elsewhere, in a sentence.
 *
 * Owner request (18 Nov 2026): correcting a client corrects the records
 * that copied their details. The team is told what was reached, and what
 * was deliberately left as it was sent.
 */
const KINDS = {
  contracts: 'AMC / PM',
  salesOrders: 'sales order',
  projects: 'project',
  quotations: 'quotation',
  payments: 'payment',
  serviceCalls: 'service call',
};

export function propagationNote(p) {
  if (!p || !p.changed || p.changed.length === 0) return '';
  const count = (bag) => Object.entries(bag || {})
    .map(([k, n]) => `${n} ${KINDS[k] || k}${n === 1 ? '' : 's'}`);
  const done = count(p.updated);
  const kept = count(p.leftAlone);
  const parts = [];
  parts.push(done.length ? `Updated ${done.join(', ')}.` : 'Nothing else held the old details.');
  if (kept.length) {
    parts.push(`Left as sent: ${kept.join(', ')} — a quotation already sent, or a payment already collected, keeps the wording it went out with.`);
  }
  if (p.failed && p.failed.length) {
    parts.push(`Could not check: ${p.failed.map((f) => KINDS[f.kind] || f.kind).join(', ')}.`);
  }
  return parts.join(' ');
}

export default function ClientList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // null = closed; {} = adding; {id} = editing
  const [importNote, setImportNote] = useState('');

  const canDelete = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/api/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      setClients(d.clients || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250); // let typing settle before searching
    return () => clearTimeout(t);
  }, [load]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      delete body.id;
      if (form.id) {
        const res = await api.patch(`/api/clients/${form.id}`, body);
        // Owner request (18 Nov 2026): a correction here corrects every
        // record that copied the old details. Say what it reached — a change
        // this wide should never happen quietly.
        setImportNote(propagationNote(res && res.propagated));
      } else {
        await api.post('/api/clients', body);
        setImportNote('');
      }
      setForm(null);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    if (!window.confirm(`Remove ${c.companyName || c.clientName} from the client list? Their enquiries, quotations and AMC records are not touched.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/clients/${c.id}`);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* The AMC / PM clients we already have, brought in. Safe to run again:
     a client already on the list is left alone. */
  async function importAmc() {
    setBusy(true);
    setImportNote('');
    try {
      const r = await api.post('/api/clients/import/amc', {});
      setImportNote(r.added === 0
        ? `Nothing new — all ${r.seen} AMC clients are already on the list.`
        : `${r.added} client${r.added === 1 ? '' : 's'} added from the AMC / PM list.`);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="enq-page">
      <div className="detail-head">
        <h2>Clients</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sec sm" onClick={importAmc} disabled={busy}>
            ⬇ Add from AMC / PM list
          </button>
          <button className="btn pri sm" onClick={() => setForm({ ...BLANK })} disabled={busy}>
            + New Client
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="filter-field">
          <label>Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company, person, number or GST"
            aria-label="Search clients"
          />
        </div>
        {importNote && <p style={{ marginTop: 8 }}>{importNote}</p>}
      </div>

      {error && <div className="panel err">{error}</div>}
      {loading ? <p>Loading…</p> : (
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>
            {clients.length} client{clients.length === 1 ? '' : 's'}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {/* The owner's own words (23 Nov 2026): "company name =
                      Site and Client = Customer Name, do this for every
                      record." The firm is the site we go to; the customer
                      is the person we deal with. The fields behind them are
                      unchanged — this is what they are called. */}
                  <th>Site</th>
                  <th>Customer Name</th>
                  <th>Phone</th>
                  <th>GST</th>
                  <th>Contacts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 && (
                  <tr><td colSpan={6} className="muted">No clients yet. Add one, or bring in the AMC / PM list.</td></tr>
                )}
                {clients.map((c) => (
                  // Owner request (17 Nov 2026): clicking the client opens
                  // them. The row IS the link, the same as the service call,
                  // project and sales order registers — there is no Open
                  // button to find first.
                  <tr
                    key={c.id}
                    className="clickable-row"
                    onClick={() => navigate(`/clients/${c.id}`)}
                  >
                    {/* Owner request (17 Nov 2026): "if i click on their
                        name it will open". Both names are the link — a
                        record may be known by the firm or by the person. */}
                    <td>
                      {c.companyName
                        ? <button type="button" className="name-link" onClick={() => navigate(`/clients/${c.id}`)}>{c.companyName}</button>
                        : '—'}
                    </td>
                    <td>
                      {c.clientName
                        ? <button type="button" className="name-link" onClick={() => navigate(`/clients/${c.id}`)}>{c.clientName}</button>
                        : '—'}
                      {c.designation && <div className="muted" style={{ fontSize: 11 }}>{c.designation}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 180 }}>{c.gst || '—'}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>
                      {(c.contacts || []).length === 0 ? '—' : (c.contacts || []).map((p, k) => (
                        <div key={k} style={{ fontSize: 12 }}>
                          {p.name}{p.designation ? ` (${p.designation})` : ''}{p.phone ? ` · ${p.phone}` : ''}
                        </div>
                      ))}
                    </td>
                    {/* Edit and Remove act on the row they sit in, so they
                        must not also open it. */}
                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn sec sm" onClick={() => setForm({ ...BLANK, ...c })}>Edit</button>
                      {canDelete && (
                        <button className="btn danger sm" onClick={() => remove(c)} disabled={busy}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? 'Edit Client' : 'New Client'}</h3>
            <form onSubmit={save}>
              <div className="filter-grid">
                <div className="filter-field">
                  <label>Site</label>
                  <input
                    value={form.companyName}
                    placeholder="The firm, e.g. Kapil Agencies Moto Central"
                    onChange={(e) => setField('companyName', e.target.value)}
                  />
                </div>
                <div className="filter-field">
                  <label>Customer Name</label>
                  <input
                    value={form.clientName}
                    placeholder="The person, e.g. Rohit Gupta"
                    onChange={(e) => setField('clientName', e.target.value)}
                  />
                </div>
                <div className="filter-field">
                  <label>Designation</label>
                  <input value={form.designation} onChange={(e) => setField('designation', e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>Phone</label>
                  <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>Email</label>
                  <input value={form.email} onChange={(e) => setField('email', e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>GST</label>
                  <input value={form.gst} onChange={(e) => setField('gst', e.target.value)} />
                </div>
              </div>
              <div className="filter-field">
                <label>Address</label>
                <textarea rows={2} value={form.address} onChange={(e) => setField('address', e.target.value)} />
              </div>

              {/* Owner request (23 Nov 2026), pointing at the AMC record's
                  own list: "put this option in Client". A firm is often in
                  more than one place — Kapil Agencies Moto Central at Baner
                  and at Nana Peth — and this is the directory saying so.
                  The AMC records stay one per site; this changes none of
                  them. */}
              <fieldset className="contacts-field">
                <legend>Other sites under this client</legend>
                <p className="muted" style={{ marginTop: 0 }}>
                  Where else this firm is. Their AMC records stay one per site — this is
                  only the list of places, so the office can see them on the client.
                </p>
                {(form.sites || []).map((row, k) => (
                  <div className="filter-grid" key={k} style={{ marginBottom: 8 }}>
                    <div className="filter-field">
                      <label>Site</label>
                      <input
                        value={row.name}
                        placeholder="e.g. Nana Peth"
                        onChange={(e) => setForm((f) => {
                          const list = [...(f.sites || [])];
                          list[k] = { ...list[k], name: e.target.value };
                          return { ...f, sites: list };
                        })}
                      />
                    </div>
                    <div className="filter-field">
                      <label>Address</label>
                      <input
                        value={row.address || ''}
                        onChange={(e) => setForm((f) => {
                          const list = [...(f.sites || [])];
                          list[k] = { ...list[k], address: e.target.value };
                          return { ...f, sites: list };
                        })}
                      />
                    </div>
                    <div className="filter-field" style={{ alignSelf: 'end' }}>
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() => setForm((f) => ({
                          ...f, sites: (f.sites || []).filter((_, j) => j !== k),
                        }))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn sec sm"
                  onClick={() => setForm((f) => ({ ...f, sites: [...(f.sites || []), { name: '', address: '' }] }))}
                >
                  + Add another site
                </button>
              </fieldset>

              <ContactsField
                value={form.contacts || []}
                onChange={(rows) => setField('contacts', rows)}
              />

              <div className="filter-field">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn sec sm" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="btn pri sm" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
