import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../nav/menuConfig';
import { api } from '../api/client';
import { money, fmtDate } from '../utils/format';
import './enquiries/enquiry.css';

/**
 * Dashboard — PWA `vDash()` exact reproduction.
 *
 * PWA FACT: dispatches by role:
 *   super         → superDash() — platform KPIs
 *   inventory     → invDash()   — stock/low items
 *   engineer      → engDash()   — my projects + my service calls + my material
 *   service_eng   → engDash()   — same
 *   others        → main KPI dashboard — enquiry/SO/project/service/payment cards + panels
 */

export default function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;

  if (user.role === 'super') return <SuperDash />;
  if (user.role === 'inventory') return <InventoryDash />;
  if (user.role === 'engineer' || user.role === 'service_eng') return <EngineerDash />;
  return <MainDash user={user} />;
}

/* ── Super Dashboard — PWA superDash() ── */
function SuperDash() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/companies').then(d => setCompanies(d.companies || []))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const active = companies.filter(c => c.status === 'Active').length;
  const trial = companies.filter(c => c.status === 'Trial').length;
  const suspended = companies.filter(c => c.status === 'Suspended').length;
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const expiring = companies.filter(c => {
    if (!c.subscriptionEnd) return false;
    const end = new Date(c.subscriptionEnd);
    return end.getTime() - now.getTime() <= thirtyDays && end.getTime() >= now.getTime();
  }).length;

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  return (
    <div className="enq-page">
      <h2>Platform Dashboard</h2>
      <div className="kpi-bar">
        <div className="kpi-card" onClick={() => navigate('/admin/companies')}><div className="kpi-value">{companies.length}</div><div className="kpi-label">Companies</div></div>
        <div className="kpi-card"><div className="kpi-value">{active}</div><div className="kpi-label">Active</div></div>
        <div className="kpi-card"><div className="kpi-value">{trial}</div><div className="kpi-label">Trial</div></div>
        <div className="kpi-card"><div className="kpi-value">{suspended}</div><div className="kpi-label">Suspended</div></div>
        <div className="kpi-card" onClick={() => navigate('/admin/expiring')}><div className="kpi-value">{expiring}</div><div className="kpi-label">Expiring Soon</div></div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Quick Links</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/admin/companies')}>Companies</button>
          <button className="btn" onClick={() => navigate('/admin/revenue')}>Revenue</button>
          <button className="btn" onClick={() => navigate('/admin/usage')}>Client Business</button>
          <button className="btn" onClick={() => navigate('/admin/locations')}>Locations</button>
          <button className="btn" onClick={() => navigate('/reports')}>Reports</button>
        </div>
      </div>
    </div>
  );
}

