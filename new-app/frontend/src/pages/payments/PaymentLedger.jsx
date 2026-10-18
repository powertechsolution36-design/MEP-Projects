import { useState, useEffect, useCallback } from 'react';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { money, fmtDate } from '../../utils/format';
import { todayKey } from '../../utils/platform';

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

  /**
   * PWA FACT (`hit()`, index.html:1819-1824, over the field list at
   * index.html:3707): every whitespace-separated word of the query must
   * appear somewhere in the row — project, person, phone, remark,
   * discussion, SO number, amount and status.
   */
  function matches(p) {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const blob = [p.projectOrReference, p.personName, p.phone, p.remark, p.discussionNotes, p.orderNumber, p.amount, p.status]
      .filter((v) => v !== undefined && v !== null && v !== '')
      .join(' ')
      .toLowerCase();
    return words.every((w) => blob.includes(w));
  }

  const filtered = payments.filter(matches);
  // PWA FACT (index.html:3721): milestones a PM has raised sort to the top.
  const pending = filtered
    .filter(p => p.status === 'Pending')
    .slice()
    .sort((a, b) => (b.raisedToFinance ? 1 : 0) - (a.raisedToFinance ? 1 : 0));
  // PWA FACT (index.html:3886): settled milestones show newest first.
  const settled = filtered.filter(p => p.status === 'Received').slice().reverse();
  const raised = pending.filter(p => p.raisedToFinance);

  /* PWA FACT (index.html:3859-3863): the five KPI cards are computed over
     ALL of the company's payments — the search box narrows the tables, not
     the cards, so the totals stay a stable statement of where finance
     stands. "Raised by PM" counts only PENDING raised milestones. */
  const totalBilled = payments.reduce((a, p) => a + (p.amount || 0), 0);
  const totalCollected = payments.reduce((a, p) => a + received(p), 0);
  const outstanding = totalBilled - totalCollected;
  const partPaid = payments.filter(p => p.status === 'Pending' && received(p) > 0).length;
  const raisedCount = payments.filter(p => p.status === 'Pending' && p.raisedToFinance).length;

  /* PWA FACT (index.html:3708-3711): the pending panel's own three badges
     DO follow the search, so they describe the rows on screen. */
  const pendBilled = pending.reduce((a, p) => a + (p.amount || 0), 0);
  const pendReceived = pending.reduce((a, p) => a + received(p), 0);
  const pendBalance = pending.reduce((a, p) => a + balance(p), 0);

  /* PWA FACT (`receipts`, index.html:3871-3872): every part-payment across
     every milestone, newest payment date first. */
  const receipts = [];
  for (const x of filtered) {
    for (const pp of x.partPayments || []) receipts.push({ x, p: pp });
  }
  receipts.sort((a, b) => (fmtDate(a.p.date) < fmtDate(b.p.date) ? 1 : -1));
  const receiptsTotal = receipts.reduce((a, r) => a + (Number(r.p.amount) || 0), 0);
  const today = todayKey();

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
      lastCallDate: fmtDate(p.lastCallDate),
      nextCallDate: fmtDate(p.nextCallDate),
      discussionNotes: p.discussionNotes || '',
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
      // PWA FACT (dlPayments, index.html:3487): the file carries the
      // screen's active search, so it matches what finance is looking at.
      const qs = search ? `?q=${encodeURIComponent(search)}` : '';
      const resp = await fetch(`${API_BASE_URL}/api/payments/export/pending.csv${qs}`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `payments-${todayKey()}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  async function exportReceipts() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/payments/export/receipts.csv`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `payment-receipts-${todayKey()}.csv`; a.click();
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
        <input
          placeholder="Search project, person, phone, SO no, remark..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="search-count">{filtered.length} of {payments.length}</span>
        {search && <button className="btn sec sm" onClick={() => setSearch('')}>✕ Clear</button>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {/* PWA FACT (index.html:3713-3719): the raised-to-finance banner sits
          above the table so a collection request cannot be missed. */}
      {!loading && raised.length > 0 && (
        <div className="panel alert-panel">
          <h3>📤 {raised.length} milestone(s) raised by project managers — collection requested</h3>
          <ul className="log-list">
            {raised.map((p) => {
              const r = p.raisedToFinance || {};
              return (
                <li key={p.id}>
                  <div className="log-text">
                    {r.priority === 'Urgent' && <strong className="fg-bad">URGENT · </strong>}
                    <strong>{p.projectOrReference}</strong> — {money(balance(p))}
                    <span className="muted">
                      {' '}· raised by {r.raisedByName || r.raisedByRole || '-'} on {fmtDate(r.raisedDate) || '-'}
                      {' '}· collect by {fmtDate(r.collectByDate) || '-'}
                    </span>
                  </div>
                  {r.note && <div className="muted">{r.note}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pending Payments — PWA `payPanel()` (index.html:3705-3735) */}
      {!loading && (
        <div className="panel flush">
          <div className="panel-head">
            <h3>💰 Pending Payments</h3>
            <div className="panel-head-meta">
              <span className="status-badge status-open">Billed: {money(pendBilled) || '₹ 0'}</span>
              <span className="status-badge status-received">Part received: {money(pendReceived) || '₹ 0'}</span>
              <span className="status-badge status-lost">Balance: {money(pendBalance) || '₹ 0'}</span>
            </div>
          </div>
          {pending.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <div className="empty-state-title">Nothing pending. Excellent!</div>
            </div>
          ) : (
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
                    <th>Raised by PM</th>
                    <th>Remark / Milestone</th>
                    <th>Last Call</th>
                    <th>Discussion</th>
                    <th>Next Call</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(p => {
                    const rec = received(p);
                    const r = p.raisedToFinance;
                    const nextCall = fmtDate(p.nextCallDate);
                    // PWA FACT (index.html:3723): a next call due today or
                    // earlier is flagged.
                    const callDue = Boolean(nextCall && nextCall <= today);
                    // PWA FACT (index.html:3725): raised rows tint red,
                    // part-paid rows tint green.
                    const rowClass = r ? 'row-bad' : rec > 0 ? 'row-ok' : undefined;
                    return (
                      <tr key={p.id} className={rowClass}>
                        <td>
                          <strong>{p.projectOrReference}</strong>
                          {p.orderNumber && <div className="cell-sub">SO-{p.orderNumber}</div>}
                        </td>
                        <td>{p.personName || '-'}</td>
                        <td>{p.phone || '-'}</td>
                        <td><strong>{money(p.amount)}</strong></td>
                        <td className={rec ? 'fg-ok' : undefined}>
                          {rec ? (
                            <>
                              <strong>{money(rec)}</strong>
                              <div>
                                <button className="link-button" onClick={() => setHistoryTarget(p)}>
                                  ✎ edit {(p.partPayments || []).length} entr{(p.partPayments || []).length === 1 ? 'y' : 'ies'}
                                </button>
                              </div>
                            </>
                          ) : '—'}
                        </td>
                        <td className="due">{money(balance(p))}</td>
                        <td>
                          {r ? (
                            <>
                              <span className={`status-badge ${r.priority === 'Urgent' ? 'status-lost' : 'status-open'}`}>
                                {r.priority === 'Urgent' ? '⚠ ' : ''}Raised {fmtDate(r.raisedDate)}
                              </span>
                              <div className="cell-sub">{r.raisedByName || r.raisedByRole || '-'} · by {fmtDate(r.collectByDate) || '-'}</div>
                            </>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td>{p.remark || '-'}</td>
                        <td>{fmtDate(p.lastCallDate) || '-'}</td>
                        <td>{p.discussionNotes || '-'}</td>
                        <td className={callDue ? 'due' : undefined}>{nextCall || '-'}</td>
                        <td className="nowrap">
                          <div className="btn-row">
                            <button className="btn grn sm" onClick={() => openAddPayment(p)}>+ Add Payment</button>
                            <button className="btn sec sm" onClick={() => openFollowUp(p)}>Follow-up</button>
                            {(p.partPayments || []).length > 0 && (
                              <button className="btn sec sm" onClick={() => setHistoryTarget(p)}>
                                ✎ Edit Received ({(p.partPayments || []).length})
                              </button>
                            )}
                            <button className="btn sec sm" onClick={() => openEditMilestone(p)}>Edit Milestone</button>
                            {!p.salesOrderId && <button className="btn danger sm" onClick={() => handleDeleteRecord(p.id)}>Delete</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* PWA FACT (index.html:3734): billed / received / balance totals. */}
                  <tr className="strong">
                    <td colSpan={3}>TOTAL</td>
                    <td>{money(pendBilled)}</td>
                    <td className="fg-ok">{money(pendReceived)}</td>
                    <td className="fg-bad">{money(pendBalance)}</td>
                    <td colSpan={6}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Payment Receipts Ledger — PWA (index.html:3869-3882) */}
      {!loading && (
        <div className="panel flush">
          <div className="panel-head">
            <h3>🧾 Payment Receipts Ledger</h3>
            <div className="panel-head-meta">
              <span className="status-badge status-received">{receipts.length} receipts · {money(receiptsTotal) || '₹ 0'}</span>
              <button className="btn sec sm" onClick={exportReceipts}>📥 Export</button>
            </div>
          </div>
          {receipts.length === 0 ? (
            <p className="muted">No payments recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Project</th>
                    <th>Person</th>
                    <th>Amount</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th>Invoice</th>
                    <th>Milestone Status</th>
                    <th>Entered By</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={`${r.x.id}-${r.p.id}`}>
                      <td>{fmtDate(r.p.date)}</td>
                      <td>
                        <strong>{r.x.projectOrReference}</strong>
                        {r.x.orderNumber && <div className="cell-sub">SO-{r.x.orderNumber}</div>}
                      </td>
                      <td>{r.x.personName || '-'}</td>
                      <td><strong>{money(r.p.amount)}</strong></td>
                      <td>{r.p.mode || '-'}</td>
                      <td>{r.p.reference || '-'}</td>
                      <td>{r.p.invoiceIssued ? '✔' : '—'}</td>
                      <td>
                        {r.x.status === 'Received'
                          ? <span className="status-badge status-received">Settled</span>
                          : <span className="status-badge status-pending">Part · bal {money(balance(r.x))}</span>}
                      </td>
                      <td>
                        {r.p.recordedByName || '-'}
                        {r.p.editedByName && <div className="cell-sub">edited by {r.p.editedByName} {fmtDate(r.p.editedOn)}</div>}
                      </td>
                      <td><button className="btn sec sm" onClick={() => openEditPayment(r.x, r.p)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Fully Settled Milestones — PWA (index.html:3883-3888) */}
      {!loading && settled.length > 0 && (
        <div className="panel flush">
          <div className="panel-head">
            <h3>✅ Fully Settled Milestones</h3>
            <div className="panel-head-meta"><span className="muted">{settled.length} settled</span></div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Person</th>
                  <th>Amount</th>
                  <th>Parts</th>
                  <th>Settled On</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {settled.map(p => (
                  <tr key={p.id}>
                    <td>
                      {p.projectOrReference}
                      {p.orderNumber && <div className="cell-sub">SO-{p.orderNumber}</div>}
                    </td>
                    <td>{p.personName || '-'}</td>
                    <td>{money(p.amount)}</td>
                    <td>{(p.partPayments || []).length || 1}</td>
                    <td>{fmtDate(p.receivedDate) || '-'}</td>
                    <td className="nowrap">
                      <div className="btn-row">
                        <button className="btn sec sm" onClick={() => openEditMilestone(p)}>Edit</button>
                        {(p.partPayments || []).length > 0 && (
                          <button className="btn sec sm" onClick={() => setHistoryTarget(p)}>History</button>
                        )}
                      </div>
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
                      <th>Entered By</th>
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
                        <td>{pp.invoiceIssued ? '✔' : '—'}</td>
                        <td>
                          {pp.recordedByName || '-'}
                          {pp.editedByName && <div className="cell-sub">edited by {pp.editedByName} {fmtDate(pp.editedOn)}</div>}
                        </td>
                        <td>{pp.remark || '-'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn sec sm" onClick={() => openEditPayment(historyTarget, pp)}>Edit</button>
                            <button className="btn danger sm" onClick={() => handleDeletePartPayment(historyTarget.id, pp.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* PWA FACT (index.html:3779). */}
                    <tr className="strong">
                      <td colSpan={2}>TOTAL RECEIVED</td>
                      <td>{money(received(historyTarget))}</td>
                      <td colSpan={6}>Balance: {money(balance(historyTarget))}</td>
                    </tr>
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
            <div className="filter-field"><label>Remark / Milestone</label><input value={editMilForm.remark} onChange={e => setEditMilForm(f => ({ ...f, remark: e.target.value }))} /></div>
            {/* PWA FACT (index.html:3823-3830): the milestone edit also
                carries the follow-up fields and shows the status read-only. */}
            <div className="filter-grid">
              <div className="filter-field"><label>Last Call</label><input type="date" value={editMilForm.lastCallDate || ''} onChange={e => setEditMilForm(f => ({ ...f, lastCallDate: e.target.value }))} /></div>
              <div className="filter-field"><label>Next Call</label><input type="date" value={editMilForm.nextCallDate || ''} onChange={e => setEditMilForm(f => ({ ...f, nextCallDate: e.target.value }))} /></div>
            </div>
            <div className="filter-field"><label>Discussion</label><input value={editMilForm.discussionNotes || ''} onChange={e => setEditMilForm(f => ({ ...f, discussionNotes: e.target.value }))} /></div>
            <div className="filter-field">
              <label>Status</label>
              <input value={`${editMilTarget.status}${received(editMilTarget) > 0 && editMilTarget.status === 'Pending' ? ' (part paid)' : ''}`} readOnly />
            </div>
            {received(editMilTarget) > 0 && (
              <p className="field-hint">{money(received(editMilTarget))} already received — the amount cannot be set below that.</p>
            )}
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
