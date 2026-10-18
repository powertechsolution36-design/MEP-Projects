import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { money } from '../../utils/format';
import { coDivs, mrr, collected } from '../../utils/platform';

/** Subscription Revenue — PWA `vRevenue()` (MEP_PROJECTS_PWA/index.html:1504-1516). Super only. */
export default function SubscriptionRevenue() {
  const [companies, setCompanies] = useState([]);
  const [mode, setMode] = useState('Monthly');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/companies').then(d => setCompanies(d.companies || [])).catch(err => setError(err.message));
  }, []);

  const active = companies.filter(c => c.status === 'Active');
  const totMRR = companies.reduce((a, c) => a + mrr(c), 0);
  const rev = mode === 'Monthly' ? totMRR : mode === 'Yearly' ? totMRR * 12 : companies.reduce((a, c) => a + collected(c), 0);
  const label = mode === 'Monthly' ? 'Monthly Revenue (MRR)' : mode === 'Yearly' ? 'Yearly Revenue (ARR)' : 'Total Revenue (collected)';

  return (
    <div className="enq-page">
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div className="panel">
        <div className="enq-header">
          <h3>💵 Subscription Revenue</h3>
          <div className="enq-actions">
            {['Monthly', 'Yearly', 'Total'].map(m => (
              <button key={m} className={`btn sm ${mode === m ? 'pri' : 'sec'}`} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
        </div>
        <div className="kpi-card" style={{ border: 'none' }}><div className="kpi-value">{money(Math.round(rev))}</div><div className="kpi-label">{label}</div></div>
        <table className="data-table">
          <thead><tr><th>Company</th><th>Divisions</th><th>Cycle</th><th>Rate</th><th>Monthly Equiv.</th><th>Collected (approx)</th></tr></thead>
          <tbody>
            {active.map(c => (
              <tr key={c.id}><td><b>{c.name}</b></td><td>{coDivs(c).join(' · ')}</td><td>{c.subscriptionCycle || '-'}</td>
                <td>{money(c.subscriptionRate)}</td><td>{money(Math.round(mrr(c)))}</td><td>{money(collected(c))}</td></tr>
            ))}
            {active.length === 0 && <tr><td colSpan={6} className="muted">No active subscriptions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
