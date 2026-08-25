import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

const SUB = [
  { to: '', label: 'Client Business', icon: '📈', end: true },
  { to: 'revenue', label: 'Revenue', icon: '💵' },
  { to: 'expiring', label: 'Expiring Soon', icon: '⏳' },
  { to: 'locations', label: 'Locations', icon: '📍' },
];

export default function SuperAnalytics() {
  return (
    <div>
      <div className="main-header"><h2>Super Admin Analytics</h2></div>
      <div className="inv-tabs">
        {SUB.map(t => (
          <NavLink key={t.to || 'u'} to={t.to} end={t.end} className="inv-tab">
            <span>{t.icon}</span><span>{t.label}</span>
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route path="" element={<ClientBusiness />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="expiring" element={<Expiring />} />
        <Route path="locations" element={<Locations />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  );
}

function ClientBusiness() {
  const s = useStore();
  const rows = s.companies.map(co => {
    const cid = String(co._id);
    const projects = s.projects.filter(p => String(p.co) === cid);
    const calls = s.serviceCalls.filter(c => String(c.co) === cid);
    const enquiries = s.enquiries.filter(e => String(e.co) === cid);
    const salesOrders = s.salesOrders.filter(o => String(o.co) === cid);
    const salesTotal = salesOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const users = s.users.filter(u => String(u.co) === cid).length;
    return { co, users, projects: projects.length, activeProjects: projects.filter(p => p.status === 'active').length, calls: calls.length, enquiries: enquiries.length, salesTotal };
  });
  return (
    <div className="card">
      <div className="tw"><table className="data-table">
        <thead><tr><th>Company</th><th>Users</th><th>Projects</th><th>Active</th><th>Service Calls</th><th>Enquiries</th><th>Sales Total</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="text-center text-mut" style={{padding: 40}}>No companies</td></tr>}
          {rows.map(r => (
            <tr key={r.co._id}>
              <td><strong>{r.co.name}</strong><div className="text-mut text-sm">{r.co.code || '—'}</div></td>
              <td>{r.users}</td>
              <td>{r.projects}</td>
              <td><span className="badge grn">{r.activeProjects}</span></td>
              <td>{r.calls}</td>
              <td>{r.enquiries}</td>
              <td>₹{r.salesTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Revenue() {
  const s = useStore();
  // Compute MRR from company meta.subscription (if set) or a flat rate estimate
  const rows = s.companies.map(co => {
    const sub = co.meta?.subscription || {};
    const rate = sub.rate || 0;
    const cycle = sub.cycle || 'monthly';
    const mrr = cycle === 'yearly' ? rate / 12 : rate;
    return { co, rate, cycle, mrr, status: sub.status || 'active', renewsOn: sub.renewsOn };
  });
  const totalMrr = rows.reduce((s, r) => s + (r.status === 'active' ? r.mrr : 0), 0);
  const arr = totalMrr * 12;
  return (
    <div>
      <div className="grid grid-3 mb-3">
        <StatBox label="MRR (Monthly Recurring Revenue)" value={`₹${Math.round(totalMrr).toLocaleString()}`} color="var(--red)" />
        <StatBox label="ARR (Annual)" value={`₹${Math.round(arr).toLocaleString()}`} color="var(--green)" />
        <StatBox label="Paying Companies" value={rows.filter(r => r.status === 'active' && r.mrr > 0).length} color="var(--blue)" />
      </div>
      <div className="card">
        <div className="tw"><table className="data-table">
          <thead><tr><th>Company</th><th>Status</th><th>Cycle</th><th>Rate</th><th>MRR</th><th>Renews</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.co._id}>
                <td><strong>{r.co.name}</strong></td>
                <td><span className={`badge ${r.status === 'active' ? 'grn' : 'red'}`}>{r.status}</span></td>
                <td>{r.cycle}</td>
                <td>₹{r.rate.toLocaleString()}</td>
                <td>₹{Math.round(r.mrr).toLocaleString()}</td>
                <td>{r.renewsOn ? new Date(r.renewsOn).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="text-mut text-sm mt-2">Rates and cycles come from each company's <code>meta.subscription</code>. Edit companies to set them.</p>
      </div>
    </div>
  );
}

function Expiring() {
  const s = useStore();
  const now = Date.now();
  const in30 = 30 * 24 * 60 * 60 * 1000;

  const subs = s.companies.map(co => {
    const renews = co.meta?.subscription?.renewsOn ? new Date(co.meta.subscription.renewsOn).getTime() : null;
    const days = renews ? Math.round((renews - now) / (24 * 60 * 60 * 1000)) : null;
    return { co, renews, days };
  }).filter(x => x.days !== null && x.days <= 30);

  const contracts = s.contracts.filter(c => {
    if (!c.end || c.status !== 'active') return false;
    const days = (new Date(c.end).getTime() - now) / (24 * 60 * 60 * 1000);
    return days >= 0 && days <= 60;
  });

  return (
    <div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Subscriptions expiring in 30 days ({subs.length})</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Company</th><th>Renews On</th><th>Days Left</th></tr></thead>
          <tbody>
            {subs.length === 0 && <tr><td colSpan={3} className="text-center text-mut" style={{padding: 20}}>None</td></tr>}
            {subs.map(x => (
              <tr key={x.co._id}>
                <td><strong>{x.co.name}</strong></td>
                <td>{new Date(x.renews).toLocaleDateString()}</td>
                <td><span className={`badge ${x.days < 7 ? 'red' : 'amb'}`}>{x.days} days</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>AMC/Contracts expiring in 60 days ({contracts.length})</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Client</th><th>Type</th><th>End Date</th><th>Value</th></tr></thead>
          <tbody>
            {contracts.length === 0 && <tr><td colSpan={4} className="text-center text-mut" style={{padding: 20}}>None</td></tr>}
            {contracts.map(c => (
              <tr key={c._id}>
                <td><strong>{c.client}</strong></td>
                <td>{c.type}</td>
                <td>{new Date(c.end).toLocaleDateString()}</td>
                <td>₹{(c.value || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function Locations() {
  const s = useStore();
  // Group companies by city (parse from address or use dedicated field)
  const groups = {};
  s.companies.forEach(co => {
    const city = extractCity(co.address) || 'Unknown';
    (groups[city] ||= []).push(co);
  });
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  return (
    <div>
      <div className="grid grid-3">
        {sorted.map(([city, cos]) => (
          <div key={city} className="card">
            <div className="text-mut text-sm">{city}</div>
            <div className="stat-value">{cos.length}</div>
            <div className="mt-1">
              {cos.map(c => <div key={c._id} className="text-sm">· {c.name}</div>)}
            </div>
          </div>
        ))}
        {sorted.length === 0 && <div className="card text-center text-mut">No location data</div>}
      </div>
    </div>
  );
}

function extractCity(addr) {
  if (!addr) return null;
  // last non-empty comma-separated segment before pincode as a fallback
  const parts = String(addr).split(',').map(s => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!/^\d{5,}$/.test(parts[i])) return parts[i];
  }
  return parts[0];
}

function StatBox({ label, value, color }) {
  return (
    <div className="stat-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div>
        <div className="text-mut text-sm">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}
