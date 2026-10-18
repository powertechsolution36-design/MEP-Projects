import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { money } from '../../utils/format';
import { coDivs, todayKey, downloadCsv } from '../../utils/platform';

/**
 * Client Business & Usage — PWA `vUsage()` / `dlUsage()`
 * (MEP_PROJECTS_PWA/index.html:1446-1480). Super only.
 * Per-company figures come from GET /api/companies/platform/usage (coStats).
 */
export default function ClientUsage() {
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/api/companies'), api.get('/api/companies/platform/usage')])
      .then(([c, u]) => {
        setCompanies(c.companies || []);
        setUsage(Object.fromEntries((u.usage || []).map(r => [r.companyId, r])));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  if (error) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;

  const keys = ['sales', 'sos', 'prj', 'ongoing', 'svc', 'amc', 'users', 'coll', 'out', 'enq'];
  const tot = Object.fromEntries(keys.map(k => [k, 0]));
  companies.forEach(c => { const s = usage[c.id] || {}; keys.forEach(k => { tot[k] += s[k] || 0; }); });

  function exportCsv() {
    const rows = [[`CLIENT BUSINESS & USAGE REPORT — ${todayKey()}`], [],
      ['Company', 'City', 'Status', 'Divisions', 'Enquiries', 'Open Enquiries', 'Enquiry Value', 'Sales Orders', 'Total Sales Value', 'Projects', 'Ongoing', 'Completed', 'HVAC', 'Solar', 'MEP', 'Service Calls', 'Open Calls', 'AMC Contracts', 'Users', 'Billed', 'Collected', 'Outstanding']];
    companies.forEach(c => {
      const s = usage[c.id] || {};
      rows.push([c.name, c.city, c.status, coDivs(c).join(' + '), s.enq, s.enqOpen, s.enqVal, s.sos, s.sales, s.prj, s.ongoing, s.done, s.hvac, s.solar, s.mep, s.svc, s.svcOpen, s.amc, s.users, s.billed, s.coll, s.out]);
    });
    downloadCsv(`client-business-${todayKey()}.csv`, rows);
  }

  return (
    <div className="enq-page">
      <div className="kpi-bar">
        <div className="kpi-card"><div className="kpi-value">{money(tot.sales)}</div><div className="kpi-label">Total Sales Value (all clients)</div></div>
        <div className="kpi-card"><div className="kpi-value">{tot.sos}</div><div className="kpi-label">Total Sales Orders</div></div>
        <div className="kpi-card"><div className="kpi-value">{tot.prj}</div><div className="kpi-label">Total Projects</div></div>
        <div className="kpi-card"><div className="kpi-value">{tot.ongoing}</div><div className="kpi-label">Ongoing Projects</div></div>
        <div className="kpi-card"><div className="kpi-value">{tot.svc}</div><div className="kpi-label">Service Calls</div></div>
        <div className="kpi-card"><div className="kpi-value">{tot.amc}</div><div className="kpi-label">AMC / Warranty Contracts</div></div>
      </div>
      <div className="panel">
        <div className="enq-header"><h3>📈 Business Handled by Each Client Company</h3><button className="btn sm sec" onClick={exportCsv}>⬇ Export</button></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Company</th><th>Status</th><th>Enquiries</th><th>Enquiry Value</th><th>Sales Orders</th><th>Total Sales Value</th><th>Projects</th><th>Ongoing</th><th>Completed</th><th>HVAC</th><th>Solar</th><th>MEP</th><th>Service Calls</th><th>AMC</th><th>Users</th></tr></thead>
            <tbody>
              {companies.map(c => {
                const s = usage[c.id] || {};
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="muted">{c.city}</div></td><td>{c.status}</td>
                    <td>{s.enq}<div className="muted">{s.enqOpen} open</div></td><td>{money(s.enqVal) || '-'}</td>
                    <td><b>{s.sos}</b></td><td style={{ color: 'green' }}><b>{money(s.sales) || '-'}</b></td>
                    <td><b>{s.prj}</b></td><td>{s.ongoing}</td><td>{s.done}</td><td>{s.hvac}</td><td>{s.solar}</td><td>{s.mep}</td>
                    <td>{s.svc}<div className="muted">{s.svcOpen} open</div></td><td>{s.amc}</td><td>{s.users}</td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 800, background: '#f7f9fb' }}>
                <td colSpan={2}>TOTAL</td><td>{tot.enq}</td><td></td><td>{tot.sos}</td><td>{money(tot.sales)}</td><td>{tot.prj}</td><td>{tot.ongoing}</td><td colSpan={4}></td><td>{tot.svc}</td><td>{tot.amc}</td><td>{tot.users}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>💼 Payments Handled Through the App</h3>
        <table className="data-table">
          <thead><tr><th>Company</th><th>Billed</th><th>Collected</th><th>Outstanding</th><th>Collection %</th></tr></thead>
          <tbody>
            {companies.map(c => {
              const s = usage[c.id] || {};
              return (
                <tr key={c.id}><td><b>{c.name}</b></td><td>{money(s.billed) || '-'}</td><td style={{ color: 'green' }}>{money(s.coll) || '-'}</td>
                  <td style={s.out > 0 ? { color: '#c62828' } : undefined}>{money(s.out) || '-'}</td><td>{s.billed ? `${Math.round(s.coll * 100 / s.billed)}%` : '-'}</td></tr>
              );
            })}
            <tr style={{ fontWeight: 800, background: '#f7f9fb' }}><td>TOTAL</td><td></td><td style={{ color: 'green' }}>{money(tot.coll)}</td><td style={{ color: '#c62828' }}>{money(tot.out)}</td><td></td></tr>
          </tbody>
        </table>
        <p className="muted">Useful for pricing plans — clients handling more sales value and projects can be moved to higher tiers.</p>
      </div>
    </div>
  );
}
