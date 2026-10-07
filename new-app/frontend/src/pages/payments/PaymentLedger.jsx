import { useState, useEffect, useCallback } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Payment Ledger — PWA `vPayments()` exact reproduction.
 *
 * PWA MENUS: only finance + admin have the Payments menu item.
 * Sections: KPI bar, pending payments table, receipts ledger, settled milestones,
 *   manual add section.
 * Export buttons: dlPayments (pending CSV), dlReceipts (receipts CSV).
 *
 * PWA payment model:
 *   payRcvd(x) = sum of partPayments[].amount
 *   payBal(x) = max(0, amount - payRcvd(x))
 *   syncPayStatus: if balance <= 0 -> Received, else -> Pending
 *
 * Modes: Bank Transfer/NEFT, Cheque, UPI, Cash, RTGS
 * Overpayment guard: amount > balance requires confirmOverpayment flag
 */

const PAYMENT_MODES = ['Bank Transfer/NEFT', 'Cheque', 'UPI', 'Cash', 'RTGS'];

export default function PaymentLedger() {
  const { user } = useAuth();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Add Part Payment modal
  const [addTarget, setAddTarget] = useState(null);
  const [addForm, setAddForm] = useState({ amount: '', date: '', mode: 'Bank Transfer/NEFT', reference: '', remark: '', invoiceIssued: false });
  const [busy, setBusy] = useState(false);

  // Payment History modal
  const [historyTarget, setHistoryTarget] = useState(null);

  // Edit Part Payment modal
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Follow-up modal
  const [followTarget, setFollowTarget] = useState(null);
  const [followForm, setFollowForm] = useState({ lastCallDate: '', nextCallDate: '', discussionNotes: '', remark: '' });

  // Manual Add modal
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ projectOrReference: '', amount: '', personName: '', phone: '', remark: '' });

  // Edit Milestone modal
  const [editMilTarget, setEditMilTarget] = useState(null);
  const [editMilForm, setEditMilForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/payments');
      setPayments(data.payments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Computed values (PWA payRcvd, payBal)
  function received(p) { return (p.partPayments || []).reduce((a, pp) => a + (Number(pp.amount) || 0), 0); }
  function balance(p) { return Math.max(0, (p.amount || 0) - received(p)); }

  // Filter by search
  const filtered = payments.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [p.projectOrReference, p.personName, p.phone, p.remark, p.status]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const pending = filtered.filter(p => p.status === 'Pending');
  const settled = filtered.filter(p => p.status === 'Received');

  // KPIs
  const totalBilled = filtered.reduce((a, p) => a + (p.amount || 0), 0);
  const totalCollected = filtered.reduce((a, p) => a + received(p), 0);
  const outstanding = totalBilled - totalCollected;
  const partPaid = filtered.filter(p => p.status === 'Pending' && received(p) > 0).length;
  const raisedCount = filtered.filter(p => p.raisedToFinance).length;

  // Add Part Payment
  function openAddPayment(p) {
    const bal = balance(p);
    setAddTarget(p);
    setAddForm({ amount: bal > 0 ? String(bal) : '', date: new Date().toISOString().slice(0, 10), mode: 'Bank Transfer/NEFT', reference: '', remark: '', invoiceIssued: false });
  }

  async function handleAddPayment() {
    if (!addTarget) return;
    const amt = Number(addForm.amount);
    if (!amt || amt <= 0) { alert('Enter amount received.'); return; }
    const bal = balance(addTarget);
    let confirmOverpayment = false;
    if (amt > bal) {
      if (!confirm(`Amount ₹${amt} is more than the balance of ₹${bal}. Proceed?`)) return;
      confirmOverpayment = true;
    }
    setBusy(true);
    try {
      await api.post(`/api/payments/${addTarget.id}/part-payments`, {
        amount: amt,
        date: addForm.date || undefined,
        mode: addForm.mode,
        reference: addForm.reference,
        remark: addForm.remark,
        invoiceIssued: addForm.invoiceIssued,
        confirmOverpayment,
      });
      setAddTarget(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Edit Part Payment
  function openEditPayment(payment, pp) {
    setEditTarget({ paymentId: payment.id, partPaymentId: pp.id });
    setEditForm({
      amount: pp.amount || '',
      date: fmtDate(pp.date),
      mode: pp.mode || 'Bank Transfer/NEFT',
      reference: pp.reference || '',
      remark: pp.remark || '',
      invoiceIssued: !!pp.invoiceIssued,
    });
  }

  async function handleEditPayment() {
    if (!editTarget) return;
    const amt = Number(editForm.amount);
    if (!amt || amt <= 0) { alert('Enter a valid amount.'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/payments/${editTarget.paymentId}/part-payments/${editTarget.partPaymentId}`, {
        amount: amt,
        date: editForm.date || undefined,
        mode: editForm.mode,
        reference: editForm.reference,
        remark: editForm.remark,
        invoiceIssued: editForm.invoiceIssued,
      });
      setEditTarget(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Delete Part Payment
  async function handleDeletePartPayment(paymentId, partPaymentId) {
    if (!confirm('Remove this payment entry? This may revert a settled milestone to pending.')) return;
    setBusy(true);
    try {
      await api.delete(`/api/payments/${paymentId}/part-payments/${partPaymentId}`);
      setHistoryTarget(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Delete whole payment record (only non-SO-linked)
  async function handleDeleteRecord(paymentId) {
    if (!confirm('Delete this payment record? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/api/payments/${paymentId}`);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Follow-up
  function openFollowUp(p) {
    setFollowTarget(p);
    setFollowForm({
      lastCallDate: fmtDate(p.lastCallDate),
      nextCallDate: fmtDate(p.nextCallDate),
      discussionNotes: p.discussionNotes || '',
      remark: p.remark || '',
    });
  }

  async function handleFollowUp() {
    if (!followTarget) return;
    setBusy(true);
    try {
      await api.post(`/api/payments/${followTarget.id}/follow-up`, followForm);
      setFollowTarget(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Manual Add
  async function handleManualAdd() {
    if (!manualForm.projectOrReference || !manualForm.amount) {
      alert('Project/reference and amount are required.'); return;
    }
    setBusy(true);
    try {
      await api.post('/api/payments', {
        projectOrReference: manualForm.projectOrReference,
        amount: Number(manualForm.amount),
        personName: manualForm.personName,
        phone: manualForm.phone,
        remark: manualForm.remark,
      });
      setShowManualAdd(false);
      setManualForm({ projectOrReference: '', amount: '', personName: '', phone: '', remark: '' });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Edit Milestone
  function openEditMilestone(p) {
    setEditMilTarget(p);
    setEditMilForm({
      projectOrReference: p.projectOrReference || '',
      amount: p.amount || '',
      personName: p.personName || '',
      phone: p.phone || '',
      remark: p.remark || '',
    });
  }

  async function handleEditMilestone() {
    if (!editMilTarget) return;
    setBusy(true);
    try {
      await api.patch(`/api/payments/${editMilTarget.id}/milestone`, {
        ...editMilForm,
        amount: Number(editMilForm.amount) || undefined,
      });
      setEditMilTarget(null);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Export handlers
  async function exportPending() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/payments/export/pending.csv`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'pending-payments.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  async function exportReceipts() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/payments/export/receipts.csv`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'payment-receipts.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  return (
    <div className="pay-page">
      <div className="pay-header">
        <h2>💰 Payments</h2>
        <div className="pay-actions">
          <button className="btn sec sm" onClick={exportPending}>📥 Pending CSV</button>
          <button className="btn sec sm" onClick={exportReceipts}>📥 Receipts CSV</button>
          <button className="btn pri sm" onClick={() => setShowManualAdd(true)}>+ Add Payment</button>
        </div>
      </div>

      {/* KPI Bar */}
      <div className="kpi-bar">
        <div className="kpi-card"><div className="kpi-label">Total Billed</div><div className="kpi-value">{money(totalBilled)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Collected</div><div className="kpi-value">{money(totalCollected)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Outstanding</div><div className="kpi-value">{money(outstanding)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Part-paid Milestones</div><div className="kpi-value">{partPaid}</div></div>
        <div className="kpi-card"><div className="kpi-label">Raised by PM</div><div className="kpi-value">{raisedCount}</div></div>
      </div>

      <div className="search-bar">
        <input placeholder="Search payments..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {/* Pending Payments Table */}
      {!loading && pending.length > 0 && (
        <div className="panel">
          <h3>Pending Payments ({pending.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Person</th>
                  <th>Phone</th>
                  <th>Amount</th>
                  <th>Received</th>
                  <th>Balance</th>
                  <th>Raised</th>
                  <th>Remark</th>
                  <th>Last Call</th>
                  <th>Discussion</th>
                  <th>Next Call</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(p => (
                  <tr key={p.id}>
                    <td>{p.projectOrReference}</td>
                    <td>{p.personName}</td>
                    <td>{p.phone}</td>
                    <td>{money(p.amount)}</td>
                    <td>{money(received(p))}</td>
                    <td>{money(balance(p))}</td>
                    <td>{p.raisedToFinance ? '✅' : ''}</td>
                    <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.remark}</td>
                    <td>{fmtDate(p.lastCallDate)}</td>
                    <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.discussionNotes}</td>
                    <td>{fmtDate(p.nextCallDate)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn pri sm" onClick={() => openAddPayment(p)}>+ Pay</button>
                        <button className="btn sec sm" onClick={() => setHistoryTarget(p)}>History</button>
                        <button className="btn sec sm" onClick={() => openFollowUp(p)}>Follow-up</button>
                        <button className="btn sec sm" onClick={() => openEditMilestone(p)}>Edit</button>
                        {!p.salesOrderId && <button className="btn danger sm" onClick={() => handleDeleteRecord(p.id)}>Del</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settled Milestones */}
      {!loading && settled.length > 0 && (
        <div className="panel">
          <h3>Settled Milestones ({settled.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Person</th>
                  <th>Amount</th>
                  <th>Received Date</th>
                  <th>Payments</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {settled.map(p => (
                  <tr key={p.id}>
                    <td>{p.projectOrReference}</td>
                    <td>{p.personName}</td>
                    <td>{money(p.amount)}</td>
                    <td>{fmtDate(p.receivedDate)}</td>
                    <td>{(p.partPayments || []).length} entries</td>
                    <td>
                      <button className="btn sec sm" onClick={() => setHistoryTarget(p)}>History</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && filtered.length === 0 && <p className="muted">No payment records found.</p>}

      {/* Add Part Payment Modal */}
      {addTarget && (
        <div className="modal-overlay" onClick={() => setAddTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Payment — {addTarget.projectOrReference}</h3>
            <p className="muted">Milestone: {money(addTarget.amount)} | Received: {money(received(addTarget))} | Balance: {money(balance(addTarget))}</p>
            <div className="filter-field"><label>Amount *</label><input type="number" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="filter-field"><label>Date</label><input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="filter-field">
              <label>Mode</label>
              <select value={addForm.mode} onChange={e => setAddForm(f => ({ ...f, mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="filter-field"><label>Reference</label><input value={addForm.reference} onChange={e => setAddForm(f => ({ ...f, reference: e.target.value }))} /></div>
            <div className="filter-field"><label>Remark</label><input value={addForm.remark} onChange={e => setAddForm(f => ({ ...f, remark: e.target.value }))} /></div>
            <div className="filter-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={addForm.invoiceIssued} onChange={e => setAddForm(f => ({ ...f, invoiceIssued: e.target.checked }))} />
              <label>Invoice Issued</label>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setAddTarget(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleAddPayment} disabled={busy}>Add Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyTarget && (
        <div className="modal-overlay" onClick={() => setHistoryTarget(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Payment History — {historyTarget.projectOrReference}</h3>
            <p className="muted">Total: {money(historyTarget.amount)} | Received: {money(received(historyTarget))} | Balance: {money(balance(historyTarget))}</p>
            {(historyTarget.partPayments || []).length === 0 ? (
              <p className="muted">No payments recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Mode</th>
                      <th>Reference</th>
                      <th>Invoice</th>
                      <th>Remark</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyTarget.partPayments || []).map((pp, i) => (
                      <tr key={pp.id || i}>
                        <td>{i + 1}</td>
                        <td>{fmtDate(pp.date)}</td>
                        <td>{money(pp.amount)}</td>
                        <td>{pp.mode}</td>
                        <td>{pp.reference}</td>
                        <td>{pp.invoiceIssued ? 'Yes' : 'No'}</td>
                        <td>{pp.remark}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn sec sm" onClick={() => openEditPayment(historyTarget, pp)}>Edit</button>
                            <button className="btn danger sm" onClick={() => handleDeletePartPayment(historyTarget.id, pp.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setHistoryTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Part Payment Modal */}
      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Payment Entry</h3>
            <div className="filter-field"><label>Amount *</label><input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="filter-field"><label>Date</label><input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="filter-field">
              <label>Mode</label>
              <select value={editForm.mode} onChange={e => setEditForm(f => ({ ...f, mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="filter-field"><label>Reference</label><input value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} /></div>
            <div className="filter-field"><label>Remark</label><input value={editForm.remark} onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))} /></div>
            <div className="filter-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={editForm.invoiceIssued} onChange={e => setEditForm(f => ({ ...f, invoiceIssued: e.target.checked }))} />
              <label>Invoice Issued</label>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleEditPayment} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Modal */}
      {followTarget && (
        <div className="modal-overlay" onClick={() => setFollowTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Follow-up — {followTarget.projectOrReference}</h3>
            <div className="filter-field"><label>Last Call Date</label><input type="date" value={followForm.lastCallDate} onChange={e => setFollowForm(f => ({ ...f, lastCallDate: e.target.value }))} /></div>
            <div className="filter-field"><label>Next Call Date</label><input type="date" value={followForm.nextCallDate} onChange={e => setFollowForm(f => ({ ...f, nextCallDate: e.target.value }))} /></div>
            <div className="filter-field"><label>Discussion Notes</label><textarea value={followForm.discussionNotes} onChange={e => setFollowForm(f => ({ ...f, discussionNotes: e.target.value }))} rows={3} /></div>
            <div className="filter-field"><label>Remark</label><textarea value={followForm.remark} onChange={e => setFollowForm(f => ({ ...f, remark: e.target.value }))} rows={2} /></div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setFollowTarget(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleFollowUp} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showManualAdd && (
        <div className="modal-overlay" onClick={() => setShowManualAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Manual Payment</h3>
            <p className="muted">SO-linked milestones are added automatically. Use this only for other receivables.</p>
            <div className="filter-field"><label>Project / Reference *</label><input value={manualForm.projectOrReference} onChange={e => setManualForm(f => ({ ...f, projectOrReference: e.target.value }))} /></div>
            <div className="filter-field"><label>Amount *</label><input type="number" value={manualForm.amount} onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="filter-field"><label>Person Name</label><input value={manualForm.personName} onChange={e => setManualForm(f => ({ ...f, personName: e.target.value }))} /></div>
            <div className="filter-field"><label>Phone</label><input value={manualForm.phone} onChange={e => setManualForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="filter-field"><label>Remark</label><input value={manualForm.remark} onChange={e => setManualForm(f => ({ ...f, remark: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowManualAdd(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleManualAdd} disabled={busy}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Milestone Modal */}
      {editMilTarget && (
        <div className="modal-overlay" onClick={() => setEditMilTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Payment Record</h3>
            <div className="filter-field"><label>Project / Reference</label><input value={editMilForm.projectOrReference} onChange={e => setEditMilForm(f => ({ ...f, projectOrReference: e.target.value }))} /></div>
            <div className="filter-field"><label>Amount</label><input type="number" value={editMilForm.amount} onChange={e => setEditMilForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="filter-field"><label>Person</label><input value={editMilForm.personName} onChange={e => setEditMilForm(f => ({ ...f, personName: e.target.value }))} /></div>
            <div className="filter-field"><label>Phone</label><input value={editMilForm.phone} onChange={e => setEditMilForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="filter-field"><label>Remark</label><input value={editMilForm.remark} onChange={e => setEditMilForm(f => ({ ...f, remark: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setEditMilTarget(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleEditMilestone} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
