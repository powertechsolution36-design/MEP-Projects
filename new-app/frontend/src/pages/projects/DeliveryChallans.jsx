import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import SortSelect, { useSort, sortRows } from '../../components/SortSelect';

/**
 * Delivery Challan register.
 *
 * Owner request (26 Nov 2026): "create a new option in sidebar as
 * Delivery Challan and it will be linked to project."
 *
 * The panel inside a project is unchanged and is still where a challan is
 * written. This is the way in from the other end: the storekeeper has a
 * challan number in hand and wants to know which project it belongs to.
 * Every row links back to its project, where it can be edited, returned
 * against and printed.
 */
/*
 * Who may write a challan: the Manager of the project, an engineer
 * assigned to it, or admin -- the server's own rule
 * (assertIsPmOrAssignedEngineer). The storekeeper can read this register
 * but not start a challan, so the button is not dangled in front of
 * them only to be refused on save.
 */
const CAN_START_ROLES = ['admin', 'hvac_pm', 'solar_pm', 'mep_pm'];

export default function DeliveryChallans() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canStart = CAN_START_ROLES.includes(user?.role);
  const [projects, setProjects] = useState([]);
  const [picking, setPicking] = useState(false);
  const [pickedProject, setPickedProject] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [sort, setSort] = useSort('challans');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/api/projects/delivery-challans/all');
      setRows(r.challans || []);
      if (canStart) {
        // The projects a challan can be written against: the same list
        // the Projects screen shows this reader, minus the ones closed
        // to challans once they are In Service.
        const pr = await api.get('/api/projects').catch(() => ({ projects: [] }));
        setProjects((pr.projects || []).filter((p) => p.status !== 'In Service'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [canStart]);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const shown = sortRows(
    rows.filter((r) => {
      if (onlyOutstanding && !r.outstandingReturn) return false;
      if (!q) return true;
      return [r.challanNumber, r.projectName, r.customer, r.site, r.receivedBy, r.remark]
        .join(' ').toLowerCase().includes(q);
    }),
    sort,
    // "Name" on this register is the project it belongs to; "new" is the
    // challan's own date, not when the record happened to be written.
    { name: (r) => r.projectName, date: (r) => r.date },
  );

  const outstanding = rows.reduce((n, r) => n + (r.outstandingReturn || 0), 0);

  return (
    <div className="enq-page">
      <div className="detail-head">
        <h2>Delivery Challan</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SortSelect value={sort} onChange={setSort} />
          {canStart && (
            <button className="btn pri sm" onClick={() => { setPickedProject(''); setPicking(true); }}>
              + New Challan
            </button>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="filter-field">
          <label>Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Challan number, project, customer or site"
            aria-label="Search delivery challans"
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={onlyOutstanding}
            onChange={(e) => setOnlyOutstanding(e.target.checked)}
          />
          <span>Only challans with material still to come back</span>
        </label>
      </div>

      {/* A challan belongs to a project, so starting one here is a
          question of which -- then the project's own challan form opens,
          the same one, rather than a second copy of it living here. */}
      {picking && (
        <div className="modal-overlay" onClick={() => setPicking(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New Delivery Challan</h3>
            <div className="filter-field">
              <label>Which project is it for? *</label>
              <select value={pickedProject} onChange={(e) => setPickedProject(e.target.value)}>
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id || p._id} value={p.id || p._id}>
                    {p.name}{p.customer ? ` — ${p.customer}` : ''}
                  </option>
                ))}
              </select>
              {projects.length === 0 && (
                <span className="muted">No open project to write a challan against.</span>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn sec" onClick={() => setPicking(false)}>Cancel</button>
              <button
                type="button"
                className="btn pri"
                disabled={!pickedProject}
                onClick={() => navigate(`/projects/${pickedProject}?dc=new`)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {!canStart && !loading && (
        <p className="muted" style={{ marginTop: 0 }}>
          A challan is written by the project&apos;s Manager or an engineer assigned to it.
        </p>
      )}

      {error && <div className="panel err">{error}</div>}

      {loading ? <p>Loading…</p> : (
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>
            {shown.length} challan{shown.length === 1 ? '' : 's'}
            {outstanding > 0 && <> · <b>{outstanding}</b> returnable still out</>}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Challan</th>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>Division</th>
                  <th>Items</th>
                  <th>Qty</th>
                  <th>To come back</th>
                  <th>Received by</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={9} className="muted">No challans yet.</td></tr>
                )}
                {shown.map((r) => (
                  <tr key={`${r.projectId}-${r.challanNumber}`}>
                    <td><b>DC-{r.challanNumber}</b></td>
                    <td>{r.date ? fmtDate(r.date) : <span className="muted">—</span>}</td>
                    <td>
                      {/* Linked to the project, where it is written,
                          returned against and printed. */}
                      <Link to={`/projects/${r.projectId}`}>{r.projectName || 'Project'}</Link>
                      {r.site && <div className="muted" style={{ fontSize: 11 }}>{r.site}</div>}
                    </td>
                    <td>{r.customer || <span className="muted">—</span>}</td>
                    <td>{r.division || <span className="muted">—</span>}</td>
                    <td>{r.lines}</td>
                    <td>{r.totalQuantity}</td>
                    <td>
                      {r.outstandingReturn > 0
                        ? <span className="status-badge status-pending">{r.outstandingReturn}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>{r.receivedBy || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
