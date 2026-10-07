import { useState, useEffect, useCallback } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * My Material — PWA `vMyMaterial()` exact reproduction.
 *
 * Self-service view of material issued TO the current user.
 * Any authenticated user can see their own issues.
 * PWA FACT: staff can request return on their own issues (owner only).
 * PWA FACT: balance = quantityIssued - quantityReturned - quantityUsed.
 * PWA FACT: any issued material's balance is returnable regardless of
 *   item's returnable flag — that flag only affects dashboard panel filter.
 * PWA FACT: return request is a flag on the issue; acceptance/rejection
 *   is done by inventory/admin on the Returns page.
 */

function issBal(issue) {
  return Math.max(0, (Number(issue.quantityIssued) || 0) - (Number(issue.quantityReturned) || 0) - (Number(issue.quantityUsed) || 0));
}

function issStatus(issue) {
  if (issBal(issue) <= 0) {
    if ((Number(issue.quantityReturned) || 0) > 0) {
      return (Number(issue.quantityUsed) || 0) > 0 ? 'Returned / Used' : 'Returned';
    }
    return 'Consumed';
  }
  if ((Number(issue.quantityReturned) || 0) > 0) return 'Partially Returned';
  if (issue.returnRequested) return 'Return Requested';
  return 'Issued';
}

function statusClass(s) {
  if (s === 'Issued') return 'status-open';
  if (s === 'Return Requested') return 'status-pending';
  if (s === 'Partially Returned') return 'status-won';
  if (s.startsWith('Returned') || s === 'Consumed') return 'status-received';
  return '';
}

export default function MyMaterial() {
  const { user } = useAuth();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Return request modal */
  const [showReturn, setShowReturn] = useState(null);
  const [returnQty, setReturnQty] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/inventory/my-material');
      setIssues(data.issues || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleReturnRequest(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const issueId = showReturn.id || showReturn._id;
      await api.post(`/api/inventory/issues/${issueId}/return-request`, {
        quantity: Number(returnQty) || 0,
      });
      setShowReturn(null);
      setReturnQty('');
      alert('Return request submitted.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/my-material.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-material-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>My Material</h2>
        <div className="enq-actions">
          <button className="btn sec" onClick={handleExport}>CSV Export</button>
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && issues.length === 0 && (
        <div className="panel">
          <p className="muted">No material issued to you.</p>
        </div>
      )}

      {!loading && issues.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Issued</th>
                <th>Returned</th>
                <th>Used</th>
                <th>Balance</th>
                <th>Date</th>
                <th>Site</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map(iss => {
                const bal = issBal(iss);
                const status = issStatus(iss);
                return (
                  <tr key={iss.id || iss._id}>
                    <td>{iss.itemName || iss.itemId}</td>
                    <td>{iss.quantityIssued}</td>
                    <td>{iss.quantityReturned || 0}</td>
                    <td>{iss.quantityUsed || 0}</td>
                    <td><strong>{bal}</strong></td>
                    <td>{fmtDate(iss.issuedAt || iss.createdAt)}</td>
                    <td>{iss.site || '—'}</td>
                    <td><span className={`status-badge ${statusClass(status)}`}>{status}</span></td>
                    <td>
                      {bal > 0 && !iss.returnRequested && (
                        <button className="btn sec sm" onClick={() => { setShowReturn(iss); setReturnQty(String(bal)); }}>
                          Request Return
                        </button>
                      )}
                      {iss.returnRequested && bal > 0 && (
                        <span className="muted" style={{ fontSize: '0.85em' }}>Awaiting approval</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Return Request Modal */}
      {showReturn && (
        <div className="modal-overlay" onClick={() => setShowReturn(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Request Return</h3>
            <p style={{ marginBottom: 12 }}>
              Item: <strong>{showReturn.itemName || showReturn.itemId}</strong><br />
              Balance: <strong>{issBal(showReturn)}</strong>
            </p>
            <form onSubmit={handleReturnRequest}>
              <div className="form-grid">
                <div className="filter-field"><label>Quantity to return *</label>
                  <input type="number" value={returnQty} onChange={e => setReturnQty(e.target.value)}
                    required min="1" max={issBal(showReturn)} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowReturn(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
