import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';

/**
 * My Service Tasks — the calls THIS login has been sent to, newest first.
 *
 * Owner request (20 Nov 2026): "Add my Service Task and Daily task to
 * Project manager and Solar Manager Account", and his choice of what it
 * holds — "the calls assigned to me". Since the same day a Manager can be
 * sent to a service call like any engineer, so a Manager needs the list an
 * engineer has always had on their dashboard.
 *
 * It reads GET /api/service-calls/mine, which answers with the OPEN calls
 * assigned to whoever is asking, whatever their role — no role gate to add
 * here, and nothing division-specific: a call is on this list because it
 * was given to this person, full stop.
 */
export default function MyServiceTasks() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/api/service-calls/mine');
      setCalls(data.serviceCalls || []);
    } catch (err) {
      setError(err.message || 'Could not load your service tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>🛠️ My Service Tasks</h2>
        <button className="btn sec sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="panel" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && !error && (
        <div className="panel flush">
          {calls.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <div className="empty-state-title">Nothing open for you right now.</div>
              <div className="muted">A call appears here once somebody sends you to it.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table stacks-on-phone">
                <thead>
                  <tr>
                    <th>PSC No</th>
                    <th>Type</th>
                    <th>Customer</th>
                    <th>Site</th>
                    <th>Division</th>
                    <th>Appointment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr
                      key={c.id}
                      className="clickable-row"
                      onClick={() => navigate(`/service-calls/${c.id}`)}
                    >
                      <td data-label="PSC No"><strong>PSC-{c.complaintNumber}</strong></td>
                      <td data-label="Type">{c.type || '—'}</td>
                      <td data-label="Customer">{c.customer || '—'}</td>
                      <td data-label="Site">{c.site || '—'}</td>
                      <td data-label="Division">{c.division || '—'}</td>
                      <td data-label="Appointment">
                        {c.appointmentDate ? fmtDate(c.appointmentDate) : '—'}
                        {c.appointmentTime ? ` · ${c.appointmentTime}` : ''}
                      </td>
                      <td data-label="Status">
                        <span className="status-badge status-open">{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
