import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import useMyDivisions from '../../hooks/useMyDivisions';
import ContactsField, { ContactsList } from '../../components/ContactsField';

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
  const myDivisions = useMyDivisions(); // PWA myDivs()
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


  /*
   * Owner request (20 Nov 2026): "Enquiries required to allocate sales
   * engineer or admin." Admin allocates; a sales login sees whose it is
   * but cannot move it.
   */
  const canAllocate = user?.role === 'admin';
  const [salesOptions, setSalesOptions] = useState([]);
  const [allocError, setAllocError] = useState('');
  useEffect(() => {
    if (!canAllocate) return;
    api.get('/api/enquiries/sales-candidates')
      .then((d) => setSalesOptions(d.candidates || []))
      .catch((err) => setAllocError(err.message));
  }, [canAllocate]);

  async function allocateTo(userId) {
    setAllocError('');
    setBusy(true);
    try {
      const d = await api.patch(`/api/enquiries/${id}/sales`, { assignedSalesUserId: userId || null });
      setEnq((prev) => ({ ...prev, ...d.enquiry }));
      await load();
    } catch (err) {
      setAllocError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEnquiry() {
    if (!window.confirm(`Delete enquiry "${enq.name}"? There is no undo.`)) return;
    try {
      await api.delete(`/api/enquiries/${id}`);
      navigate('/enquiries');
    } catch (err) { alert(err.message); }
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
      // Owner request (5 Nov 2026): the other people at the site.
      contacts: (enq.contacts || []).map((c) => ({ ...c })),
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
          {/* Owner request (20 Nov 2026): whose lead this is. */}
          <div><strong>Sales:</strong> {enq.assignedSalesName || 'Not allocated'}</div>
        </div>

        {canAllocate && (
          <p style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="alloc-sales"><strong>Allocate to:</strong></label>
            <select
              id="alloc-sales"
              value={enq.assignedSalesUserId ? String(enq.assignedSalesUserId) : ''}
              disabled={busy}
              onChange={(e) => allocateTo(e.target.value)}
            >
              <option value="">— nobody (every sales login sees it) —</option>
              {salesOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {allocError && <span className="err">{allocError}</span>}
          </p>
        )}

        {(enq.contacts || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong>Contacts at this site</strong>
            <ContactsList contacts={enq.contacts} />
          </div>
        )}

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
            {/* Owner request (20 Nov 2026): admin alone. A lead that became
                an order is refused by the server, naming the order. */}
            {user?.role === 'admin' && (
              <button className="btn danger sm" onClick={handleDeleteEnquiry}>🗑 Delete</button>
            )}
            {enq.status === 'Open' && (
              <>
                {/* Owner decision (14 Nov 2026): a lead is quoted before it
                    becomes an order. The sales order is created from the
                    quotation once the customer accepts it. */}
                <button className="btn pri sm" onClick={() => navigate(`/quotations/new?enquiryId=${id}`)}>
                  Quote this
                </button>
                {/* Owner request (20 Nov 2026): "Their no option for sales
                    order." An order can be raised straight from the lead,
                    which marks the lead Won when it saves — the quotation
                    route does the same thing and is still there. */}
                <button className="btn pri sm" onClick={() => navigate(`/sales-orders/new?enquiryId=${id}`)}>
                  Create Sales Order
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

      {/* Owner request (21 Nov 2026): "Quotation already created but here
          not showing that quote" — and "All quotation need to belong to
          enquiries only". The lead is now where its quotations are found:
          every one raised from it, newest first, each opening the document
          itself. A lead with none says so and offers to raise one. */}
      <div className="panel">
        <h3>Quotations <span className="muted" style={{ fontWeight: 400 }}>({(enq.quotations || []).length})</span></h3>
        {(enq.quotations || []).length === 0 ? (
          <p className="muted">
            No quotation raised from this enquiry yet.
            {canManage && enq.status === 'Open' ? ' Use “Quote this” above to raise one.' : ''}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stacks-on-phone" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Division</th>
                  <th>Status</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {enq.quotations.map((q) => (
                  <tr key={q.id} className="clickable-row" onClick={() => navigate(`/quotations/${q.id}`)}>
                    <td data-label="Number"><strong>{q.quotationNumber || '—'}</strong></td>
                    <td data-label="Date">{fmtDate(q.date) || '—'}</td>
                    <td data-label="Division">{q.division || '—'}</td>
                    <td data-label="Status"><span className="status-badge">{q.status || '—'}</span></td>
                    <td data-label="Value">{q.grandTotal == null ? '—' : money(q.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    {[...myDivisions, 'AMC'].map(o => <option key={o}>{o}</option>)}
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
              <ContactsField
                value={editData.contacts}
                onChange={(contacts) => setEditData(d => ({ ...d, contacts }))}
                label="Contacts at this site"
              />
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
