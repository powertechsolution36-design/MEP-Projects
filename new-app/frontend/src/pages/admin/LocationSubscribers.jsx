import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { money } from '../../utils/format';
import { coDivs, mrr, firstContact } from '../../utils/platform';

/** Location-wise Subscribers — PWA `vLocations()` (MEP_PROJECTS_PWA/index.html:1529-1545). Super only. */
export default function LocationSubscribers() {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/companies').then(d => setCompanies(d.companies || [])).catch(err => setError(err.message));
  }, []);

  const locs = {};
  companies.forEach(c => {
    const k = c.city || 'Unknown';
    locs[k] = locs[k] || { t: 0, a: 0, tr: 0, s: 0 };
    locs[k].t += 1;
    if (c.status === 'Active') locs[k].a += 1;
    if (c.status === 'Trial') locs[k].tr += 1;
    if (c.status === 'Suspended') locs[k].s += 1;
  });
  const keys = Object.keys(locs).sort();

  return (
    <div className="enq-page">
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div className="panel">
        <h3>📍 Location-wise Subscribers</h3>
        <table className="data-table">
          <thead><tr><th>Location</th><th>Total</th><th>Active</th><th>Trial</th><th>Suspended</th><th>MRR</th></tr></thead>
          <tbody>
            {keys.map(k => {
              const m = companies.filter(c => (c.city || 'Unknown') === k).reduce((a, c) => a + mrr(c), 0);
              return <tr key={k}><td><b>{k}</b></td><td>{locs[k].t}</td><td>{locs[k].a}</td><td>{locs[k].tr}</td><td>{locs[k].s}</td><td>{money(Math.round(m))}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {keys.map(k => (
        <div className="panel" key={k}>
          <h3>{k}</h3>
          <table className="data-table">
            <thead><tr><th>Company</th><th>Status</th><th>Divisions</th><th>Contact</th></tr></thead>
            <tbody>
              {companies.filter(c => (c.city || 'Unknown') === k).map(c => {
                const ct = firstContact(c);
                return <tr key={c.id}><td><b>{c.name}</b></td><td>{c.status}</td><td>{coDivs(c).join(' · ')}</td><td>{ct.name || '-'} {ct.phone}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
