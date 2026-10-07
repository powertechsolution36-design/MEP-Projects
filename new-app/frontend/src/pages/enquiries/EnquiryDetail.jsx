import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import './enquiry.css';

/**
 * Enquiry Detail — PWA `vEnq(x)` exact reproduction.
 *
 * Shows all fields + status badge.
 * Edit button (opens form modal).
 * For Open: "Confirmed -> Create SO" button (navigates to conversion form).
 * For Open: "Mark Lost" button (opens lost modal).
 * For Lost: "Reopen" button. Lost fields shown (lostReason/lostDate).
 * Follow-up input form + log history.
 *
 * PWA FACT: reopenEnq does NOT clear lostReason/lostDate — stale values preserved.
 */

const LOST_REASONS = [
  'Price too high',
  'Lost to competitor',
  'Client dropped the project',
  'Budget not approved',
  'No response from client',
  'Other',
];

export default function EnquiryDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [enq, setEnq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Follow-up form state
  const [fuDone, setFuDone] = useState('');
  const [fuNext, setFuNext] = useState('');
  const [fuNd, setFuNd] = useState('');

  // Mark Lost modal state
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [lostRemark, setLostRemark] = useState('');

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/enquiries/${id}`);
      setEnq(data.enquiry);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleFollowUp(e) {
    e.preventDefault();
    if (!fuDone) { alert('Action done is required.'); return; }
    setBusy(true);
    try {
      const data = await api.post(`/api/enquiries/${id}/follow-ups`, {
        actionDone: fuDone,
        nextActionDescription: fuNext || undefined,
        nextActionDate: fuNd || undefined,
      });
      setEnq(data.enquiry);
      setFuDone(''); setFuNext(''); setFuNd('');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkLost() {
    setBusy(true);
    try {
      const data = await api.post(`/api/enquiries/${id}/mark-lost`, {
        reason: lostReason,
        remark: lostRemark,
      });
      setEnq(data.enquiry);
      setShowLostModal(false);
      setLostReason(''); setLostRemark('');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!confirm('Reopen this enquiry?')) return;
    setBusy(true);
    try {
      const data = await api.post(`/api/enquiries/${id}/reopen`);
      setEnq(data.enquiry);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    setEditData({
      name: enq.name || '',
      siteType: enq.siteType || '',
      capacity: enq.capacity || '',
      segment: enq.segment || '',
      phone: enq.phone || '',
      referenceSource: enq.referenceSource || '',
      rating: enq.rating || '',
      estimatedValue: enq.estimatedValue || '',
      remark: enq.remark || '',
    });
    setShowEditModal(true);
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editData.name) { alert('Project name is required.'); return; }
    setBusy(true);
    try {
      const data = await api.patch(`/api/enquiries/${id}`, editData);
      setEnq(data.enquiry);
      setShowEditModal(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!enq) return <p className="muted">Enquiry not found.</p>;

  const canManage = ['sales', 'admin'].includes(user?.role);

  return (
    <div className="enq-page">
      <button className="btn sec sm" onClick={() => navigate(-1)}>&larr; Back</button>

      <div className="panel detail-panel">
        <div className="detail-head">
          <h2>{enq.name}</h2>
          <span className={`status-badge status-${(enq.status || '').toLowerCase()}`}>{enq.status}</span>
        </div>

        <div className="detail-grid">
          <div><strong>Site Type:</strong> {enq.siteType}</div>
          <div><strong>Capacity:</strong> {enq.capacity}</div>
          <div><strong>Segment:</strong> {enq.segment}</div>
          <div><strong>Customer Phone:</strong> {enq.phone}</div>
          <div><strong>Reference:</strong> {enq.referenceSource}</div>
          <div><strong>Rating:</strong> {enq.rating}</div>
          <div><strong>Estimated Value:</strong> {money(enq.estimatedValue)}</div>
          <div><strong>Review Date:</strong> {fmtDate(enq.lastReviewDate)}</div>
          <div><strong>Remark:</strong> {enq.remark}</div>
          {enq.lastActionDone && <div><strong>Last Action:</strong> {enq.lastActionDone}</div>}
          {enq.nextActionDescription && <div><strong>Next Action:</strong> {enq.nextActionDescription}</div>}
          {enq.nextActionDate && <div><strong>Next Date:</strong> {fmtDate(enq.nextActionDate)}</div>}
        </div>

        {/* Lost fields — shown when status is Lost (PWA FACT: also shown after reopen since lostReason/lostDate are stale) */}
        {(enq.status === 'Lost' || enq.lostReason || enq.lostDate) && (
          <div className="lost-info">
            <strong>Lost Reason:</strong> {enq.lostReason || '(none)'}
            <br />
            <strong>Lost Date:</strong> {fmtDate(enq.lostDate)}
          </div>
        )}

        {canManage && (
          <div className="detail-actions">
            <button className="btn sec sm" onClick={openEdit}>✏️ Edit</button>
            {enq.status === 'Open' && (
              <>
                <button className="btn pri sm" onClick={() => navigate(`/enquiries/${id}/convert`)}>
                  Confirmed → Create SO
                </button>
                <button className="btn danger sm" onClick={() => setShowLostModal(true)}>Mark Lost</button>
              </>
            )}
            {enq.status === 'Lost' && (
              <button className="btn sec sm" onClick={handleReopen} disabled={busy}>Reopen</button>
            )}
          </div>
        )}
      </div>

      {/* Follow-up form — PWA addFollow */}
      {canManage && enq.status === 'Open' && (
        <div className="panel">
          <h3>Add Follow-Up</h3>
          <form onSubmit={handleFollowUp} className="follow-up-form">
            <div className="fu-row">
              <div className="filter-field">
                <label>Action Done *</label>
                <input value={fuDone} onChange={e => setFuDone(e.target.value)} placeholder="What was done" />
              </div>
              <div className="filter-field">
                <label>Next Action</label>
                <input value={fuNext} onChange={e => setFuNext(e.target.value)} placeholder="Next step" />
              </div>
              <div className="filter-field">
                <label>Next Date</label>
                <input type="date" value={fuNd} onChange={e => setFuNd(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn pri sm" disabled={busy}>Save Follow-Up</button>
          </form>
        </div>
      )}

      {/* Follow-up log — PWA x.log */}
      {enq.followUpLog && enq.followUpLog.length > 0 && (
        <div className="panel">
          <h3>Follow-Up History</h3>
          <ul className="log-list">
            {[...enq.followUpLog].reverse().map((entry, i) => (
              <li key={i}>
                <span className="log-date">{fmtDate(entry.date)}</span>
                <span className="log-text">{entry.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mark Lost Modal */}
      {showLostModal && (
        <div className="modal-overlay" onClick={() => setShowLostModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Mark Enquiry as Lost</h3>
            <div className="filter-field">
              <label>Reason</label>
              <select value={lostReason} onChange={e => setLostReason(e.target.value)}>
                <option value="">— select —</option>
                {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Remark</label>
              <textarea value={lostRemark} onChange={e => setLostRemark(e.target.value)} rows={3} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowLostModal(false)}>Cancel</button>
              <button className="btn danger sm" onClick={handleMarkLost} disabled={busy}>Mark Lost</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Edit Enquiry</h3>
            <form onSubmit={handleEdit}>
              <div className="form-grid">
                <div className="filter-field">
                  <label>Project Name *</label>
                  <input value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Site Type</label>
                  <select value={editData.siteType} onChange={e => setEditData(d => ({ ...d, siteType: e.target.value }))}>
                    <option value="">—</option>
                    {['Residential', 'Commercial', 'Factory', 'Banquet Hall', 'Hospital', 'Office'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Capacity</label>
                  <input value={editData.capacity} onChange={e => setEditData(d => ({ ...d, capacity: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Segment *</label>
                  <select value={editData.segment} onChange={e => setEditData(d => ({ ...d, segment: e.target.value }))}>
                    <option value="">—</option>
                    {['HVAC', 'Solar', 'MEP', 'AMC'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Customer Phone</label>
                  <input value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Reference</label>
                  <input value={editData.referenceSource} onChange={e => setEditData(d => ({ ...d, referenceSource: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Rating (1-5)</label>
                  <select value={editData.rating} onChange={e => setEditData(d => ({ ...d, rating: Number(e.target.value) }))}>
                    <option value="">—</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Estimated Value</label>
                  <input type="number" value={editData.estimatedValue} onChange={e => setEditData(d => ({ ...d, estimatedValue: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="filter-field">
                <label>Remark</label>
                <textarea value={editData.remark} onChange={e => setEditData(d => ({ ...d, remark: e.target.value }))} rows={2} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec sm" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn pri sm" disabled={busy}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
