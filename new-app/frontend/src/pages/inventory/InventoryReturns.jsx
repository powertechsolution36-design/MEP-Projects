import { useState, useEffect, useCallback } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import { ReturnModal, MarkUsedModal, issueBalance, issueStatusClass } from './IssueActions';

/**
 * Material Returns — PWA return workflow exact reproduction.
 *
 * Shows pending return requests and allows accept/reject.
 * PWA MENUS: admin + inventory have returns access.
 * PWA FACT: admin/inventory only for accept/reject.
 * PWA FACT: any issued material's balance is returnable regardless of
 *   item's returnable flag — that flag only affects dashboard panel filter.
 * PWA FACT: accepting return with damaged flag writes Damage transaction
 *   alongside Return transaction; stock NOT credited for damaged portion.
 * PWA FACT: mark-remaining-used option on accept.
 */

const MANAGE_ROLES = ['inventory', 'admin'];

function daysSince(d) {
  if (!d) return 0;
  const a = Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.max(0, Math.round((b - a) / 86400000));
}

export default function InventoryReturns() {
  const { user } = useAuth();
  const [issues, setIssues] = useState([]);
  const [history, setHistory] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [returnTarget, setReturnTarget] = useState(null);
  const [usedTarget, setUsedTarget] = useState(null);
  const [pickReturn, setPickReturn] = useState(false);
  const [pickId, setPickId] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issData, locData, txData] = await Promise.all([
        api.get('/api/inventory/issues'),
        api.get('/api/inventory/locations'),
        api.get('/api/inventory/transactions'),
      ]);
      setIssues(issData.issues || []);
      setLocations(locData.locations || []);
      setHistory((txData.transactions || []).filter(t => t.type === 'Return'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (canManage) load(); }, [load, canManage]);

  async function handleReject(issueId) {
    if (!window.confirm('Reject this return request?')) return;
    try {
      await api.post(`/api/inventory/issues/${issueId}/reject-return`, {});
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/returns.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'material-return-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel"><p className="muted">You do not have permission to manage material returns.</p></div>
      </div>
    );
  }

  const open = issues.filter(x => issueBalance(x) > 0);
  const requests = open.filter(x => x.returnRequested);
  const recorded = issues.filter(x => (Number(x.quantityReturned) || 0) > 0);
  const q = search.trim().toLowerCase();
  const rows = q
    ? open.filter(x => [x.staffName, x.site, x.remark, x.issuedByName, x.itemName, x.itemCode].join(' ').toLowerCase().includes(q))
    : open;

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Material Returns</h2>
        <div className="enq-actions">
          <button className="btn pri" onClick={() => { setPickId(open[0]?.id || ''); setPickReturn(true); }} disabled={!open.length}>+ Record Return</button>
          <button className="btn sec" onClick={handleExport}>⬇ Report</button>
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <>
          <div className="kpi-bar">
            <div className="kpi-card"><div className="kpi-value">{open.length}</div><div className="kpi-label">Pending With Staff</div></div>
            <div className="kpi-card"><div className="kpi-value">{requests.length}</div><div className="kpi-label">Return Requests</div></div>
            <div className="kpi-card"><div className="kpi-value">{open.filter(x => x.returnable).length}</div><div className="kpi-label">Returnable Tools Out</div></div>
            <div className="kpi-card"><div className="kpi-value">{recorded.length}</div><div className="kpi-label">Returns Recorded</div></div>
          </div>

          {requests.length > 0 && (
            <div className="panel" style={{ borderColor: '#f3c1c1', background: '#fdf6f6' }}>
              <h3>📥 Return Requests from Staff</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Item</th><th>Qty Offered</th><th>Staff</th><th>Site</th><th>Requested On</th><th>Note</th><th></th></tr></thead>
                  <tbody>
                    {requests.map(x => (
                      <tr key={x.id}>
                        <td><b>{x.itemName}</b></td>
                        <td>{x.requestedQuantity || issueBalance(x)} {x.unit}</td>
                        <td>{x.staffName}</td>
                        <td>{x.site}</td>
                        <td>{fmtDate(x.requestedDate)}</td>
                        <td>{x.requestNote || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn sm pri" onClick={() => setReturnTarget(x)}>Receive</button>{' '}
                          <button className="btn sm sec" onClick={() => handleReject(x.id)}>Reject</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="panel">
            <h3>Material Pending Return</h3>
            <p className="muted">Any issued material can be returned — tools, or unused leftover consumables. Record the full quantity or a part of it; the balance stays with the staff member until it is returned or marked used.</p>
            <div className="search-bar">
              <input placeholder="Search item, staff, site..." value={search} onChange={e => setSearch(e.target.value)} />
              <span className="muted">{rows.length} of {open.length}</span>
            </div>
            {rows.length === 0 ? (
              <p className="muted">Nothing pending — all issued material is returned or used.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Issued On</th><th>Item</th><th>Type</th><th>Issued Qty</th><th>Returned</th><th>Used</th><th>Balance</th><th>Staff</th><th>Site</th><th>Days Out</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {rows.map(x => {
                      const days = daysSince(x.date);
                      return (
                        <tr key={x.id} style={x.returnRequested ? { background: '#f6f2fd' } : days > 30 ? { background: '#fdf6f6' } : undefined}>
                          <td>{fmtDate(x.date)}</td>
                          <td><b>{x.itemName}</b><div className="muted">{x.itemCode}</div></td>
                          <td>{x.returnable ? 'Returnable' : 'Consumable'}</td>
                          <td>{x.quantityIssued} {x.unit}</td>
                          <td>{Number(x.quantityReturned) || '—'}</td>
                          <td>{Number(x.quantityUsed) || '—'}</td>
                          <td><b>{issueBalance(x)}</b></td>
                          <td><b>{x.staffName}</b></td>
                          <td>{x.site}</td>
                          <td>{days}</td>
                          <td><span className={`status-badge ${issueStatusClass(x.status)}`}>{x.status}</span></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn sm pri" onClick={() => setReturnTarget(x)}>Return</button>{' '}
                            <button className="btn sm sec" onClick={() => setUsedTarget(x)}>Mark Used</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3>🧾 Return History</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Returned By</th><th>Into Location</th><th>Condition / Remark</th><th>Received By</th></tr></thead>
                <tbody>
                  {history.length === 0 && <tr><td colSpan={7} className="muted">No returns recorded yet.</td></tr>}
                  {history.map(t => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.date)}</td>
                      <td><b>{t.itemName}</b></td>
                      <td>{t.quantity} {t.unit}</td>
                      <td>{t.referenceText || '-'}</td>
                      <td>{t.toLocationName || '-'}</td>
                      <td>{t.remark || '-'}</td>
                      <td>{t.recordedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {pickReturn && (
        <div className="modal-overlay" onClick={() => setPickReturn(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Record Return</h3>
            <div className="filter-field"><label>Issued material</label>
              <select value={pickId} onChange={e => setPickId(e.target.value)}>
                {open.map(x => (
                  <option key={x.id} value={x.id}>{x.itemName} — {x.staffName} — {x.site} ({issueBalance(x)} {x.unit} out)</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn sec" onClick={() => setPickReturn(false)}>Cancel</button>
              <button type="button" className="btn pri" onClick={() => { setPickReturn(false); setReturnTarget(open.find(x => x.id === pickId) || null); }}>Continue</button>
            </div>
          </div>
        </div>
      )}
      {returnTarget && (
        <ReturnModal issue={returnTarget} locations={locations}
          onClose={() => setReturnTarget(null)}
          onDone={() => { setReturnTarget(null); load(); }} />
      )}
      {usedTarget && (
        <MarkUsedModal issue={usedTarget}
          onClose={() => setUsedTarget(null)}
          onDone={() => { setUsedTarget(null); load(); }} />
      )}
    </div>
  );
}
