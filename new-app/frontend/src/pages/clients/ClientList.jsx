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
  companyName: '', clientName: '', designation: '', phone: '',
  gst: '', address: '', email: '', notes: '', contacts: [],
};

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
      if (form.id) await api.patch(`/api/clients/${form.id}`, body);
      else await api.post('/api/clients', body);
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
                  <th>Company</th>
                  <th>Client</th>
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
                  <tr key={c.id}>
                    <td>{c.companyName || '—'}</td>
                    <td>
                      {c.clientName || '—'}
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
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* Owner request (17 Nov 2026): everything we hold on
                          them — their calls, projects, quotations and the
                          rest — on their own page. */}
                      <button className="btn sec sm" onClick={() => navigate(`/clients/${c.id}`)}>Open</button>
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
                  <label>Company Name</label>
                  <input value={form.companyName} onChange={(e) => setField('companyName', e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>Client Name</label>
                  <input value={form.clientName} onChange={(e) => setField('clientName', e.target.value)} />
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
