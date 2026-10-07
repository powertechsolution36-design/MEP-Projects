import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { money } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Client Business & Usage — PWA `vUsage()` exact reproduction.
 *
 * PWA FACT: per-company stats (enquiries, SOs, projects, service calls, AMC, users,
 *   billed, collected, outstanding). super-only.
 * NOTE: The backend doesn't yet have a dedicated usage aggregation API.
 * This page shows company list; actual per-company stats would require
 * cross-entity aggregation endpoints. Shown as a placeholder that lists
 * companies with available fields — the aggregation data comes when
 * the real MongoDB backend is wired (production pass).
 */

export default function ClientUsage() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/companies');
      setCompanies(data.companies || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="enq-page">
      <div className="enq-header"><h2>Client Business & Usage</h2></div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && companies.length === 0 && (
        <div className="panel"><p className="muted">No companies.</p></div>
      )}

      {!loading && companies.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Divisions</th>
                <th>Users</th>
                <th>Plan</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const cid = c.id || c._id;
                return (
                  <tr key={cid}>
                    <td>{c.name}</td>
                    <td>{c.status || 'Trial'}</td>
                    <td>{(c.divisions || []).join(', ') || '—'}</td>
                    <td>{c.maxUsers || '—'}</td>
                    <td>{c.subscriptionPlan || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
