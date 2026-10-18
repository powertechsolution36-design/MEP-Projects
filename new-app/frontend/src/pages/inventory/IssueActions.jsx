import { useState } from 'react';
import { api } from '../../api/client';

/**
 * Shared store-side actions on an issued-material record, used by the
 * Issue Material and Material Returns pages.
 *
 * PWA FACT (mInvReturn/saveInvReturn, index.html:3080-3122): receive a full
 * or part quantity back into a chosen location; "Damaged" writes it off
 * instead of adding stock; optionally mark the remaining balance as used.
 * PWA FACT (mMarkUsed, index.html:3310-3330): consume part/all of the
 * balance on site.
 */

export function issueBalance(issue) {
  if (issue.balance != null) return Number(issue.balance) || 0;
  return Math.max(0, (Number(issue.quantityIssued) || 0) - (Number(issue.quantityReturned) || 0) - (Number(issue.quantityUsed) || 0));
}

export function issueStatusClass(s) {
  if (s === 'Issued') return 'status-open';
  if (s === 'Return Requested') return 'status-pending';
  if (s === 'Partially Returned') return 'status-won';
  if (s && (s.startsWith('Returned') || s === 'Consumed')) return 'status-received';
  return '';
}

export function ReturnModal({ issue, locations, onClose, onDone }) {
  const balance = issueBalance(issue);
  const [form, setForm] = useState({
    quantity: String(issue.requestedQuantity || balance),
    toLocationId: issue.fromLocationId || '',
    damaged: false,
    markRemainingUsed: false,
    remark: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/inventory/issues/${issue.id}/accept-return`, {
        quantity: Number(form.quantity) || 0,
        toLocationId: form.toLocationId || undefined,
        damaged: form.damaged,
        markRemainingUsed: form.markRemainingUsed,
        remark: form.remark || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Receive Return — {issue.itemName}</h3>
        <p className="muted">
          Issued {issue.quantityIssued} {issue.unit} to {issue.staffName || 'staff'} for {issue.site}. Balance out: <b>{balance}</b>
        </p>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="filter-field"><label>Quantity returned *</label>
              <input type="number" min="1" max={balance} value={form.quantity}
                onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} required />
            </div>
            <div className="filter-field"><label>Return into location</label>
              <select value={form.toLocationId} onChange={e => setForm(p => ({ ...p, toLocationId: e.target.value }))}>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="filter-field"><label>Condition</label>
              <select value={form.damaged ? 'Damaged' : 'Good'} onChange={e => setForm(p => ({ ...p, damaged: e.target.value === 'Damaged' }))}>
                <option value="Good">Good — add back to stock</option>
                <option value="Damaged">Damaged — write off (not added to stock)</option>
              </select>
            </div>
            <div className="filter-field"><label>Remark</label>
              <input value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
            </div>
            <label className="filter-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.markRemainingUsed}
                onChange={e => setForm(p => ({ ...p, markRemainingUsed: e.target.checked }))} />
              Mark any remaining balance as used on site
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving…' : 'Receive'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MarkUsedModal({ issue, onClose, onDone }) {
  const balance = issueBalance(issue);
  const [quantity, setQuantity] = useState(String(balance));
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/inventory/issues/${issue.id}/mark-used`, {
        quantity: Number(quantity) || 0,
        remark: remark || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Mark Used on Site — {issue.itemName}</h3>
        <p className="muted">Balance with {issue.staffName || 'staff'}: <b>{balance} {issue.unit}</b></p>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="filter-field"><label>Quantity used *</label>
              <input type="number" min="1" max={balance} value={quantity} onChange={e => setQuantity(e.target.value)} required />
            </div>
            <div className="filter-field"><label>Remark</label>
              <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="used on site" />
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving…' : 'Mark Used'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
