import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../api/client';

export default function Companies() {
  const companies = useStore(s => s.companies);
  const users = useStore(s => s.users);
  const setScopedCompany = useStore(s => s.setScopedCompany);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');

  const filtered = q ? companies.filter(c => (c.name + ' ' + (c.code || '') + ' ' + (c.email || '')).toLowerCase().includes(q.toLowerCase())) : companies;

  async function del(co) {
    if (!confirm(`Delete ${co.name} and ALL its data? This cannot be undone.`)) return;
    try { await api.del(`/api/companies/${co._id}`); toast('Deleted'); }
    catch (e) { toast(e.message); }
  }

  function enterCo(id) { setScopedCompany(id); }

  return (
    <div>
      <div className="main-header">
        <h2>🏢 Companies</h2>
        <button className="btn" onClick={() => setShowNew(true)}>+ New Company</button>
      </div>
      <p className="text-mut mb-2">Each company is a separate tenant. Creating a company also creates its first Admin user (who then manages their own team).</p>
      <div className="card">
        <input placeholder="Search companies..." value={q} onChange={e => setQ(e.target.value)} style={{marginBottom: 12}} />
        <div className="tw"><table className="data-table">
          <thead><tr><th>Name</th><th>Code</th><th>Users</th><th>Email</th><th>Phone</th><th>Status</th><th style={{width: 180}}>Actions</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-mut" style={{padding: 40}}>No companies</td></tr>}
            {filtered.map(co => {
              const userCount = users.filter(u => String(u.co) === String(co._id)).length;
              return (
                <tr key={co._id}>
                  <td><strong>{co.name}</strong></td>
                  <td>{co.code || '—'}</td>
                  <td>{userCount}</td>
                  <td>{co.email || '—'}</td>
                  <td>{co.phone || '—'}</td>
                  <td>{co.disabled ? <span className="badge red">Disabled</span> : <span className="badge grn">Active</span>}</td>
                  <td>
                    <button className="btn sm grn" onClick={() => enterCo(co._id)}>Enter</button>
                    <button className="btn sm sec" style={{marginLeft: 4}} onClick={() => setEditing(co)}>Edit</button>
                    <button className="btn sm" style={{background: 'var(--red)', marginLeft: 4}} onClick={() => del(co)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {showNew && <NewCompanyForm onClose={() => setShowNew(false)} />}
      {editing && <EditCompanyForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewCompanyForm({ onClose }) {
  const [co, setCo] = useState({ divs: ['MEP', 'HVAC', 'Solar'] });
  const [admin, setAdmin] = useState({});
  const [busy, setBusy] = useState(false);

  function setC(k, v) { setCo(d => ({ ...d, [k]: v })); }
  function setA(k, v) { setAdmin(d => ({ ...d, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!admin.un || !admin.pw || !admin.name) return toast('Admin name, username, and password are required');
    if ((admin.pw || '').length < 6) return toast('Admin password must be at least 6 characters');
    setBusy(true);
    try {
      await api.post('/api/companies', { ...co, admin });
      toast(`Company created. Admin login: ${admin.un}`);
      onClose();
    } catch (e) {
      toast(e.message || 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Create Company" onClose={onClose} maxWidth={640}>
      <form onSubmit={submit}>
        <h4 style={{fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--mut)', marginBottom: 8}}>🏢 Company Details</h4>
        <div className="row">
          <div style={{flex: 2}}><label>Company Name *</label><input required value={co.name || ''} onChange={e => setC('name', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Code</label><input value={co.code || ''} onChange={e => setC('code', e.target.value.toUpperCase())} placeholder="ACME" /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Email</label><input type="email" value={co.email || ''} onChange={e => setC('email', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Phone</label><input value={co.phone || ''} onChange={e => setC('phone', e.target.value)} /></div>
        </div>
        <label className="mt-1">Address</label>
        <textarea rows={2} value={co.address || ''} onChange={e => setC('address', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>GSTIN</label><input value={co.gstin || ''} onChange={e => setC('gstin', e.target.value)} /></div>
          <div style={{flex: 2}}><label>Divisions (comma separated)</label><input value={(co.divs || []).join(', ')} onChange={e => setC('divs', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></div>
        </div>

        <div style={{marginTop: 20, padding: 16, background: '#fef8f6', border: '1px solid #f5d4c9', borderRadius: 8}}>
          <h4 style={{fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--red)', marginBottom: 8}}>🛡️ Company Admin Account</h4>
          <p className="text-mut text-sm" style={{marginBottom: 12}}>This admin will manage the company and create its team members.</p>
          <div className="row">
            <div style={{flex: 1}}><label>Admin Full Name *</label><input required value={admin.name || ''} onChange={e => setA('name', e.target.value)} /></div>
            <div style={{flex: 1}}><label>Username *</label><input required value={admin.un || ''} onChange={e => setA('un', e.target.value.toLowerCase())} autoComplete="username" /></div>
          </div>
          <div className="row mt-1">
            <div style={{flex: 1}}><label>Password * (min 6 chars)</label><input required type="password" minLength={6} value={admin.pw || ''} onChange={e => setA('pw', e.target.value)} autoComplete="new-password" /></div>
          </div>
          <div className="row mt-1">
            <div style={{flex: 1}}><label>Email</label><input type="email" value={admin.email || ''} onChange={e => setA('email', e.target.value)} /></div>
            <div style={{flex: 1}}><label>Phone</label><input value={admin.phone || ''} onChange={e => setA('phone', e.target.value)} /></div>
          </div>
        </div>

        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create Company + Admin'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditCompanyForm({ initial, onClose }) {
  const [data, setData] = useState({ ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      await api.put(`/api/companies/${initial._id}`, data);
      toast('Saved');
      onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={`Edit ${initial.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <div style={{flex: 2}}><label>Name *</label><input required value={data.name || ''} onChange={e => set('name', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Code</label><input value={data.code || ''} onChange={e => set('code', e.target.value.toUpperCase())} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Email</label><input type="email" value={data.email || ''} onChange={e => set('email', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Phone</label><input value={data.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        </div>
        <label className="mt-1">Address</label>
        <textarea rows={2} value={data.address || ''} onChange={e => set('address', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>GSTIN</label><input value={data.gstin || ''} onChange={e => set('gstin', e.target.value)} /></div>
          <div style={{flex: 2}}><label>Divisions (comma separated)</label><input value={(data.divs || []).join(', ')} onChange={e => set('divs', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></div>
        </div>
        <div style={{marginTop: 12}}>
          <label style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <input type="checkbox" checked={!!data.disabled} onChange={e => set('disabled', e.target.checked)} style={{width: 'auto'}} />
            <span>Disabled (block all users from signing in)</span>
          </label>
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