/* ── Inventory Dashboard — PWA invDash() ── */
function InventoryDash() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/inventory/items').then(d => setItems(d.items || []))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const lowStock = items.filter(i => i.qty !== undefined && i.minQty !== undefined && i.qty <= i.minQty);
  const totalItems = items.length;

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  return (
    <div className="enq-page">
      <h2>Inventory Dashboard</h2>
      <div className="kpi-bar">
        <div className="kpi-card" onClick={() => navigate('/inventory/stock')}><div className="kpi-value">{totalItems}</div><div className="kpi-label">Total Items</div></div>
        <div className="kpi-card"><div className="kpi-value" style={{ color: lowStock.length > 0 ? '#e53935' : undefined }}>{lowStock.length}</div><div className="kpi-label">Low Stock</div></div>
      </div>
      {lowStock.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Low Stock Items</h3>
          <table className="data-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Min Qty</th></tr></thead>
            <tbody>
              {lowStock.map(i => (
                <tr key={i.id || i._id}>
                  <td>{i.name}</td>
                  <td style={{ color: '#e53935', fontWeight: 600 }}>{i.qty}</td>
                  <td>{i.minQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Engineer / Service Engineer Dashboard — PWA engDash() ── */
function EngineerDash() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [serviceCalls, setServiceCalls] = useState([]);
  const [material, setMaterial] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/api/projects').catch(() => ({ projects: [] })),
      api.get('/api/service-calls').catch(() => ({ serviceCalls: [] })),
      api.get('/api/inventory/issues/my-material').catch(() => ({ items: [] })),
    ]).then(([p, s, m]) => {
      /* PWA FACT: engDash shows only projects/service calls assigned to this engineer */
      const myId = user?.id;
      setProjects((p.projects || []).filter(x =>
        x.assignedEngineerId === myId || x.engineerId === myId ||
        (x.engineers || []).some(e => (e.id || e) === myId)
      ));
      setServiceCalls((s.serviceCalls || []).filter(x =>
        x.assignedEngineerId === myId || x.engineerId === myId
      ));
      setMaterial(m.items || m.material || []);
    }).finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  return (
    <div className="enq-page">
      <h2>{user?.role === 'service_eng' ? 'My Service Jobs' : 'My Work'}</h2>

      <div className="kpi-bar">
        {user?.role !== 'service_eng' && (
          <div className="kpi-card" onClick={() => navigate('/projects')}><div className="kpi-value">{projects.length}</div><div className="kpi-label">My Projects</div></div>
        )}
        <div className="kpi-card" onClick={() => navigate('/service-calls')}><div className="kpi-value">{serviceCalls.length}</div><div className="kpi-label">My Service Calls</div></div>
        <div className="kpi-card" onClick={() => navigate('/my-material')}><div className="kpi-value">{material.length}</div><div className="kpi-label">My Material</div></div>
      </div>

      {projects.length > 0 && user?.role !== 'service_eng' && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>My Projects</h3>
          <table className="data-table">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th></tr></thead>
            <tbody>
              {projects.slice(0, 10).map(p => (
                <tr key={p.id || p._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id || p._id}`)}>
                  <td>{p.projectNo || p.name || '—'}</td>
                  <td>{p.clientName || '—'}</td>
                  <td>{p.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {serviceCalls.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>My Service Calls</h3>
          <table className="data-table">
            <thead><tr><th>Call #</th><th>Client</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {serviceCalls.slice(0, 10).map(s => (
                <tr key={s.id || s._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/service-calls/${s.id || s._id}`)}>
                  <td>{s.callNo || '—'}</td>
                  <td>{s.clientName || '—'}</td>
                  <td>{s.serviceType || '—'}</td>
                  <td>{s.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Main Dashboard — PWA vDash() default for admin/sales/PM/service_mgr/finance ── */
function MainDash({ user }) {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetches = {};
    const role = user?.role;

    /* Fetch counts based on what this role can see (PWA FACT: menu-driven) */
    const promises = [];
    if (['admin', 'sales'].includes(role)) {
      promises.push(api.get('/api/enquiries?limit=1').then(d => { fetches.enquiries = d.total || (d.enquiries || []).length; }).catch(() => {}));
    }
    if (['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'finance'].includes(role)) {
      promises.push(api.get('/api/sales-orders?limit=1').then(d => { fetches.salesOrders = d.total || (d.salesOrders || []).length; }).catch(() => {}));
    }
    if (['admin', 'hvac_pm', 'solar_pm', 'mep_pm'].includes(role)) {
      promises.push(api.get('/api/projects?limit=1').then(d => { fetches.projects = d.total || (d.projects || []).length; }).catch(() => {}));
    }
    if (['admin', 'service_mgr'].includes(role)) {
      promises.push(api.get('/api/service-calls?limit=1').then(d => { fetches.serviceCalls = d.total || (d.serviceCalls || []).length; }).catch(() => {}));
    }
    if (['admin', 'finance'].includes(role)) {
      promises.push(api.get('/api/payments?limit=1').then(d => { fetches.payments = d.total || (d.payments || []).length; }).catch(() => {}));
    }
    if (['admin', 'service_mgr'].includes(role)) {
      promises.push(api.get('/api/contracts?limit=1').then(d => { fetches.contracts = d.total || (d.contracts || []).length; }).catch(() => {}));
    }

    Promise.all(promises).then(() => setStats(fetches)).finally(() => setLoading(false));
  }, [user?.role]);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  return (
    <div className="enq-page">
      <h2>Dashboard</h2>
      <div className="kpi-bar">
        {stats.enquiries !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/enquiries')}><div className="kpi-value">{stats.enquiries}</div><div className="kpi-label">Enquiries</div></div>
        )}
        {stats.salesOrders !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/sales-orders')}><div className="kpi-value">{stats.salesOrders}</div><div className="kpi-label">Sales Orders</div></div>
        )}
        {stats.projects !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/projects')}><div className="kpi-value">{stats.projects}</div><div className="kpi-label">Projects</div></div>
        )}
        {stats.serviceCalls !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/service-calls')}><div className="kpi-value">{stats.serviceCalls}</div><div className="kpi-label">Service Calls</div></div>
        )}
        {stats.contracts !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/contracts')}><div className="kpi-value">{stats.contracts}</div><div className="kpi-label">Contracts</div></div>
        )}
        {stats.payments !== undefined && (
          <div className="kpi-card" onClick={() => navigate('/payments')}><div className="kpi-value">{stats.payments}</div><div className="kpi-label">Payments</div></div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <p className="muted">Welcome, {user.name} ({ROLE_LABELS[user.role] || user.role})</p>
      </div>
    </div>
  );
}
