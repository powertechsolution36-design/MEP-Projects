import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Checklist Template Library — PWA `vChecklists()` exact reproduction.
 *
 * PWA FACT: templates are listed grouped by division tabs (HVAC, Solar, MEP).
 * PWA FACT: `canEditChk()` gate: admin or any division-PM role (hvac_pm, solar_pm, mep_pm).
 * PWA FACT: PM roles only see their own division's templates (myDiv()).
 * PWA FACT: admin/other roles see all divisions.
 * PWA FACT: actions: New, Duplicate, Set Default, Delete.
 * PWA FACT: minimum 1 template per division enforced on delete.
 */

const DIVISIONS = ['HVAC', 'Solar', 'MEP'];

const PM_DIV = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

/* PWA FACT: canEditChk() — admin or any PM_DIV role */
function canEdit(role) {
  return role === 'admin' || !!PM_DIV[role];
}

export default function ChecklistTemplateList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const myDiv = PM_DIV[user?.role] || null;
  const [activeDivision, setActiveDivision] = useState(myDiv || 'HVAC');
  const [showNewModal, setShowNewModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* PWA FACT: PM roles fetch only their division; admin/other fetches all */
      const url = myDiv
        ? `/api/checklist-templates?division=${myDiv}`
        : '/api/checklist-templates';
      const data = await api.get(url);
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [myDiv]);

  useEffect(() => { load(); }, [load]);

  const filtered = templates.filter(t => t.division === activeDivision);
  const editable = canEdit(user?.role);
  const visibleDivs = myDiv ? [myDiv] : DIVISIONS;

  async function handleDuplicate(id) {
    if (!window.confirm('Duplicate this checklist?')) return;
    try {
      await api.post(`/api/checklist-templates/${id}/duplicate`);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleSetDefault(id) {
    try {
      await api.post(`/api/checklist-templates/${id}/set-default`);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this checklist template?')) return;
    try {
      await api.delete(`/api/checklist-templates/${id}`);
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Checklist Templates</h2>
        {editable && (
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
            + New Checklist
          </button>
        )}
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Division tabs — PWA groups templates by division */}
      {visibleDivs.length > 1 && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
          {visibleDivs.map(d => (
            <button
              key={d}
              className={`btn ${activeDivision === d ? 'btn-primary' : ''}`}
              style={{ borderRadius: 0, flex: 1 }}
              onClick={() => setActiveDivision(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="muted">Loading...</p>}

      {!loading && filtered.length === 0 && (
        <div className="panel"><p className="muted">No templates for {activeDivision}.</p></div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Items</th>
                <th>Default</th>
                <th>Created</th>
                {editable && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const tid = t.id || t._id;
                return (
                  <tr key={tid} style={{ cursor: 'pointer' }}>
                    <td onClick={() => navigate(`/checklists/${tid}`)}>{t.name}</td>
                    <td onClick={() => navigate(`/checklists/${tid}`)}>{(t.items || []).length}</td>
                    <td onClick={() => navigate(`/checklists/${tid}`)}>
                      {t.isDefault ? <span className="status-badge" style={{ background: '#4caf50', color: '#fff' }}>Default</span> : '—'}
                    </td>
                    <td onClick={() => navigate(`/checklists/${tid}`)}>{fmtDate(t.createdDate)}</td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" onClick={() => handleDuplicate(tid)}>Duplicate</button>
                          {!t.isDefault && <button className="btn btn-sm" onClick={() => handleSetDefault(tid)}>Set Default</button>}
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(tid)}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNewModal && (
        <NewChecklistModal
          division={activeDivision}
          templates={filtered}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); load(); }}
        />
      )}
    </div>
  );
}

/**
 * PWA `mNewChkList` / `createChkList` modal.
 * Fields: name, optional "start from" source template, set as default checkbox.
 */
function NewChecklistModal({ division, templates, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { alert('Enter checklist name.'); return; }
    setSaving(true);
    try {
      const body = { division, name: name.trim(), isDefault };
      if (sourceId) body.sourceTemplateId = sourceId;
      await api.post('/api/checklist-templates', body);
      onCreated();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3>New {division} Checklist</h3>
        <div className="form-grid">
          <label>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Checklist name" />
          <label>Start From</label>
          <select value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">— blank —</option>
            {templates.map(t => (
              <option key={t.id || t._id} value={t.id || t._id}>{t.name}</option>
            ))}
          </select>
          <label>Default?</label>
          <label style={{ fontWeight: 'normal' }}>
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            {' '}Set as division default
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
