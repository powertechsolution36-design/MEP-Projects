import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import '../enquiries/enquiry.css';

/**
 * Location-wise Subscribers — PWA `vLocations()` exact reproduction.
 *
 * PWA FACT: groups companies by city, shows count per location and per-location list.
 * PWA FACT: super-only.
 */

export default function LocationSubscribers() {
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/companies');
      const all = data.companies || [];
      const byCity = {};
      for (const c of all) {
        const city = c.city || 'Unknown';
        if (!byCity[city]) byCity[city] = [];
        byCity[city].push(c);
      }
      setGroups(byCity);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cities = Object.keys(groups).sort();

  return (
    <div className="enq-page">
      <div className="enq-header"><h2>Location-wise Subscribers</h2></div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && cities.length === 0 && (
        <div className="panel"><p className="muted">No companies found.</p></div>
      )}

      {!loading && cities.map(city => (
        <div className="panel" key={city} style={{ marginBottom: 16 }}>
          <h3>{city} ({groups[city].length})</h3>
          <table className="data-table">
            <thead><tr><th>Company</th><th>Status</th><th>Plan</th></tr></thead>
            <tbody>
              {groups[city].map(c => (
                <tr key={c.id || c._id}>
                  <td>{c.name}</td>
                  <td>{c.status || 'Trial'}</td>
                  <td>{c.subscriptionPlan || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
