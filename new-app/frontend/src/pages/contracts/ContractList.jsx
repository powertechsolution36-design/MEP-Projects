import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import SortSelect, { sortRows, useSort } from '../../components/SortSelect';

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
  // Owner request (14 Nov 2026): admin narrows the list to one division.
  // A division-confined login never sees this — the server has already
  // limited it to that division, so the control would do nothing.
  const [division, setDivision] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (division) params.set('division', division);
      const qs = params.toString();
      const data = await api.get('/api/contracts' + (qs ? '?' + qs : ''));
      setContracts(data.contracts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, division]);

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

  // Owner request (23 Nov 2026): A–Z, Z–A, newest, oldest — on the right.
  const [sort, setSort] = useSort('amc');

  const shown = useMemo(() => {
    const picked = filter === 'All' ? rows
      : filter === 'PM due' ? rows.filter((r) => r.pmDue > 0)
        : rows.filter((r) => r.status === filter);
    /* Owner (23 Nov 2026): "sort according to site name" — the bold line
       on a row. The address breaks a tie, so two records of one firm stay
       together and in order between themselves, and the customer's name
       after that. */
    return sortRows(picked, sort, {
      name: (r) => `${r.c.site || r.c.customer || ''} ${r.c.address || ''} ${r.c.customer || ''}`,
      date: (r) => r.c.createdAt,
    });
  }, [rows, filter, sort]);

  /* PWA FACT: export and creation are admin/service_mgr only (MANAGE_ROLES). */
  const canManage = ['admin', 'service_mgr', 'solar_pm'].includes(user?.role);
  /* A login tied to one division has nothing to filter. */
  const showDivisionFilter = !['hvac_pm', 'solar_pm', 'mep_pm'].includes(user?.role);

  /*
   * Owner request (23 Nov 2026): "add delete to AMC/PM list." Admin alone —
   * the server enforces it too — and it cannot be undone, so the client and
   * the address are named in the question and the service calls are
   * promised back in the answer, because that is what he chose: the calls
   * stay, they simply stop being AMC calls.
   */
  const canDelete = user?.role === 'admin';
  async function handleDelete(c) {
    const naming = [c.site || c.customer || 'this AMC record', c.address].filter(Boolean).join(' \u00b7 ');
    if (!window.confirm(
      `Delete the AMC record for ${naming}?\n\n`
      + 'Its cover, visit schedule and AMC letter go with it, and this cannot be undone.\n'
      + 'Any service calls raised under it are KEPT — they stop being AMC calls.'
    )) return;
    try {
      const res = await api.del(`/api/contracts/${c.id || c._id}`);
      const kept = res && res.serviceCallsKept
        ? ` ${res.serviceCallsKept} service call${res.serviceCallsKept === 1 ? '' : 's'} kept.`
        : '';
      await load();
      setError('');
      window.alert(`Deleted.${kept}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (division) params.set('division', division);
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
          {/* Owner request (23 Nov 2026): the sort, on the right. A–Z here
              is the firm's name; newest is when the record was made. */}
          <SortSelect value={sort} onChange={setSort} />
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

      {showDivisionFilter && (
        <div className="amc-tabs" role="tablist" aria-label="Filter clients by division">
          {['', 'HVAC', 'Solar', 'MEP'].map((d) => (
            <button
              key={d || 'all'}
              type="button"
              role="tab"
              aria-selected={division === d}
              className={`amc-tab${division === d ? ' is-on' : ''}`}
              onClick={() => setDivision(d)}
            >
              {d || 'All divisions'}
            </button>
          ))}
        </div>
      )}

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
                {/* Owner's wording (23 Nov 2026): the firm is the Site,
                    the person is the Customer Name — and the Site leads
                    the row, with the customer in a column beside it. */}
                <th>Site</th>
                <th>Customer Name</th>
                <th>Division</th>
                <th>Cover</th>
                <th>Covered until</th>
                <th>Status</th>
                {canDelete && <th aria-label="Delete" />}
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={canDelete ? 8 : 7} className="muted">
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
                  {/* Owner (23 Nov 2026): "show Site Name in bold text
                      instead of customer name, and add customer column next
                      to Site." The firm leads the row, the address sits
                      under it — that is what tells two records of one firm
                      apart — and the person we deal with is beside it. */}
                  <td>
                    <b>{c.site || c.customer || '—'}</b>
                    {(c.address || (c.extraSites || []).length > 0) && (
                      <div className="cell-sub">
                        {c.address || ''}
                        {/* One AMC may cover several addresses (23 Nov 2026). */}
                        {(c.extraSites || []).length > 0
                          && `${c.address ? ' ' : ''}+ ${c.extraSites.length} more address${c.extraSites.length === 1 ? '' : 'es'}`}
                      </div>
                    )}
                  </td>
                  <td>{c.customer || '—'}</td>
                  <td>{c.division || '—'}</td>
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
                  {canDelete && (
                    <td className="nowrap">
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={(e) => { e.stopPropagation(); handleDelete(c); }}
                      >
                        🗑 Delete
                      </button>
                    </td>
                  )}
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
