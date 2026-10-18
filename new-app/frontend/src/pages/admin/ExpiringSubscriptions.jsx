import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';
import { expiring30, firstContact } from '../../utils/platform';

/** Expiring Soon — PWA `vExpiring()` (MEP_PROJECTS_PWA/index.html:1517-1528). Super only. */
export default function ExpiringSubscriptions() {
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/companies').then(d => setCompanies(d.companies || [])).catch(err => setError(err.message));
  }, []);

  const rows = expiring30(companies);
  return (
    <div className="enq-page">
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div className="panel">
        <h3>⏳ Expiring in Next 30 Days</h3>
        {rows.length === 0 ? <p className="muted">No subscriptions or trials expiring in the next 30 days.</p> : (
          <table className="data-table">
            <thead><tr><th>Company</th><th>City</th><th>Type</th><th>Expiry Date</th><th>Contact</th><th></th></tr></thead>
            <tbody>
              {rows.map(c => {
                const ct = firstContact(c);
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td><td>{c.city}</td>
                    <td>{c.status === 'Trial' ? 'Trial ends' : 'Subscription ends'}</td>
                    <td style={{ color: '#c62828' }}>{fmtDate(c.status === 'Trial' ? c.trialEnd : c.subscriptionEnd)}</td>
                    <td>{ct.name || '-'} {ct.phone}</td>
                    {/* PWA FACT: "Renew / Edit" opens the company edit form */}
                    <td><button className="btn sm sec" onClick={() => navigate(`/admin/companies?edit=${c.id}`)}>Renew / Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
