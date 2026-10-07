import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Expiring Subscriptions — PWA `vExpiring()` exact reproduction.
 *
 * PWA FACT: lists companies whose subscription expires within 30 days.
 * PWA FACT: super-only. Shows renew button (status set back to Active).
 */

export default function ExpiringSubscriptions() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/companies');
      const all = data.companies || [];
      const now = new Date();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const expiring = all.filter(c => {
        if (!c.subscriptionEnd) return false;
        const end = new Date(c.subscriptionEnd);
        return end.getTime() - now.getTime() <= thirtyDays && end.getTime() >= now.getTime();
      });
      setCompanies(expiring);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRenew(id) {
    if (!window.confirm('Renew this subscription?')) return;
    try {
      await api.post(`/api/companies/${id}/status`, { status: 'Active' });
      load();
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="enq-page">
      <div className="enq-header"><h2>Expiring in Next 30 Days</h2></div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && companies.length === 0 && (
        <div className="panel"><p className="muted">No subscriptions expiring soon.</p></div>
      )}

      {!loading && companies.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Company</th><th>Plan</th><th>Expires</th><th>Action</th></tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const cid = c.id || c._id;
                return (
                  <tr key={cid}>
                    <td>{c.name}</td>
                    <td>{c.subscriptionPlan || '—'}</td>
                    <td>{fmtDate(c.subscriptionEnd)}</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => handleRenew(cid)}>Renew</button></td>
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
