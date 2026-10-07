import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { money } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Subscription Revenue — PWA `vRevenue()` exact reproduction.
 *
 * PWA FACT: Monthly/Yearly/Total toggle. MRR table per company.
 * PWA FACT: super-only.
 * NOTE: Backend may not yet have a dedicated revenue API; this page
 * reads companies and computes from subscription fields where available.
 */

export default function SubscriptionRevenue() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('monthly'); // monthly | yearly | total

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/companies');
      setCompanies(data.companies || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = companies.filter(c => c.status === 'Active' || c.status === 'Trial');

  return (
    <div className="enq-page">
      <div className="enq-header"><h2>Subscription Revenue</h2></div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
        {['monthly', 'yearly', 'total'].map(v => (
          <button key={v} className={`btn ${view === v ? 'btn-primary' : ''}`}
            style={{ borderRadius: 0, flex: 1, textTransform: 'capitalize' }}
            onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>Status</th><th>Plan</th><th>Revenue</th></tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr><td colSpan={4} className="muted">No active subscriptions.</td></tr>
              ) : active.map(c => {
                const cid = c.id || c._id;
                const mrr = c.mrr || c.monthlyRevenue || 0;
                const amt = view === 'monthly' ? mrr : view === 'yearly' ? mrr * 12 : mrr * 12;
                return (
                  <tr key={cid}>
                    <td>{c.name}</td>
                    <td>{c.status}</td>
                    <td>{c.subscriptionPlan || '—'}</td>
                    <td>{money(amt)}</td>
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
