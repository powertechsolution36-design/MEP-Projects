import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import '../enquiries/enquiry.css';

/**
 * Single checklist template detail — PWA `vChklist()` exact reproduction.
 *
 * PWA FACT: shows template name, division, items list with text + signResponsibility.
 * PWA FACT: editable actions (if canEditChk): rename, add point, edit point, remove point, move ↑↓.
 * PWA FACT: `mChkPoint(id,i)` modal for add/edit item — text + signResponsibility(ENGINEER/CLIENT/SALES/SERVICE).
 * PWA FACT: `moveChkPoint(id,i,d)` — direction -1 (up) or 1 (down), adjacent swap.
 * PWA FACT: `rmChkPoint(id,i)` — confirm then remove.
 */

const SIGN_RESPONSIBILITIES = ['ENGINEER', 'CLIENT', 'SALES', 'SERVICE'];
const PM_DIV = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

function canEdit(role) {
  return role === 'admin' || !!PM_DIV[role];
}

export default function ChecklistTemplateDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPointModal, setShowPointModal] = useState(null); // null | { index: number } (-1 = add)
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/checklist-templates/${id}`);
      setTemplate(data.template);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const editable = canEdit(user?.role);
  const items = template?.items || [];

  async function handleRename() {
    if (!renameVal.trim()) { alert('Enter name.'); return; }
    try {
      await api.patch(`/api/checklist-templates/${id}/rename`, { name: renameVal.trim() });
      setRenaming(false);
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleMove(index, direction) {
    try {
      await api.post(`/api/checklist-templates/${id}/items/${index}/move`, { direction });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleRemovePoint(index) {
    if (!window.confirm('Remove this checklist point?')) return;
    try {
      await api.delete(`/api/checklist-templates/${id}/items/${index}`);
      load();
    } catch (err) { alert(err.message); }
  }

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  if (error) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!template) return <div className="enq-page"><p className="muted">Not found.</p></div>;

  return (
    <div className="enq-page">
      <div className="enq-header">
        <div>
          <button className="btn btn-sm" onClick={() => navigate('/checklists')} style={{ marginRight: 12 }}>← Back</button>
          {renaming ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input value={renameVal} onChange={e => setRenameVal(e.target.value)} style={{ fontSize: 16 }} />
              <button className="btn btn-sm btn-primary" onClick={handleRename}>Save</button>
              <button className="btn btn-sm" onClick={() => setRenaming(false)}>Cancel</button>
            </span>
          ) : (
            <span>
              <h2 style={{ display: 'inline' }}>{template.name}</h2>
              {editable && (
                <button className="btn btn-sm" style={{ marginLeft: 10 }}
                  onClick={() => { setRenameVal(template.name); setRenaming(true); }}>
                  Rename
                </button>
              )}
            </span>
          )}
        </div>
        {editable && (
          <button className="btn btn-primary" onClick={() => setShowPointModal({ index: -1 })}>
            + Add Point
          </button>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="detail-grid">
          <span className="muted">Division</span><span>{template.division}</span>
          <span className="muted">Default</span><span>{template.isDefault ? 'Yes' : 'No'}</span>
          <span className="muted">Points</span><span>{items.length}</span>
        </div>
      </div>

      {items.length === 0 && (
        <div className="panel"><p className="muted">No checklist points yet.</p></div>
      )}

      {items.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Sign Responsibility</th>
                {editable && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{item.text}</td>
                  <td>{item.signResponsibility}</td>
                  {editable && (
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" disabled={i === 0} onClick={() => handleMove(i, -1)}>↑</button>
                        <button className="btn btn-sm" disabled={i === items.length - 1} onClick={() => handleMove(i, 1)}>↓</button>
                        <button className="btn btn-sm" onClick={() => setShowPointModal({ index: i })}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleRemovePoint(i)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPointModal && (
        <PointModal
          templateId={id}
          index={showPointModal.index}
          existing={showPointModal.index >= 0 ? items[showPointModal.index] : null}
          onClose={() => setShowPointModal(null)}
          onSaved={() => { setShowPointModal(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * PWA `mChkPoint(id,i)` — add or edit a checklist point.
 * Fields: text (description), signResponsibility (ENGINEER/CLIENT/SALES/SERVICE).
 */
function PointModal({ templateId, index, existing, onClose, onSaved }) {
  const [text, setText] = useState(existing?.text || '');
  const [sign, setSign] = useState(existing?.signResponsibility || 'ENGINEER');
  const [saving, setSaving] = useState(false);
  const isEdit = index >= 0;

  async function handleSave() {
    if (!text.trim()) { alert('Enter description.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/checklist-templates/${templateId}/items/${index}`, {
          text: text.trim(),
          signResponsibility: sign,
        });
      } else {
        await api.post(`/api/checklist-templates/${templateId}/items`, {
          text: text.trim(),
          signResponsibility: sign,
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
        <h3>{isEdit ? 'Edit Point' : 'Add Point'}</h3>
        <div className="form-grid">
          <label>Description *</label>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Checklist point description" />
          <label>Sign Responsibility</label>
          <select value={sign} onChange={e => setSign(e.target.value)}>
            {SIGN_RESPONSIBILITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
