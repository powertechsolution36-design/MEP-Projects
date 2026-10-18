import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { fmtDate, money } from '../../utils/format';
import { coDivs, todayKey, downloadCsv, buildSubscriberRows } from '../../utils/platform';
import { divisionClass } from '../../utils/divisions';

/**
 * Company Management — PWA `vCompanies()` / `mCompany(id)` / `saveCompany(id)`
 * / `setCoStatus` / `delCompany` (MEP_PROJECTS_PWA/index.html:1661-1752).
 *
 * List: search over name, city, address, GST, status, email, billing cycle
 *   and divisions; columns Company (email, address) · Contacts · City · GST No ·
 *   Divisions · Status (Trial → end / Trial Expired) · Subscription · Sales
 *   Value (SO count) · Projects (ongoing) · Since · Users; Edit /
 *   Suspend|Activate / Remove; "⬇ Report" = subscribers, all time.
 * Modal: name, city, address, GST, divisions, status, phone, email, tagline,
 *   subscription block (Active only), 2 contacts, admin Login ID + password.
 * `?edit=<id>` opens the edit modal (PWA "Renew / Edit" from Expiring).
 *
 * Deviation (security): the PWA prefilled the admin's plaintext password.
 * The new app stores only a password hash, so on edit the password field is
 * blank and left blank means "unchanged".
 */

const DIVISIONS = ['HVAC', 'Solar', 'MEP'];

