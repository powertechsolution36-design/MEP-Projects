import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import { todayKey } from '../../utils/platform';
import { divisionClass } from '../../utils/divisions';

/**
 * Project List — PWA `vProjects()` (MEP_PROJECTS_PWA/index.html:2089-2109).
 *
 * PWA FACT (MENUS, index.html:1225-1237): admin and the three PM roles have
 * the Projects menu item; a PM sees only their own division (`myDiv()`).
 * The server enforces the same scoping (projectService.listProjects).
 *
 * PWA FACT (index.html:2094): nineteen columns, in this order —
 *   SO No · Project · Div · Site Type · Cap. · Customer · Stage · Start ·
 *   Engineer(s) · Checklist · Timeline · Target End · Delay · Next Action ·
 *   Next Action Date · Received · Pending · Material Pending Return · Status
 * The derived ones (checklist progress, timeline readiness, target end,
 * overdue count, next action, payments, pending returnable material) are
 * computed server-side by projectService.buildProjectListRow — the same
 * ports the dashboard and the CSV export already use — so this screen, that
 * panel and the exported file can never disagree. `?view=full` asks for them.
 *
 * PWA FACT (index.html:2100): a project with at least one overdue checklist
 * point tints its whole row; the Delay, Next Action Date, Pending and
 * Material Pending Return cells turn red on their own conditions.
 *
 * PWA FACT (index.html:2092): no "+ New Project" button — a project exists
 * only because a Sales Order cascade created it. Preserved exactly.
 */

const PM_DIVISION = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

export default function ProjectList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: 'full' });
      if (search) params.set('q', search);
      // The unfiltered count powers the PWA's "N of M" search chip
      // (srchBar, index.html:2093); it is only fetched while searching.
      const [data, all] = await Promise.all([
        api.get(`/api/projects?${params.toString()}`),
        search ? api.get('/api/projects') : null,
      ]);
      const rows = data.projects || [];
      setProjects(rows);
      setTotal(all ? (all.projects || []).length : rows.length);
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
      const qs = params.toString();
      const resp = await fetch(`${API_BASE_URL}/api/projects/export.csv${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // PWA FACT (dlProjects, index.html:3433).
      a.download = `projects-${PM_DIVISION[user?.role] || 'all'}-${todayKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  }

  /* PWA FACT: export is for admin + the three PM roles (PROJECT_EXPORT_ROLES). */
  const canExport = ['admin', 'hvac_pm', 'solar_pm', 'mep_pm'].includes(user?.role);
  const divisionLabel = PM_DIVISION[user?.role];
  const today = todayKey();

  // PWA FACT (index.html:2100): the Stage badge greens on the project's
  // STATUS being Completed, not on the stage name.
  function stageClass(p) {
    return p.status === 'Completed' ? 'status-won' : 'status-pending';
  }
  function statusClass(status) {
    if (status === 'Completed') return 'status-won';
    if (status === 'In Service') return 'status-lost';
    return 'status-open';
  }

  return (
    <div className="proj-page">
      <div className="proj-header">
        <h2>🏗️ {divisionLabel ? `${divisionLabel} Projects` : 'Projects'}</h2>
        <div className="proj-actions">
          {canExport && <button className="btn sec sm" onClick={handleExport}>📥 Report</button>}
        </div>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search project, SO no, customer, stage, engineer, vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="search-count">{projects.length} of {total}</span>
        {search && <button className="btn sec sm" onClick={() => setSearch('')}>✕ Clear</button>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏗️</div>
          <div className="empty-state-title">No projects found.</div>
          <p className="muted">A project is created automatically when Sales converts a Sales Order.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SO No</th>
                <th>Project</th>
                <th>Div</th>
                <th>Site Type</th>
                <th>Cap.</th>
                <th>Customer</th>
                <th>Stage</th>
                <th>Start</th>
                <th>Engineer(s)</th>
                <th>Checklist</th>
                <th>Timeline</th>
                <th>Target End</th>
                <th>Delay</th>
                <th>Next Action</th>
                <th>Next Action Date</th>
                <th>Received</th>
                <th>Pending</th>
                <th>Material Pending Return</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const overdue = p.overduePoints || 0;
                const pay = p.payment;
                const pendingReturn = p.materialPendingReturn || 0;
                return (
                  <tr
                    key={p.id}
                    className={`clickable-row${overdue > 0 ? ' row-bad' : ''}`}
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <td>{p.orderNumber || '-'}</td>
                    <td><strong>{p.name}</strong></td>
                    <td><span className={divisionClass(p.division)}>{p.division}</span></td>
                    <td>{p.siteType || '-'}</td>
                    <td>{p.capacity || '-'}</td>
                    <td>{p.customer || '-'}</td>
                    <td><span className={`status-badge ${stageClass(p)}`}>{p.stage}</span></td>
                    <td>{fmtDate(p.startDate)}</td>
                    <td>{(p.engineerNames || []).join(', ') || '—'}</td>
                    <td className="nowrap">{p.checklistDone}/{p.checklistTotal}</td>
                    <td>
                      {p.timelineSetReady
                        ? <span className="status-badge status-won">Set</span>
                        : <span className="status-badge status-lost">Not set</span>}
                    </td>
                    <td>{p.targetEnd || '-'}</td>
                    <td className={overdue > 0 ? 'due' : undefined}>
                      {overdue > 0 ? `${overdue} overdue ⚠` : (p.timelineSetReady ? 'On track' : '-')}
                    </td>
                    <td>{p.nextAction || '-'}</td>
                    <td className={p.nextActionOverdue ? 'due' : undefined}>
                      {p.nextActionDate || '-'}{p.nextActionOverdue ? ' ⚠' : ''}
                    </td>
                    <td className="fg-ok">{pay ? money(pay.received) : '-'}</td>
                    <td className={pay && pay.pending > 0 ? 'due' : undefined}>
                      {pay ? (pay.pending > 0 ? money(pay.pending) : '✔ Clear') : '-'}
                    </td>
                    <td className={pendingReturn > 0 ? 'due' : undefined}>{pendingReturn > 0 ? pendingReturn : '-'}</td>
                    <td><span className={`status-badge ${statusClass(p.status)}`}>{p.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && projects.some((p) => (p.overduePoints || 0) > 0) && (
        <p className="muted">Rows tinted red have at least one checklist point past its target date (as of {today}).</p>
      )}
    </div>
  );
}
