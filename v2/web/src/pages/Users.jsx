import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import ReportDownload from '../components/ReportDownload';
import { toast } from '../components/Toast';
import { getRoleLabel, roleOptions } from '../utils/responsibilities';
import { DESIGNATIONS, DEPARTMENTS, DIVISIONS, orgLabel, getOrg } from '../utils/orgModel';

export default function Users() {
  const users = useStore(s => s.users);
  const user = useStore(s => s.user);
  const companies = useStore(s => s.companies);
  const scopedCompany = useStore(s => s.scopedCompany);
  const setScopedCompany = useStore(s => s.setScopedCompany);
  const create = useStore(s => s.create);
  const update = useStore(s => s.update);
  const remove = useStore(s => s.remove);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [credentials, setCredentials] = useState(null); // {un, pw, name} shown after create/reset

  const isSuper = user?.role === 'super';

  if (isSuper && !scopedCompany) {
    return (
      <div>
        <div className="main-header">
          <h2>Users</h2>
          <button className="btn sec" onClick={() => setScopedCompany(null)}>Show all →</button>
        </div>
        <p className="text-mut mb-2">Select a company to manage its users:</p>
        <div className="grid grid-3">
          {companies.length === 0 && <div className="card text-center text-mut">No companies</div>}
          {companies.map(co => {
            const cnt = users.filter(u => String(u.co) === String(co._id)).length;
            return (
              <button key={co._id} className="co-card" onClick={() => setScopedCompany(co._id)}>
                <div className="co-card-icon">🏢</div>
                <div className="co-card-name">{co.name}</div>
                <div className="co-card-code text-mut text-sm">{co.code || '—'}</div>
                <div className="co-card-count">{cnt} users</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const scoped = isSuper && scopedCompany ? users.filter(u => String(u.co) === String(scopedCompany)) : users;
  const filtered = q ? scoped.filter(u => (u.name + ' ' + u.un + ' ' + orgLabel(u)).toLowerCase().includes(q.toLowerCase())) : scoped;
  const currentCoName = scopedCompany ? (companies.find(c => String(c._id) === String(scopedCompany))?.name || '') : '';

  const rOpts = roleOptions(isSuper);

  async function onSave(data) {
    // Global uniqueness check (across ALL companies, not just this one)
    const cleanUn = (data.un || '').toLowerCase().trim();
    const existing = users.find(u => u.un?.toLowerCase() === cleanUn && String(u._id) !== String(editing?._id));
    if (existing) return toast(`Username "${cleanUn}" is already taken. Choose another.`);
    try {
      const payload = { ...data };
      if (isSuper && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (editing?._id && !payload.pw) delete payload.pw;
      const wasCreate = !editing?._id;
      const savedPw = payload.pw;
      if (editing?._id) await update('users', editing._id, payload);
      else await create('users', payload);
      setEditing(null);
      setSelected(null);
      toast('Saved');
      // After create OR password reset, show credentials so admin can share them
      if (wasCreate && savedPw) {
        setCredentials({ un: payload.un, pw: savedPw, name: payload.name });
      } else if (!wasCreate && savedPw) {
        setCredentials({ un: payload.un, pw: savedPw, name: payload.name, isReset: true });
      }
    } catch (e) {
      if (e.status === 409 || /duplicate/i.test(e.message)) toast(`Username "${data.un}" already exists`);
      else toast(e.message || 'Save failed');
    }
  }

  async function onDelete(u) {
    if (!confirm(`Delete ${u.name} (${u.un})?`)) return;
    try { await remove('users', u._id); toast('Deleted'); setSelected(null); }
    catch (e) { toast(e.message); }
  }

  return (
    <div>
      <div className="main-header">
        <div>
          <h2>Users</h2>
          {isSuper && scopedCompany && (
            <div className="text-sm text-mut" style={{marginTop: 4}}>
              🏢 {currentCoName} · <button className="link-btn" onClick={() => setScopedCompany(null)}>← switch company</button>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => setEditing({})}>+ New User</button>
        <ReportDownload module="users" label="Users" />
      </div>

      <div className="card">
        <input placeholder="Search by name, username, or role..." value={q} onChange={e => setQ(e.target.value)} style={{marginBottom: 12}} />
        {filtered.length === 0 ? (
          <div className="text-center text-mut" style={{padding: 40}}>No users yet</div>
        ) : (
          <div className="user-list">
            {filtered.map(u => (
              <button key={u._id} className="user-row" onClick={() => setSelected(u)}>
                <span className="user-avatar">{(u.name || u.un || '?')[0].toUpperCase()}</span>
                <span className="user-row-name">{u.name}</span>
                <span className="badge blu">{orgLabel(u)}</span>
                <span className="user-row-un" title={`@${u.un}`}>@{u.un}</span>
                <span className="user-row-arrow">›</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && !editing && (
        <Modal title={selected.name} onClose={() => setSelected(null)} maxWidth={520}>
          <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20}}>
            <div className="user-avatar" style={{width: 60, height: 60, fontSize: 24}}>{(selected.name || selected.un)[0].toUpperCase()}</div>
            <div>
              <div style={{fontSize: 18, fontWeight: 700}}>{selected.name}</div>
              <div className="text-mut">@{selected.un}</div>
              <span className="badge blu" style={{marginTop: 4, display: 'inline-block'}}>{orgLabel(selected)}</span>
            </div>
          </div>
          <DetailRow label="Email" value={selected.email} />
          <DetailRow label="Phone" value={selected.phone} />
          <DetailRow label="Status" value={selected.disabled ? 'Disabled' : 'Active'} />
          <DetailRow label="Created" value={new Date(selected.createdAt).toLocaleString()} />
          <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16}}>
            <button className="btn" style={{background: 'var(--red)'}} onClick={() => onDelete(selected)}>🗑 Delete</button>
            <button className="btn sec" onClick={() => setSelected(null)}>Close</button>
            <button className="btn" onClick={() => setEditing(selected)}>✏ Edit</button>
          </div>
        </Modal>
      )}

      {editing && (
        <UserForm initial={editing} isEdit={!!editing._id} roleOptions={rOpts} onSave={onSave} onClose={() => setEditing(null)} />
      )}
    {credentials && <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{display: 'flex', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 14}}>
      <div style={{width: 100, color: 'var(--mut)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase'}}>{label}</div>
      <div style={{flex: 1}}>{value || '—'}</div>
    </div>
  );
}

function UserForm({ initial, isEdit, roleOptions, onSave, onClose }) {
  const [data, setData] = useState(() => ({ ...initial }));
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  function submit(e) { e.preventDefault(); onSave(data); }
  return (
    <Modal title={isEdit ? `Edit ${initial.name || initial.un}` : 'New User'} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Full Name *</label>
        <input value={data.name || ''} onChange={e => set('name', e.target.value)} required />
        <label className="mt-1">Username *</label>
        <input value={data.un || ''} onChange={e => set('un', e.target.value.toLowerCase())} required autoComplete="username" />
        <label className="mt-1">Password {isEdit && '(leave blank to keep current)'}{!isEdit && ' *'}</label>
        <input type="password" value={data.pw || ''} onChange={e => set('pw', e.target.value)} required={!isEdit} autoComplete="new-password" />
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8}}>
          <div>
            <label>Designation *</label>
            <select value={data.designation || ''} onChange={e => {
              set('designation', e.target.value);
              if (e.target.value !== 'project_manager') { set('division', ''); }
              else { set('department', 'PROJECTS'); }
            }} required>
              <option value="">— select —</option>
              {DESIGNATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {data.designation !== 'project_manager' && (
            <div>
              <label>Department *</label>
              <select value={data.department || ''} onChange={e => set('department', e.target.value)} required>
                <option value="">— select —</option>
                {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {data.designation === 'project_manager' && (
          <>
            <label className="mt-1">Division *</label>
            <select value={data.division || ''} onChange={e => {
              set('division', e.target.value);
              set('department', 'PROJECTS'); // auto-set department for Project Manager
            }} required>
              <option value="">— select division —</option>
              {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </>
        )}
        {data.designation && (data.department || data.designation === 'project_manager') && (data.designation !== 'project_manager' || data.division) && (
          <div style={{marginTop: 12, padding: 10, background: '#eef6ff', border: '1px solid #b3d4fc', borderRadius: 6}}>
            <div style={{fontSize: 12, color: '#555', marginBottom: 4}}>This user will be created as:</div>
            <div style={{fontSize: 16, fontWeight: 'bold', color: '#0056b3'}}>
              {orgLabel(data)}
            </div>
          </div>
        )}
        <label className="mt-1">Employee ID</label>
        <input value={data.employeeId || ''} onChange={e => set('employeeId', e.target.value)} placeholder="Optional" />
        <label className="mt-1">Email</label>
        <input type="email" value={data.email || ''} onChange={e => set('email', e.target.value)} />
        <label className="mt-1">Phone</label>
        <input value={data.phone || ''} onChange={e => set('phone', e.target.value)} />
        <div style={{marginTop: 12}}>
          <label style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <input type="checkbox" checked={!!data.disabled} onChange={e => set('disabled', e.target.checked)} style={{width: 'auto'}} />
            <span>Disabled (block sign-in)</span>
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

function CredentialsDialog({ credentials, onClose }) {
  const { un, pw, name, isReset } = credentials;
  const [copied, setCopied] = useState('');
  function copy(text, what) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(''), 2000);
    });
  }
  const both = `Username: ${un}\nPassword: ${pw}`;
  return (
    <Modal title={isReset ? '🔑 Password Reset — Save Now' : '✅ User Created — Save Credentials Now'} onClose={onClose} maxWidth={520}>
      <div style={{ padding: 8 }}>
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <b>⚠️ Important:</b> This is the ONLY time the password is shown. Copy it now — after closing this dialog, the password cannot be viewed again.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold' }}>Full Name</label>
          <div style={{ padding: 8, background: '#f5f5f5', borderRadius: 4 }}>{name}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold' }}>Username</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={un} style={{ flex: 1, fontFamily: 'monospace', fontSize: 14 }} />
            <button type="button" className="btn sec" onClick={() => copy(un, 'un')}>
              {copied === 'un' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold' }}>Password</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={pw} style={{ flex: 1, fontFamily: 'monospace', fontSize: 14 }} />
            <button type="button" className="btn sec" onClick={() => copy(pw, 'pw')}>
              {copied === 'pw' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <button type="button" className="btn" onClick={() => copy(both, 'both')} style={{ width: '100%' }}>
            {copied === 'both' ? '✓ Both Copied to Clipboard' : '📋 Copy Both'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>I have saved the credentials</button>
        </div>
      </div>
    </Modal>
  );
}