export default function CompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const editParam = params.get('edit');
  const [showModal, setShowModal] = useState(editParam ? { companyId: editParam } : null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, u] = await Promise.all([api.get('/api/companies'), api.get('/api/companies/platform/usage')]);
      setCompanies(c.companies || []);
      setUsage(Object.fromEntries((u.usage || []).map((r) => [r.companyId, r])));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function closeModal() {
    setShowModal(null);
    if (editParam) setParams({}, { replace: true });
  }

  const q = search.trim().toLowerCase();
  const filtered = companies.filter((c) => {
    if (!q) return true;
    return [c.name, c.city, c.address, c.gstNumber, c.status, c.email, c.subscriptionCycle, coDivs(c).join(' ')]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  async function setStatus(c, status) {
    try {
      await api.post(`/api/companies/${c.id}/status`, { status });
      setMsg(`${c.name} → ${status}`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function handleDelete(c) {
    if (!window.confirm('Remove company and all its data?')) return;
    try {
      await api.delete(`/api/companies/${c.id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  function report() {
    downloadCsv(`subscribers-all-${todayKey()}.csv`, buildSubscriberRows(companies, 'all'));
    setMsg(`Report downloaded: subscribers-all-${todayKey()}.csv`);
  }

  const today = todayKey();

  return (
    <div className="enq-page">
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      <div className="search-bar" style={{ marginBottom: 12 }}>
        <input placeholder="Search company, city, GST, status, division..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted" style={{ marginLeft: 8 }}>{filtered.length} / {companies.length}</span>
      </div>

      <div className="panel">
        <div className="enq-header">
          <h3>Subscribed Companies</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setShowModal({})}>+ Add Company</button>
            <button className="btn sm sec" onClick={report} disabled={loading}>⬇ Report</button>
          </div>
        </div>
        {loading ? <p className="muted">Loading...</p> : (
          <div className="table-wrap">
            <table className="data-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>Company</th><th>Contacts</th><th>City</th><th>GST No</th><th>Divisions</th><th>Status</th>
                  <th>Subscription</th><th>Sales Value</th><th>Projects</th><th>Since</th><th>Users</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const cs = usage[c.id] || {};
                  const trialOver = c.status === 'Trial' && c.trialEnd && fmtDate(c.trialEnd) < today;
                  const statusClass = c.status === 'Active' ? 'status-open'
                    : c.status === 'Trial' && !trialOver ? 'status-pending' : 'status-lost';
                  const stLbl = c.status === 'Trial' ? (trialOver ? 'Trial Expired' : `Trial → ${fmtDate(c.trialEnd)}`) : c.status;
                  const cts = (c.contacts || []).filter((x) => x.name || x.phone);
                  return (
                    <tr key={c.id}>
                      <td><b>{c.name}</b><div className="muted">{c.email}{c.address ? <><br />{c.address}</> : null}</div></td>
                      <td>{cts.length ? cts.map((x, i) => <div key={i}>{x.name} · {x.phone}</div>) : '-'}</td>
                      <td>{c.city}</td>
                      <td>{c.gstNumber || '-'}</td>
                      <td>{coDivs(c).map((d) => <span key={d} className={divisionClass(d)} style={{ marginRight: 4 }}>{d}</span>)}</td>
                      <td><span className={`status-badge ${statusClass}`}>{stLbl}</span></td>
                      <td>
                        {c.status === 'Active' && c.subscriptionRate ? (
                          <>
                            {money(c.subscriptionRate)} / {c.subscriptionCycle === 'Yearly' ? 'yr' : 'mo'}
                            <div className="muted">{fmtDate(c.subscriptionStart)} → {fmtDate(c.subscriptionEnd)}</div>
                          </>
                        ) : '-'}
                      </td>
                      <td className="fg-ok"><b>{money(cs.sales) || '-'}</b><div className="muted">{cs.sos || 0} SO</div></td>
                      <td><b>{cs.prj || 0}</b><div className="muted">{cs.ongoing || 0} ongoing</div></td>
                      <td>{fmtDate(c.since)}</td>
                      <td>{cs.users || 0}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn sm sec" onClick={() => setShowModal({ companyId: c.id })}>Edit</button>{' '}
                        {c.status === 'Suspended'
                          ? <button className="btn sm grn" onClick={() => setStatus(c, 'Active')}>Activate</button>
                          : <button className="btn sm sec" onClick={() => setStatus(c, 'Suspended')}>Suspend</button>}{' '}
                        <button className="btn sm" onClick={() => handleDelete(c)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <CompanyModal
          companyId={showModal.companyId}
          onClose={closeModal}
          onSaved={(text) => { closeModal(); setMsg(text); load(); }}
        />
      )}
    </div>
  );
}

const EMPTY = {
  name: '', city: '', address: '', gstNumber: '', divisions: ['HVAC'], status: 'Trial',
  phone: '', email: '', tagline: '', c1n: '', c1p: '', c2n: '', c2p: '',
  subscriptionRate: '', subscriptionCycle: 'Monthly', subscriptionStart: '', subscriptionEnd: '',
  adminUsername: '', adminPassword: '',
};

/** PWA `mCompany(id)` + `saveCompany(id)`. */
function CompanyModal({ companyId, onClose, onSaved }) {
  const isEdit = !!companyId;
  const [f, setF] = useState(EMPTY);
  const [loadingCompany, setLoadingCompany] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/companies/${companyId}`)
      .then((data) => {
        const c = data.company;
        const ct = c.contacts || [];
        setF({
          ...EMPTY,
          name: c.name || '', city: c.city || '', address: c.address || '', gstNumber: c.gstNumber || '',
          divisions: coDivs(c), status: c.status || 'Trial',
          phone: c.phone || '', email: c.email || '', tagline: c.tagline || '',
          c1n: (ct[0] || {}).name || '', c1p: (ct[0] || {}).phone || '',
          c2n: (ct[1] || {}).name || '', c2p: (ct[1] || {}).phone || '',
          subscriptionRate: c.subscriptionRate || '', subscriptionCycle: c.subscriptionCycle || 'Monthly',
          subscriptionStart: fmtDate(c.subscriptionStart), subscriptionEnd: fmtDate(c.subscriptionEnd),
          adminUsername: data.adminUsername || '',
        });
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingCompany(false));
  }, [isEdit, companyId]);

  function toggleDivision(d) {
    setF((p) => ({ ...p, divisions: p.divisions.includes(d) ? p.divisions.filter((x) => x !== d) : [...p.divisions, d] }));
  }

  async function handleSave() {
    const un = f.adminUsername.trim();
    // PWA FACT: saveCompany validation order and messages (index.html:1721-1729)
    if (!f.name.trim()) { setErr('Name required'); return; }
    if (!isEdit && (!un || !f.adminPassword)) { setErr('Set admin Login ID and password'); return; }
    if (f.status === 'Active' && (!f.subscriptionRate || !f.subscriptionStart)) { setErr('Set subscription rate and start date for Active status'); return; }
    const divisions = DIVISIONS.filter((d) => f.divisions.includes(d));
    if (!divisions.length) { setErr('Select at least one division'); return; }
    const active = f.status === 'Active';
    const company = {
      name: f.name.trim(), city: f.city, address: f.address, gstNumber: f.gstNumber, divisions, status: f.status,
      phone: f.phone, email: f.email, tagline: f.tagline,
      contacts: [{ name: f.c1n, phone: f.c1p }, { name: f.c2n, phone: f.c2p }],
      subscriptionCycle: f.subscriptionCycle || 'Monthly',
      ...(active ? {
        subscriptionRate: Number(f.subscriptionRate) || 0,
        subscriptionStart: f.subscriptionStart,
        subscriptionEnd: f.subscriptionEnd || '',
      } : {}),
    };
    setSaving(true);
    setErr('');
    try {
      if (isEdit) {
        const admin = {};
        if (un) admin.username = un;
        if (f.adminPassword) admin.password = f.adminPassword;
        await api.patch(`/api/companies/${companyId}`, { ...company, admin });
        onSaved(`${company.name} saved`);
      } else {
        const r = await api.post('/api/companies', {
          company,
          admin: { name: f.c1n.trim() || 'Admin', username: un, password: f.adminPassword },
        });
        const te = r && r.company && r.company.trialEnd ? ` · Trial ends ${fmtDate(r.company.trialEnd)}` : '';
        onSaved(`Company created. Admin login: ${un}${te}`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const row = (label, el) => <><label>{label}</label>{el}</>;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}>
        <h3>{isEdit ? 'Edit' : 'Add'} Company</h3>
        {loadingCompany ? <p className="muted">Loading...</p> : (
          <>
            <div className="form-grid">
              {row('Company Name', <input value={f.name} onChange={set('name')} />)}
              {row('City / Location', <input value={f.city} onChange={set('city')} />)}
              {row('Address', <textarea rows={2} value={f.address} onChange={set('address')} />)}
              {row('GST No', <input value={f.gstNumber} onChange={set('gstNumber')} />)}
              {row('Divisions Subscribed (access given to admin)', (
                <div style={{ display: 'flex', gap: 12 }}>
                  {DIVISIONS.map((d) => (
                    <label key={d} style={{ fontWeight: 'normal' }}>
                      <input type="checkbox" checked={f.divisions.includes(d)} onChange={() => toggleDivision(d)} /> {d}
                    </label>
                  ))}
                </div>
              ))}
              {row('Status', (
                <select value={f.status} onChange={set('status')}>
                  <option>Trial</option><option>Active</option><option>Suspended</option>
                </select>
              ))}
              {row('Phone (for customer messages)', <input value={f.phone} onChange={set('phone')} />)}
              {row('Email (for customer messages)', <input value={f.email} onChange={set('email')} />)}
              {row('Tagline', <input value={f.tagline} onChange={set('tagline')} />)}
            </div>
            {f.status === 'Trial' && (
              <p className="muted" style={{ marginTop: 8 }}>Trial period is <b>15 days</b> — trial end date is set automatically from the joining date.</p>
            )}
            {f.status === 'Active' && (
              <>
                <h4 style={{ marginTop: 14 }}>Subscription</h4>
                <div className="form-grid">
                  {row('Billing Cycle', (
                    <select value={f.subscriptionCycle} onChange={set('subscriptionCycle')}><option>Monthly</option><option>Yearly</option></select>
                  ))}
                  {row('Subscription Rate (₹ per cycle)', <input type="number" value={f.subscriptionRate} onChange={set('subscriptionRate')} />)}
                  {row('Subscription Start Date', <input type="date" value={f.subscriptionStart} onChange={set('subscriptionStart')} />)}
                  {row('Subscription End Date', <input type="date" value={f.subscriptionEnd} onChange={set('subscriptionEnd')} />)}
                </div>
              </>
            )}
            <h4 style={{ marginTop: 14 }}>Contact Persons</h4>
            <div className="form-grid">
              {row('Contact 1 - Name', <input value={f.c1n} onChange={set('c1n')} />)}
              {row('Contact 1 - Number', <input value={f.c1p} onChange={set('c1p')} />)}
              {row('Contact 2 - Name', <input value={f.c2n} onChange={set('c2n')} />)}
              {row('Contact 2 - Number', <input value={f.c2p} onChange={set('c2p')} />)}
            </div>
            <h4 style={{ marginTop: 14 }}>Admin Login Credentials</h4>
            <div className="form-grid">
              {row('Login ID', <input value={f.adminUsername} onChange={set('adminUsername')} placeholder="e.g. coolair_admin" />)}
              {row('Password', <input type="password" autoComplete="new-password" value={f.adminPassword} onChange={set('adminPassword')} placeholder={isEdit ? 'leave blank to keep current' : 'set password'} />)}
            </div>
            {err && <p style={{ color: 'red', marginTop: 8 }}>{err}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn sec" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
