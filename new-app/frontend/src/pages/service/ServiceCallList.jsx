import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';

/**
 * Service Call List — PWA `viewServiceCalls()` exact reproduction.
 *
 * PWA MENUS: admin + service_mgr have the "Service Calls" menu item.
 * PWA FACT: list is admin/service_mgr only (MANAGE_ROLES).
 * PWA FACT: newest-first display (server returns `.slice().reverse()`).
 * PWA FACT: 9-field case-insensitive search (complaintNumber, customer,
 *   phone, site, engineerName, status, type, serviceType, complaintDescription).
 * Table columns: #, Type, Customer, Phone, Site, Date, Status, Engineer, Amount.
 * Export: CSV download (admin/service_mgr only).
 *
 * Owner request (5 Nov 2026): "service calls should be separated according
 * to status". One long newest-first list hid what the service manager is
 * actually looking for — the calls nobody has been sent to yet. The rows are
 * the same rows, in the same order; they are now banded by status in
 * lifecycle order, each band headed with its own count, and a row of chips
 * narrows the table to one status when that is all they want to see.
 */

// Lifecycle order, which is also the order of urgency: a call nobody has
// been assigned to is the one that needs attention first.
const STATUS_ORDER = ['Registered', 'Assigned', 'Scheduled', 'Completed'];
const STATUS_NOTE = {
  Registered: 'Taken, nobody sent yet',
  Assigned: 'An engineer has it',
  Scheduled: 'A visit is set',
  Completed: 'Work finished',
};

const MANAGE_ROLES = ['admin', 'service_mgr'];

function statusClass(status) {
  if (status === 'Registered') return 'status-pending';
  if (status === 'Assigned') return 'status-open';
  if (status === 'Scheduled') return 'status-won';
  if (status === 'Completed') return 'status-received';
  return '';
}

export default function ServiceCallList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  // '' is every status, banded. A chip narrows it to one band.
  const [statusFilter, setStatusFilter] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);

  /* Engineer name map for display (backend list returns engineerId only) */
  const [engineerMap, setEngineerMap] = useState({});
  // Owner decision (22 Oct 2026): completed calls whose report the service
  // manager still has to send from the company WhatsApp.
  const [toSend, setToSend] = useState([]);
  useEffect(() => {
    if (!MANAGE_ROLES.includes(user?.role)) return;
    api.get('/api/service-calls/reports-to-send')
      .then((d) => setToSend(d.serviceCalls || []))
      .catch(() => {});
  }, [user?.role]);
  useEffect(() => {
    api.get('/api/service-calls/engineer-candidates')
      .then(data => {
        const map = {};
        (data.candidates || []).forEach(c => { map[c.id] = c.name; });
        setEngineerMap(map);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const qs = params.toString();
      const data = await api.get('/api/service-calls' + (qs ? '?' + qs : ''));
      setCalls(data.serviceCalls || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const resp = await fetch(
        API_BASE_URL + '/api/service-calls/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'service-calls.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  /* The same rows, banded by status. A status with no calls still gets a
     chip (showing 0) so the service manager can see at a glance that there
     is nothing waiting, but it is not given an empty band in the table.
     Anything with an unexpected status is banded under its own name rather
     than dropped — a row must never vanish from the register. */
  const byStatus = {};
  STATUS_ORDER.forEach((st) => { byStatus[st] = []; });
  calls.forEach((c) => {
    const st = c.status || 'Registered';
    if (!byStatus[st]) byStatus[st] = [];
    byStatus[st].push(c);
  });
  const bandOrder = [...STATUS_ORDER, ...Object.keys(byStatus).filter((st) => !STATUS_ORDER.includes(st))];
  const shownBands = bandOrder
    .filter((st) => (statusFilter ? st === statusFilter : true))
    .map((st) => [st, byStatus[st]])
    .filter(([, rows]) => rows.length > 0);

  /* Role gate: only MANAGE_ROLES can see the list (PWA exact) */
  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to view service calls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Service Calls</h2>
        <div className="enq-actions">
          <button className="btn pri" onClick={() => navigate('/service-calls/new')}>
            + Register Complaint
          </button>
          <button className="btn sec" onClick={handleExport}>
            CSV Export
          </button>
        </div>
      </div>

      {toSend.length > 0 && (
        <div className="panel" style={{ borderLeft: '4px solid #d92b2b' }}>
          <h3 style={{ marginTop: 0 }}>Reports to send ({toSend.length})</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Completed by the engineer — open each one and send the report to the client on WhatsApp.
          </p>
          <ul className="to-send-list">
            {toSend.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>PSC-{c.complaintNumber}</strong> · {c.customer}{c.site ? ` · ${c.site}` : ''}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {c.engineer ? ` · by ${c.engineer}` : ''}{c.completedAt ? ` · ${fmtDate(c.completedAt)}` : ''}
                  </span>
                </span>
                <button className="btn pri sm" onClick={() => navigate(`/service-calls/${c.id}`)}>Send report</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search service calls..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && !error && (
        <>
          <div className="sc-chips" role="group" aria-label="Filter by status">
            <button
              type="button"
              className={`sc-chip${statusFilter === '' ? ' is-on' : ''}`}
              onClick={() => setStatusFilter('')}
            >
              All <span className="sc-chip-n">{calls.length}</span>
            </button>
            {STATUS_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={`sc-chip sc-chip-${st.toLowerCase()}${statusFilter === st ? ' is-on' : ''}`}
                onClick={() => setStatusFilter(statusFilter === st ? '' : st)}
              >
                {st} <span className="sc-chip-n">{byStatus[st].length}</span>
              </button>
            ))}
          </div>

          <div className="table-wrap">
            <table className="data-table sc-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Site</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Engineer</th>
                  <th>Amount</th>
                </tr>
              </thead>
              {shownBands.length === 0 && (
                <tbody>
                  <tr><td colSpan={9} className="muted">No service calls found.</td></tr>
                </tbody>
              )}
              {shownBands.map(([st, rows]) => (
                <tbody key={st} className={`sc-band sc-band-${st.toLowerCase()}`}>
                  <tr className="sc-band-head">
                    <th colSpan={9} scope="colgroup">
                      <span className={`status-badge ${statusClass(st)}`}>{st}</span>
                      <span className="sc-band-n">{rows.length}</span>
                      <span className="sc-band-note">{STATUS_NOTE[st]}</span>
                    </th>
                  </tr>
                  {rows.map(c => (
                    <tr
                      key={c.id || c._id}
                      className="clickable-row"
                      onClick={() => navigate(`/service-calls/${c.id || c._id}`)}
                    >
                      <td>{c.complaintNumber || '—'}</td>
                      <td>{c.type || '—'}</td>
                      <td>{c.customer || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.site || '—'}</td>
                      <td>{fmtDate(c.appointmentDate || c.registeredDate)}</td>
                      <td><span className={`status-badge ${statusClass(c.status)}`}>{c.status}</span></td>
                      <td>{engineerMap[c.engineerId] || '—'}</td>
                      <td>{c.report?.amount ? money(c.report.amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

    </div>
  );
}
