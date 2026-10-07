import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Company Management — PWA `vCompanies()` exact reproduction.
 *
 * PWA FACT: super-only. Lists all companies with search.
 * PWA FACT: actions per company: Edit, Suspend/Activate, Remove.
 * PWA FACT: `mCompany(id)` modal: name, city, address, GST, divisions checkboxes,
 *   status, subscription details, contact persons, admin login (create only).
 * PWA FACT: `delCompany(id)` cascades exactly 8 collections.
 * PWA FACT: `setCoStatus(id,s)` for suspend/activate toggle.
 */

const DIVISIONS = ['HVAC', 'Solar', 'MEP'];

export default function CompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(null); // null | { companyId?: string }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/companies');
      setCompanies(data.companies || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = companies.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) ||
           (c.city || '').toLowerCase().includes(q) ||
           (c.status || '').toLowerCase().includes(q);
  });

  async function handleStatusToggle(id, currentStatus) {
    const newStatus = currentStatus === 'Suspended' ? 'Active' : 'Suspended';
    if (!window.confirm(`${newStatus === 'Suspended' ? 'Suspend' : 'Activate'} this company?`)) return;
    try {
      await api.post(`/api/companies/${id}/status`, { status: newStatus });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove company and all its data?')) return;
    try {
      await api.delete(`/api/companies/${id}`);
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Companies</h2>
        <button className="btn btn-primary" onClick={() => setShowModal({})}>+ New Company</button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div className="search-bar" style={{ marginBottom: 12 }}>
        <input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && filtered.length === 0 && (
        <div className="panel"><p className="muted">No companies found.</p></div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>City</th>
                <th>Status</th>
                <th>Divisions</th>
                <th>Since</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const cid = c.id || c._id;
                return (
                  <tr key={cid}>
                    <td>{c.name}</td>
                    <td>{c.city || '—'}</td>
                    <td>
                      <span className="status-badge" style={{
                        background: c.status === 'Active' ? '#4caf50' : c.status === 'Suspended' ? '#e53935' : '#ff9800',
                        color: '#fff',
                      }}>
                        {c.status || 'Trial'}
                      </span>
                    </td>
                    <td>{(c.divisions || []).join(', ') || '—'}</td>
                    <td>{fmtDate(c.since)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => setShowModal({ companyId: cid })}>Edit</button>
                        <button className="btn btn-sm" onClick={() => handleStatusToggle(cid, c.status)}>
                          {c.status === 'Suspended' ? 'Activate' : 'Suspend'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cid)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CompanyModal
          companyId={showModal.companyId}
          onClose={() => setShowModal(null)}
          onSaved={() => { setShowModal(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * PWA `mCompany(id)` modal — create or edit company.
 * Create: company fields + initial admin login.
 * Edit: company fields only.
 */
function CompanyModal({ companyId, onClose, onSaved }) {
  const isEdit = !!companyId;
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [gst, setGst] = useState('');
  const [divisions, setDivisions] = useState(['HVAC']);
  const [subscriptionPlan, setSubscriptionPlan] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');
  const [maxUsers, setMaxUsers] = useState('');
  /* admin fields (create only) */
  const [adminName, setAdminName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    setLoadingCompany(true);
    api.get(`/api/companies/${companyId}`)
      .then(data => {
        const c = data.company;
        setName(c.name || '');
        setCity(c.city || '');
        setAddress(c.address || '');
        setGst(c.gst || '');
        setDivisions(c.divisions || ['HVAC']);
        setSubscriptionPlan(c.subscriptionPlan || '');
        setSubscriptionEnd(c.subscriptionEnd || '');
        setMaxUsers(c.maxUsers || '');
      })
      .catch(err => alert(err.message))
      .finally(() => setLoadingCompany(false));
  }, [isEdit, companyId]);

  function toggleDivision(d) {
    setDivisions(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  }

  async function handleSave() {
    if (!name.trim()) { alert('Company name is required.'); return; }
    if (divisions.length === 0) { alert('Select at least one division.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/companies/${companyId}`, {
          name: name.trim(), city: city.trim(), address: address.trim(),
          gst: gst.trim(), divisions,
          subscriptionPlan: subscriptionPlan.trim(),
          subscriptionEnd: subscriptionEnd || undefined,
          maxUsers: maxUsers ? Number(maxUsers) : undefined,
        });
      } else {
        if (!adminName.trim() || !adminUsername.trim() || !adminPassword) {
          alert('Admin name, username, and password are required.'); setSaving(false); return;
        }
        await api.post('/api/companies', {
          company: {
            name: name.trim(), city: city.trim(), address: address.trim(),
            gst: gst.trim(), divisions,
            subscriptionPlan: subscriptionPlan.trim(),
            subscriptionEnd: subscriptionEnd || undefined,
            maxUsers: maxUsers ? Number(maxUsers) : undefined,
          },
          admin: {
            name: adminName.trim(),
            username: adminUsername.trim(),
            password: adminPassword,
          },
        });
      }
      onSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}>
        <h3>{isEdit ? 'Edit Company' : 'New Company'}</h3>
        {loadingCompany ? <p className="muted">Loading...</p> : (
          <>
            <div className="form-grid">
              <label>Company Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} />
              <label>City</label>
              <input value={city} onChange={e => setCity(e.target.value)} />
              <label>Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} />
              <label>GST No.</label>
              <input value={gst} onChange={e => setGst(e.target.value)} />
              <label>Divisions *</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {DIVISIONS.map(d => (
                  <label key={d} style={{ fontWeight: 'normal' }}>
                    <input type="checkbox" checked={divisions.includes(d)} onChange={() => toggleDivision(d)} />
                    {' '}{d}
                  </label>
                ))}
              </div>
              <label>Subscription Plan</label>
              <input value={subscriptionPlan} onChange={e => setSubscriptionPlan(e.target.value)} placeholder="e.g. Basic / Pro" />
              <label>Subscription End</label>
              <input type="date" value={subscriptionEnd} onChange={e => setSubscriptionEnd(e.target.value)} />
              <label>Max Users</label>
              <input type="number" value={maxUsers} onChange={e => setMaxUsers(e.target.value)} />
            </div>

            {!isEdit && (
              <>
                <h4 style={{ marginTop: 16 }}>Initial Admin Login</h4>
                <div className="form-grid">
                  <label>Admin Name *</label>
                  <input value={adminName} onChange={e => setAdminName(e.target.value)} />
                  <label>Username *</label>
                  <input value={adminUsername} onChange={e => setAdminUsername(e.target.value)} />
                  <label>Password *</label>
                  <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
