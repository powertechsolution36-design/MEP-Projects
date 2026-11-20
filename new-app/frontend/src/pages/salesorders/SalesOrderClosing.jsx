import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { money, fmtDate } from '../../utils/format';

/**
 * Closing Sales Orders — finance's list (owner decision, 20 Nov 2026:
 * "when project is completed and all payment is completed finance team can
 * close Sales order", and the actual accessories expense is theirs to fill
 * in once the real bills are in).
 *
 * The server decides what is ready: the project finished AND nothing left
 * pending on the money. This screen only shows those two facts, takes the
 * actual expense and closes the order — and keeps the closed ones below,
 * where the expense can still be corrected and an order closed too soon can
 * be put back.
 */
export default function SalesOrderClosing() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [actual, setActual] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/api/sales-orders/closing');
      const list = data.salesOrders || [];
      setRows(list);
      const seeded = {};
      list.forEach((so) => { seeded[so.id] = so.lowSideActualExpense ? String(so.lowSideActualExpense) : ''; });
      setActual(seeded);
    } catch (err) {
      setError(err.message || 'Could not load the closing list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function close(so) {
    const typed = actual[so.id];
    const ok = window.confirm(
      `Close SO-${so.orderNumber} — ${so.projectName}?\n\n`
      + (typed ? `Accessories actual expense: ₹${Number(typed).toLocaleString('en-IN')}\n\n` : 'No actual expense typed yet.\n\n')
      + 'The job is finished and the money is in. You can reopen it if this was too soon.'
    );
    if (!ok) return;
    setBusyId(so.id);
    try {
      await api.post(`/api/sales-orders/${so.id}/close`, { lowSideActualExpense: typed });
      await load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(''); }
  }

  async function saveActual(so) {
    setBusyId(so.id);
    try {
      await api.patch(`/api/sales-orders/${so.id}`, { lowSideActualExpense: Number(actual[so.id]) || 0 });
      await load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(''); }
  }

  async function reopen(so) {
    if (!window.confirm(`Reopen SO-${so.orderNumber}? It goes back to the list above.`)) return;
    setBusyId(so.id);
    try {
      await api.post(`/api/sales-orders/${so.id}/reopen`, {});
      await load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(''); }
  }

  const ready = rows.filter((so) => !so.closedAt);
  const closed = rows.filter((so) => so.closedAt);

  function expenseCell(so) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="number"
          min="0"
          style={{ width: 130 }}
          aria-label={`Accessories actual expense for SO-${so.orderNumber}`}
          value={actual[so.id] ?? ''}
          onChange={(e) => setActual((prev) => ({ ...prev, [so.id]: e.target.value }))}
        />
        {so.closedAt && (
          <button className="btn sec sm" disabled={busyId === so.id} onClick={() => saveActual(so)}>Save</button>
        )}
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>✅ Closing Sales Orders</h2>
        <button className="btn sec sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && (
        <>
          <div className="panel flush">
            <div className="panel-head">
              <h3>Ready to close</h3>
              <div className="panel-head-meta">
                <span className="status-badge status-open">{ready.length} order(s)</span>
              </div>
            </div>
            {ready.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">⏳</div>
                <div className="empty-state-title">Nothing ready yet.</div>
                <p className="muted">An order appears here once its project is Completed and no payment against it is still pending.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table stacks-on-phone">
                  <thead>
                    <tr>
                      <th>SO</th>
                      <th>Project</th>
                      <th>Division</th>
                      <th>Accessories cost</th>
                      <th>Target exp.</th>
                      <th>Actual exp.</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ready.map((so) => (
                      <tr key={so.id}>
                        <td data-label="SO">
                          <button className="btn sec sm" onClick={() => navigate(`/sales-orders/${so.id}`)}>SO-{so.orderNumber}</button>
                        </td>
                        <td data-label="Project"><strong>{so.projectName}</strong></td>
                        <td data-label="Division">{so.division}</td>
                        <td data-label="Accessories cost">{money(so.lowSideCost)}</td>
                        <td data-label="Target exp.">{money(so.lowSideTargetExpense)}</td>
                        <td data-label="Actual exp.">{expenseCell(so)}</td>
                        <td data-label="Actions">
                          <button className="btn pri sm" disabled={busyId === so.id} onClick={() => close(so)}>Close order</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {closed.length > 0 && (
            <div className="panel flush" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h3>Closed</h3>
                <div className="panel-head-meta">
                  <span className="status-badge status-received">{closed.length} order(s)</span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table stacks-on-phone">
                  <thead>
                    <tr>
                      <th>SO</th>
                      <th>Project</th>
                      <th>Closed on</th>
                      <th>Accessories cost</th>
                      <th>Target exp.</th>
                      <th>Actual exp.</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closed.map((so) => (
                      <tr key={so.id}>
                        <td data-label="SO">
                          <button className="btn sec sm" onClick={() => navigate(`/sales-orders/${so.id}`)}>SO-{so.orderNumber}</button>
                        </td>
                        <td data-label="Project"><strong>{so.projectName}</strong></td>
                        <td data-label="Closed on">{fmtDate(so.closedAt)}</td>
                        <td data-label="Accessories cost">{money(so.lowSideCost)}</td>
                        <td data-label="Target exp.">{money(so.lowSideTargetExpense)}</td>
                        <td data-label="Actual exp.">{expenseCell(so)}</td>
                        <td data-label="Actions">
                          <button className="btn sec sm" disabled={busyId === so.id} onClick={() => reopen(so)}>Reopen</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
