import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import SortSelect, { sortRows, useSort } from '../../components/SortSelect';

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

const MANAGE_ROLES = ['admin', 'service_mgr', 'solar_pm'];

/* Owner request (17 Nov 2026): a call still Registered 48 hours after it was
   taken has had nobody sent to it, and the register says so. The server
   works out `unattended` and `unattendedHours` (serviceCallService); this
   only has to put them on the screen. */
function waitedText(hours) {
  if (hours === null || hours === undefined) return '';
  if (hours < 48) return '';
  const days = Math.floor(hours / 24);
  return days >= 2 ? `waiting ${days} days` : `waiting ${hours}h`;
}

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
  // Owner request (23 Nov 2026): A–Z, Z–A, newest, oldest.
  const [sort, setSort] = useSort('service-calls');
  /*
   * Owner request (20 Nov 2026): "add quick time and date filter also for
   * Scheduled Service/PM." One tap for today, tomorrow or the next seven
   * days, and a date box for any other day. It narrows the SCHEDULED and
   * PM visits by their appointment date — a call with no date fixed is not
   * what this question is about, so it drops out while a day filter is on.
   */
  const [whenFilter, setWhenFilter] = useState('');
  const [whenDate, setWhenDate] = useState('');
  // Owner request (14 Nov 2026): admin narrows the register to one division.
  // A division-confined login never sees this — the server has already
  // limited it to that division.
  const [division, setDivision] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);
  // Owner request (19 Nov 2026): "Need service call delete option for
  // admin." Nobody else is offered it, and the server refuses them anyway.
  const canDelete = user?.role === 'admin';

  async function deleteCall(c) {
    const no = c.complaintNumber || '';
    const ok = window.confirm(
      `Delete service call ${no} — ${c.customer || 'this customer'}?\n\n`
      + 'It is removed for good; there is no undo. A payment raised from this '
      + 'call is NOT deleted — remove that on the Payments screen if you want it gone.'
    );
    if (!ok) return;
    try {
      await api.del(`/api/service-calls/${c.id || c._id}`);
      await load();
    } catch (err) {
      alert(err.message);
    }
  }
  /* A login tied to one division has nothing to filter. */
  const showDivisionFilter = !['hvac_pm', 'solar_pm', 'mep_pm'].includes(user?.role);

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
      if (division) params.set('division', division);
      const qs = params.toString();
      const data = await api.get('/api/service-calls' + (qs ? '?' + qs : ''));
      setCalls(data.serviceCalls || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, division]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (division) params.set('division', division);
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
  /* Which appointment days the quick filter lets through. */
  const dayKey = (d) => (d ? String(d).slice(0, 10) : '');
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  function matchesWhen(c) {
    if (!whenFilter) return true;
    const appt = dayKey(c.appointmentDate);
    if (!appt) return false;
    if (whenFilter === 'today') return appt === addDays(0);
    if (whenFilter === 'tomorrow') return appt === addDays(1);
    if (whenFilter === 'week') return appt >= addDays(0) && appt <= addDays(7);
    if (whenFilter === 'overdue') return appt < addDays(0);
    if (whenFilter === 'day') return whenDate ? appt === whenDate : true;
    return true;
  }

  const byStatus = {};
  STATUS_ORDER.forEach((st) => { byStatus[st] = []; });
  calls.filter(matchesWhen).forEach((c) => {
    const st = c.status || 'Registered';
    if (!byStatus[st]) byStatus[st] = [];
    byStatus[st].push(c);
  });
  const bandOrder = [...STATUS_ORDER, ...Object.keys(byStatus).filter((st) => !STATUS_ORDER.includes(st))];
  const shownBands = bandOrder
    .filter((st) => (statusFilter ? st === statusFilter : true))
    // The chosen order applies within a band (owner request, 23 Nov 2026):
    // A–Z is the customer, newest is when the call was registered.
    .map((st) => [st, sortRows(byStatus[st], sort, {
      name: (c) => c.customer || c.site,
      date: (c) => c.registeredDate || c.createdAt,
    })])
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
          {/* Owner request (23 Nov 2026): the sort, on the right. It orders
              the calls INSIDE each status band; the bands themselves keep
              their own order, which is what the screen is built around. */}
          <SortSelect value={sort} onChange={setSort} />
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
          {showDivisionFilter && (
            <div className="sc-chips" role="group" aria-label="Filter by division">
              {['', 'HVAC', 'Solar', 'MEP'].map((d) => (
                <button
                  key={d || 'all'}
                  type="button"
                  className={`sc-chip${division === d ? ' is-on' : ''}`}
                  onClick={() => setDivision(d)}
                >
                  {d || 'All divisions'}
                </button>
              ))}
            </div>
          )}

          {/* Owner request (20 Nov 2026): a quick day filter for the
              scheduled visits. */}
          <div className="sc-chips" role="group" aria-label="Filter by appointment day">
            {[['', 'Any day'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['overdue', 'Past due']].map(([key, label]) => (
              <button
                key={key || 'any'}
                type="button"
                className={`sc-chip${whenFilter === key ? ' is-on' : ''}`}
                onClick={() => { setWhenFilter(key); if (key !== 'day') setWhenDate(''); }}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={whenDate}
              aria-label="Appointment on this day"
              onChange={(e) => { setWhenDate(e.target.value); setWhenFilter(e.target.value ? 'day' : ''); }}
            />
          </div>

          <div className="sc-chips" role="group" aria-label="Filter by status">
            <button
              type="button"
              className={`sc-chip${statusFilter === '' ? ' is-on' : ''}`}
              onClick={() => setStatusFilter('')}
            >
              All <span className="sc-chip-n">{calls.filter(matchesWhen).length}</span>
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
                  <th>Division</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Engineer</th>
                  <th>Amount</th>
                  {canDelete && <th><span className="sr-only">Delete</span></th>}
                </tr>
              </thead>
              {shownBands.length === 0 && (
                <tbody>
                  <tr><td colSpan={canDelete ? 11 : 10} className="muted">No service calls found.</td></tr>
                </tbody>
              )}
              {shownBands.map(([st, rows]) => (
                <tbody key={st} className={`sc-band sc-band-${st.toLowerCase()}`}>
                  <tr className="sc-band-head">
                    <th colSpan={canDelete ? 11 : 10} scope="colgroup">
                      <span className={`status-badge ${statusClass(st)}`}>{st}</span>
                      <span className="sc-band-n">{rows.length}</span>
                      <span className="sc-band-note">{STATUS_NOTE[st]}</span>
                      {rows.filter((c) => c.unattended).length > 0 && (
                        <span className="sc-band-overdue">
                          {rows.filter((c) => c.unattended).length} waiting over 48h
                        </span>
                      )}
                    </th>
                  </tr>
                  {rows.map(c => (
                    <tr
                      key={c.id || c._id}
                      className={`clickable-row${c.unattended ? ' sc-overdue' : ''}`}
                      onClick={() => navigate(`/service-calls/${c.id || c._id}`)}
                    >
                      <td>
                        {c.complaintNumber || '—'}
                        {c.unattended && (
                          <span className="sc-waited" title={`Registered ${c.unattendedHours} hours ago and nobody has been sent`}>
                            {waitedText(c.unattendedHours)}
                          </span>
                        )}
                      </td>
                      <td>{c.type || '—'}</td>
                      <td>{c.customer || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.site || '—'}</td>
                      <td>{c.division || '—'}</td>
                      <td>
                        {fmtDate(c.appointmentDate || c.registeredDate)}
                        {c.appointmentDate && c.appointmentTime && (
                          <div className="cell-sub">{c.appointmentTime}</div>
                        )}
                      </td>
                      <td><span className={`status-badge ${statusClass(c.status)}`}>{c.status}</span></td>
                      <td>{engineerMap[c.engineerId] || '—'}</td>
                      <td>{c.report?.amount ? money(c.report.amount) : '—'}</td>
                      {canDelete && (
                        <td>
                          <button
                            type="button"
                            className="btn danger sm"
                            title={`Delete service call ${c.complaintNumber || ''}`}
                            onClick={(e) => { e.stopPropagation(); deleteCall(c); }}
                          >
                            Delete
                          </button>
                        </td>
                      )}
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
