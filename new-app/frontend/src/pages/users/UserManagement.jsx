import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import '../enquiries/enquiry.css';

/**
 * User Management — PWA `vUsers()` exact reproduction.
 *
 * PWA FACT: admin-only. Shows company users table: name, username, role.
 * PWA FACT: `mUser(id)` modal for create/edit with fields: name, role, username, password.
 * PWA FACT: role <select> skips "super" and PM roles whose division the company doesn't subscribe to.
 * PWA FACT: `delUser(id)` — hard delete, no cascade. Can't delete self.
 * PWA FACT: passwords shown in the clear in PWA — NEW APP adaptation: passwords never returned by backend.
 *
 * NOTE: No notification fires for user create/edit/delete (PWA FACT: zero notify() calls).
 */

/* All assignable roles (super excluded per PWA FACT) */
const ASSIGNABLE_ROLES = [
  'admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm',
  'engineer', 'inventory', 'service_mgr', 'service_eng', 'finance',
];

const ROLE_LABELS = {
  admin: 'Admin',
  sales: 'Sales',
  hvac_pm: 'HVAC Project Manager',
  solar_pm: 'Solar Project Manager',
  mep_pm: 'MEP Design Manager',
  engineer: 'Engineer',
  inventory: 'Inventory Manager',
  service_mgr: 'Service Manager',
  service_eng: 'Service Engineer',
  finance: 'Finance',
};

export default function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(null); // null | { userId?: string }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.name || '').toLowerCase().includes(q) ||
           (u.username || '').toLowerCase().includes(q) ||
           (u.role || '').toLowerCase().includes(q);
  });

  async function handleDelete(userId) {
    if (!window.confirm('Remove this user? This cannot be undone.')) return;
    try {
      await api.delete(`/api/users/${userId}`);
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Users</h2>
        <button className="btn btn-primary" onClick={() => setShowModal({})}>+ New User</button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div className="search-bar" style={{ marginBottom: 12 }}>
        <input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && filtered.length === 0 && (
        <div className="panel"><p className="muted">No users found.</p></div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const uid = u.id || u._id;
                const isSelf = String(uid) === String(me?.id);
                return (
                  <tr key={uid}>
                    <td>{u.name}</td>
                    <td>{u.username}</td>
                    <td>{ROLE_LABELS[u.role] || u.role}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setShowModal({ userId: uid })}>Edit</button>
                        {/* PWA FACT: Remove button not rendered for self */}
                        {!isSelf && (
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(uid)}>Remove</button>
                        )}
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
        <UserModal
          userId={showModal.userId}
          onClose={() => setShowModal(null)}
          onSaved={() => { setShowModal(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * PWA `mUser(id)` — create or edit user modal.
 * Fields: name, username, role, password.
 */
function UserModal({ userId, onClose, onSaved }) {
  const isEdit = !!userId;
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('sales');
  const [password, setPassword] = useState('');
  const [loadingUser, setLoadingUser] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    setLoadingUser(true);
    api.get(`/api/users/${userId}`)
      .then(data => {
        const u = data.user;
        setName(u.name || '');
        setUsername(u.username || '');
        setRole(u.role || 'sales');
      })
      .catch(err => alert(err.message))
      .finally(() => setLoadingUser(false));
  }, [isEdit, userId]);

  async function handleSave() {
    if (!name.trim()) { alert('Name is required.'); return; }
    if (!username.trim()) { alert('Username is required.'); return; }
    if (!isEdit && !password) { alert('Password is required.'); return; }

    setSaving(true);
    try {
      if (isEdit) {
        const body = { name: name.trim(), username: username.trim(), role };
        if (password) body.password = password;
        await api.patch(`/api/users/${userId}`, body);
      } else {
        await api.post('/api/users', {
          name: name.trim(),
          username: username.trim(),
          role,
          password,
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
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3>{isEdit ? 'Edit User' : 'New User'}</h3>
        {loadingUser ? <p className="muted">Loading...</p> : (
          <>
            <div className="form-grid">
              <label>Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} />
              <label>Username *</label>
              <input value={username} onChange={e => setUsername(e.target.value)} />
              <label>Role *</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                {ASSIGNABLE_ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                ))}
              </select>
              <label>Password {isEdit ? '(leave blank to keep)' : '*'}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={isEdit ? '(unchanged)' : ''} />
            </div>
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
