import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';

/**
 * AMC / Warranty clients.
 *
 * Owner decision (29 Oct 2026): this screen is the CLIENT LIST and nothing
 * else. It used to stack three tables — a "PM Due this month" panel, the
 * contract table with nine columns, and a "Renewal Opportunities" panel —
 * which is unreadable once there are sixty clients rather than one.
 *
 * Now: one row per AMC / Warranty client, showing who they are and whether
 * their cover is Active, Expiring Soon or Expired. Everything about one
 * client — their PM due dates, scheduled visits, service history, AMC letter,
 * payment and renewal — is on that client's own page, one click away.
 *
 * Nothing was lost in the tidy-up:
 *   - the PM-due visits and the "Schedule PM visit" action already live on
 *     the client's page (ContractDetail: "Scheduled AMC visits");
 *   - "Renewal Opportunities" was only ever the non-Active contracts, which
 *     the Expiring Soon / Expired filters show directly.
 *
 * PWA FACT (kept): no division filter — any authenticated company member may
 * see the list; the menu is gated to admin/service_mgr. Export and creation
 * stay admin/service_mgr only. Status is computed for display exactly as the
 * PWA did (45-day "Expiring Soon" window, a blank end date reads Expired).
 */

function statusClass(status) {
  if (status === 'Active') return 'status-open';
  if (status === 'Expiring Soon') return 'status-pending';
  if (status === 'Expired') return 'status-lost';
  return '';
}

/* PWA FACT: contractStatus computed client-side for display. */
function computeStatus(c) {
  if (!c.endDate) return 'Expired';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(c.endDate);
  end.setHours(0, 0, 0, 0);
  if (end < today) return 'Expired';
  const soonMs = 45 * 24 * 60 * 60 * 1000;
  if (today >= new Date(end.getTime() - soonMs)) return 'Expiring Soon';
  return 'Active';
}

/* PWA FACT: pmDue — uncompleted visits whose month is this month or earlier. */
function computePmDue(c) {
  const now = new Date();
  const tm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  let count = 0;
  (c.scheduledVisits || []).forEach((v) => {
    if (!v.completedDate && v.month <= tm) count += 1;
  });
  return count;
}

const FILTERS = ['All', 'Active', 'Expiring Soon', 'Expired', 'PM due'];

export default function ContractList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const qs = params.toString();
      const data = await api.get('/api/contracts' + (qs ? '?' + qs : ''));
      setContracts(data.contracts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  /* Status and PM-due are display-only, so they are derived once here and
     drive both the counts on the filters and the rows. */
  const rows = useMemo(
    () => contracts.map((c) => ({ c, status: computeStatus(c), pmDue: computePmDue(c) })),
    [contracts]
  );

  const counts = useMemo(() => ({
    All: rows.length,
    Active: rows.filter((r) => r.status === 'Active').length,
    'Expiring Soon': rows.filter((r) => r.status === 'Expiring Soon').length,
    Expired: rows.filter((r) => r.status === 'Expired').length,
    'PM due': rows.filter((r) => r.pmDue > 0).length,
  }), [rows]);

  const shown = useMemo(() => {
    if (filter === 'All') return rows;
    if (filter === 'PM due') return rows.filter((r) => r.pmDue > 0);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  /* PWA FACT: export and creation are admin/service_mgr only (MANAGE_ROLES). */
  const canManage = ['admin', 'service_mgr'].includes(user?.role);

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const resp = await fetch(
        API_BASE_URL + '/api/contracts/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contracts.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>AMC / Warranty Clients</h2>
        <div className="enq-actions">
          {canManage && (
            <button className="btn pri" onClick={() => navigate('/contracts/new')}>+ New AMC</button>
          )}
          {canManage && (
            <button className="btn sec" onClick={handleExport}>CSV Export</button>
          )}
        </div>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by client, site, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Which cover am I looking at? One tap, no second table. */}
      <div className="amc-tabs" role="tablist" aria-label="Filter clients by cover">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`amc-tab${filter === f ? ' is-on' : ''}${f === 'PM due' && counts[f] > 0 ? ' is-due' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}<span className="amc-tab-n">{counts[f]}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Cover</th>
                <th>Covered until</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {contracts.length === 0
                      ? 'No AMC or Warranty clients yet.'
                      : `No clients under “${filter}”.`}
                  </td>
                </tr>
              )}
              {shown.map(({ c, status, pmDue }) => (
                <tr
                  key={c.id || c._id}
                  className="clickable-row"
                  onClick={() => navigate(`/contracts/${c.id || c._id}`)}
                >
                  <td>
                    <b>{c.customer || c.site || '—'}</b>
                    {c.site && c.customer && <div className="cell-sub">{c.site}</div>}
                  </td>
                  <td>
                    {c.category}
                    {c.amcType && <div className="cell-sub">{c.amcType}</div>}
                  </td>
                  <td>
                    {c.endDate ? fmtDate(c.endDate) : '—'}
                    {pmDue > 0 && (
                      <div className="cell-sub amc-due">{pmDue} PM due</div>
                    )}
                  </td>
                  <td><span className={`status-badge ${statusClass(status)}`}>{status}</span></td>
                  <td className="amc-chevron" aria-hidden="true">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
