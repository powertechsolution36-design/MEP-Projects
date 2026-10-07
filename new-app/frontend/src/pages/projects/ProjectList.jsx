import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Project List — PWA `vProjects()` exact reproduction.
 *
 * PWA MENUS: admin, hvac_pm, solar_pm, mep_pm have the Projects menu item.
 * PM roles see only their own division; all other roles see all.
 * Table columns: Project Name, Division, Stage, Status, Start, End.
 * Search: free-text over project fields + engineer names.
 * Export: dlProjects -> CSV.
 *
 * PWA FACT: No "+ New Project" button — projects are created ONLY via
 * SalesOrder creation (cascade). This is preserved exactly.
 */

export default function ProjectList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const qs = params.toString();
      const data = await api.get('/api/projects' + (qs ? '?' + qs : ''));
      setProjects(data.projects || []);
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
        API_BASE_URL + '/api/projects/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'projects.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  /* PWA FACT: Export is only for admin/hvac_pm/solar_pm/mep_pm (PROJECT_EXPORT_ROLES) */
  const canExport = ['admin', 'hvac_pm', 'solar_pm', 'mep_pm'].includes(user?.role);

  function stageClass(stage) {
    if (stage === 'Completed' || stage === 'Delivered') return 'status-won';
    return 'status-open';
  }

  function statusClass(status) {
    if (status === 'Completed') return 'status-won';
    if (status === 'In Service') return 'status-pending';
    return 'status-open';
  }

  return (
    <div className="proj-page">
      <div className="proj-header">
        <h2>🏗️ Projects</h2>
        <div className="proj-actions">
          {canExport && (
            <button className="btn sec sm" onClick={handleExport}>📥 Export CSV</button>
          )}
        </div>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search projects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects found.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Division</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} className="clickable-row" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td>{p.name}</td>
                  <td>{p.division}</td>
                  <td><span className={'status-badge ' + stageClass(p.stage)}>{p.stage}</span></td>
                  <td><span className={'status-badge ' + statusClass(p.status)}>{p.status}</span></td>
                  <td>{fmtDate(p.startDate)}</td>
                  <td>{fmtDate(p.endDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
