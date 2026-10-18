import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { money, fmtDate } from '../utils/format';
import { mrr, expiring30 } from '../utils/platform';

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

/* ── Super Dashboard — PWA superDash() (index.html:1482-1503) ──
   Six platform KPIs, five client-business KPIs (coStats totals from
   GET /api/companies/platform/usage), Quick Links and the
   "Needs Attention — expiring within 30 days" table. */
function SuperDash() {
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.get('/api/companies'), api.get('/api/companies/platform/usage')])
      .then(([c, u]) => { setCompanies(c.companies || []); setUsage(u.usage || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  const act = companies.filter((c) => c.status === 'Active');
  const totMRR = companies.reduce((a, c) => a + mrr(c), 0);
  const A = { sales: 0, prj: 0, ongoing: 0, sos: 0, svc: 0 };
  usage.forEach((s) => { Object.keys(A).forEach((k) => { A[k] += s[k] || 0; }); });
  const expg = expiring30(companies);
  const k = (n, l, onClick) => (
    <div className="kpi-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="kpi-value">{n}</div><div className="kpi-label">{l}</div>
    </div>
  );

  return (
    <div className="enq-page">
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div className="kpi-bar">
        {k(companies.length, 'Total Companies')}
        {k(act.length, 'Active Subscriptions')}
        {k(companies.filter((c) => c.status === 'Trial').length, 'On Trial (15 days)')}
        {k(companies.filter((c) => c.status === 'Suspended').length, 'Suspended')}
        {k(money(Math.round(totMRR)), 'Monthly Revenue (MRR)')}
        {k(expg.length, 'Expiring in 30 Days')}
      </div>
      <div className="kpi-bar">
        {k(money(A.sales), 'Total Sales Handled by Clients')}
        {k(A.sos, 'Sales Orders (all clients)')}
        {k(A.prj, 'Projects (all clients)')}
        {k(A.ongoing, 'Ongoing Projects')}
        {k(A.svc, 'Service Calls')}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Quick Links</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm sec" onClick={() => navigate('/admin/companies')}>🏢 Companies</button>
          <button className="btn sm sec" onClick={() => navigate('/admin/usage')}>📈 Client Business</button>
          <button className="btn sm sec" onClick={() => navigate('/admin/revenue')}>💵 Revenue</button>
          <button className="btn sm sec" onClick={() => navigate('/admin/expiring')}>⏳ Expiring Soon</button>
          <button className="btn sm sec" onClick={() => navigate('/admin/locations')}>📍 Locations</button>
          <button className="btn sm sec" onClick={() => navigate('/reports')}>📊 Reports</button>
        </div>
      </div>
      {expg.length > 0 && (
        <div className="panel" style={{ marginTop: 16, borderColor: '#f3c1c1' }}>
          <h3>⚠️ Needs Attention — expiring within 30 days</h3>
          
            <table className="data-table">
              <thead><tr><th>Company</th><th>Type</th><th>Expiry</th></tr></thead>
              <tbody>
                {expg.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b> · {c.city}</td>
                    <td><span className={`badge ${c.status === 'Trial' ? 'b-amb' : 'b-red'}`}>{c.status === 'Trial' ? 'Trial' : 'Subscription'}</span></td>
                    <td className="due">{fmtDate(c.status === 'Trial' ? c.trialEnd : c.subscriptionEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => navigate('/admin/expiring')}>View all →</button></div>
        </div>
      )}
    </div>
  );
}

/* ── Shared bits ── */
function Kpi({ value, label, onClick, danger }) {
  return (
    <div className="kpi-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="kpi-value" style={danger ? { color: '#e53935' } : undefined}>{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function Panel({ title, action, children, alert }) {
  return (
    <div className="panel" style={{ marginTop: 16, ...(alert ? { borderColor: '#f3c1c1' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ── Inventory Dashboard — PWA invDash() (index.html:2853-2880) ── */
function InventoryDash() {
  const [dash, setDash] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/api/inventory/dashboard'),
      api.get('/api/inventory/issues?returnRequested=1').catch(() => ({ issues: [] })),
    ]).then(([d, r]) => { setDash(d.dashboard); setRequests(r.issues || []); })
      .catch(err => setError(err.message));
  }, []);

  if (error) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!dash) return <div className="enq-page"><p className="muted">Loading...</p></div>;

  return (
    <div className="enq-page">
      <h2>Dashboard</h2>
      <div className="kpi-bar">
        <Kpi value={dash.totalItems} label="Total Items" onClick={() => navigate('/inventory/stock')} />
        <Kpi value={dash.categories} label="Categories" />
        <Kpi value={money(dash.stockValue)} label="Stock Value" />
        <Kpi value={dash.lowStock} label="Low Stock" danger={dash.lowStock > 0} />
        <Kpi value={dash.outOfStock} label="Out of Stock" danger={dash.outOfStock > 0} />
        <Kpi value={dash.materialWithStaff} label="Material With Staff" />
        <Kpi value={dash.returnRequests} label="Return Requests" danger={dash.returnRequests > 0} />
      </div>
      {requests.length > 0 && (
        <Panel title="📥 Return Requests from Staff" alert action={<button className="btn sm sec" onClick={() => navigate('/inventory/returns')}>Open returns →</button>}>
          <table className="data-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Staff</th><th>Site</th><th>Requested</th></tr></thead>
            <tbody>
              {requests.map(x => (
                <tr key={x.id}><td><b>{x.itemName}</b></td><td>{x.requestedQuantity || x.balance} {x.unit}</td><td>{x.staffName}</td><td>{x.site}</td><td>{fmtDate(x.requestedDate)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <Panel title="Quick Actions">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/inventory/stock')}>+ Add Item</button>
          <button className="btn sec" onClick={() => navigate('/inventory/issue')}>📤 Issue Material</button>
          <button className="btn sec" onClick={() => navigate('/inventory/returns')}>📥 Material Returns</button>
          <button className="btn sec" onClick={() => navigate('/inventory/transfer')}>🔄 Transfer Stock</button>
          <button className="btn sec" onClick={() => navigate('/inventory/categories')}>🗂 Categories</button>
          <button className="btn sec" onClick={() => navigate('/inventory/history')}>🧾 Transactions</button>
        </div>
      </Panel>
      <LowStockPanel rows={dash.lowStockList || []} />
    </div>
  );
}

function LowStockPanel({ rows }) {
  const navigate = useNavigate();
  if (!rows.length) return null;
  return (
    <Panel title="⚠ Low / Out of Stock" alert action={<button className="btn sm sec" onClick={() => navigate('/inventory/stock')}>Open stock →</button>}>
      <table className="data-table">
        <thead><tr><th>Code</th><th>Item</th><th>Category</th><th>In Stock</th><th>Min Level</th><th>Shortfall</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(i => (
            <tr key={i.id} style={i.level === 2 ? { background: '#fdf6f6' } : undefined}>
              <td>{i.code}</td><td><b>{i.name}</b></td><td>{i.category}</td>
              <td style={{ color: '#e53935' }}>{i.inStock} {i.unit}</td><td>{i.min || '-'}</td>
              <td style={{ color: '#e53935' }}>{i.shortfall}</td><td>{i.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* ── Engineer / Service Engineer Dashboard — PWA engDash() (index.html:1633-1659) ── */
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
      api.get('/api/service-calls/mine').catch(() => ({ serviceCalls: [] })),
      api.get('/api/inventory/my-material').catch(() => ({ issues: [] })),
    ]).then(([p, s, m]) => {
      const myId = String(user?.id || '');
      setProjects((p.projects || []).filter(x =>
        (x.assignedEngineerIds || []).map(String).includes(myId) && x.status !== 'Completed'));
      setServiceCalls(s.serviceCalls || []);
      setMaterial((m.issues || []).filter(x => (Number(x.balance) || 0) > 0));
    }).finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="enq-page">
      <h2>{user?.role === 'service_eng' ? 'My Service Jobs' : 'My Work'}</h2>
      <div className="kpi-bar">
        <Kpi value={projects.length} label="My Projects" />
        <Kpi value={serviceCalls.length} label="My Service Calls" />
      </div>

      <Panel title="🏗️ My Assigned Projects">
        {projects.length === 0 ? <p className="muted">No active projects assigned.</p> : (
          <table className="data-table">
            <thead><tr><th>Project</th><th>Division</th><th>Stage</th><th>Checklist</th><th>Next Action</th><th>Next Action Date</th><th>Material to Return</th></tr></thead>
            <tbody>
              {projects.map(p => {
                const ups = p.executionUpdates || [];
                const lu = ups[ups.length - 1];
                const nd = lu?.nextActionDate ? fmtDate(lu.nextActionDate) : '';
                const over = nd && nd <= today;
                const pr = (p.deliveryChallans || []).filter(x => x.returnable)
                  .reduce((a, b) => a + ((Number(b.quantity) || 0) - (Number(b.returnedQuantity) || 0)), 0);
                const done = (p.checklist || []).filter(c => c.done).length;
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>{p.name}</td><td>{p.division}</td><td>{p.stage}</td>
                    <td>{done}/{(p.checklist || []).length}</td><td>{lu?.nextAction || ''}</td>
                    <td style={over ? { color: '#e53935' } : undefined}>{nd || '-'}{over ? ' ⚠' : ''}</td>
                    <td style={pr > 0 ? { color: '#e53935' } : undefined}>{pr > 0 ? pr : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="🛠️ My Service Calls / PM Jobs">
        {serviceCalls.length === 0 ? <p className="muted">No open service calls assigned.</p> : (
          <table className="data-table">
            <thead><tr><th>PSC No</th><th>Type</th><th>Customer</th><th>Site</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {serviceCalls.map(s => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/service-calls/${s.id}`)}>
                  <td><b>PSC-{s.complaintNumber}</b></td><td>{s.type}</td><td>{s.customer}</td><td>{s.site}</td>
                  <td>{s.appointmentDate ? fmtDate(s.appointmentDate) : '-'}</td><td>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="📦 My Material" alert={material.length > 0}
        action={<button className="btn sm sec" onClick={() => navigate('/my-material')}>Open →</button>}>
        {material.length === 0 ? <p className="muted">No returnable material pending with you.</p> : (
          <table className="data-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Site</th><th>Issued On</th></tr></thead>
            <tbody>
              {material.map(x => (
                <tr key={x.id}><td><b>{x.itemName}</b></td><td style={{ color: '#e53935' }}>{x.balance} {x.unit}</td><td>{x.site}</td><td>{fmtDate(x.date)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ── Main Dashboard — PWA vDash() for admin/sales/PM/service_mgr/finance ── */
function MainDash({ user }) {
  const [dash, setDash] = useState(null);
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get('/api/dashboard').then(d => setDash(d.dashboard)).catch(err => setError(err.message));
    if (user?.role === 'admin') {
      api.get('/api/inventory/dashboard').then(d => setInv(d.dashboard)).catch(() => {});
    }
  }, [user?.role]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!dash) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  const P = dash.panels || {};

  return (
    <div className="enq-page">
      <h2>Dashboard</h2>
      <div className="kpi-bar">
        {dash.kpis.map(k => <Kpi key={k.label} value={k.money ? money(k.value) : k.value} label={k.label} />)}
      </div>

      {P.delayed && P.delayed.length > 0 && (
        <Panel title="⚠ Delayed Projects" alert>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Project</th><th>Division</th><th>Overdue Points</th><th>Max Delay</th><th>Target End</th></tr></thead>
              <tbody>
                {P.delayed.map(r => (
                  <tr key={r.projectId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${r.projectId}`)}>
                    <td><b>{r.name}</b>{r.orderNumber ? <div className="muted">SO-{r.orderNumber}</div> : null}</td>
                    <td>{r.division}</td><td style={{ color: '#e53935' }}>{r.overduePoints}</td>
                    <td style={{ color: '#e53935' }}>{r.maxDelayDays} days</td><td>{r.targetEnd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {P.segments && (
        <Panel title="📊 Segment-wise Enquiries">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Segment</th><th>Total Enq.</th><th>Total Value</th><th>Open</th><th>Open Value</th><th>Won</th><th>Won Value</th><th>Lost</th><th>Lost Value</th></tr></thead>
              <tbody>
                {P.segments.map(s => (
                  <tr key={s.segment} style={{ cursor: 'pointer' }} onClick={() => navigate(`/enquiries?segment=${encodeURIComponent(s.segment)}`)}>
                    <td>{s.segment}</td><td>{s.t}</td><td>{money(s.tv) || '-'}</td><td>{s.o}</td><td>{money(s.ov) || '-'}</td>
                    <td>{s.w}</td><td>{money(s.wv) || '-'}</td><td>{s.l}</td><td>{money(s.lv) || '-'}</td>
                  </tr>
                ))}
                {(() => {
                  const T = P.segments.reduce((a, s) => { ['t', 'tv', 'o', 'ov', 'w', 'wv', 'l', 'lv'].forEach(f => { a[f] += s[f]; }); return a; },
                    { t: 0, tv: 0, o: 0, ov: 0, w: 0, wv: 0, l: 0, lv: 0 });
                  return (
                    <tr style={{ fontWeight: 800, background: '#f7f9fb' }}>
                      <td>TOTAL</td><td>{T.t}</td><td>{money(T.tv) || '-'}</td><td>{T.o}</td><td>{money(T.ov) || '-'}</td>
                      <td>{T.w}</td><td>{money(T.wv) || '-'}</td><td>{T.l}</td><td>{money(T.lv) || '-'}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <p className="muted">Click a segment row to open its enquiry list.</p>
        </Panel>
      )}

      {P.salesOrders && (
        <Panel title="🏗️ Sales Orders — Live Project Status">
          {P.salesOrders.length === 0 ? <p className="muted">No sales orders yet.</p> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>SO No</th><th>Project</th><th>Division</th><th>Project Stage</th><th>Engineer</th><th>Checklist</th><th>Last Update</th><th>SO Value</th><th>Payment</th></tr></thead>
                <tbody>
                  {P.salesOrders.map(r => (
                    <tr key={r.salesOrderId} style={{ cursor: 'pointer' }}
                      onClick={() => navigate(r.projectId ? `/projects/${r.projectId}` : `/sales-orders/${r.salesOrderId}`)}>
                      <td><b>{r.orderNumber}</b></td><td>{r.projectName}</td><td>{r.division}</td><td>{r.stage}</td>
                      <td>{r.engineers.join(', ') || '—'}</td>
                      <td>{r.checklistTotal != null ? `${r.checklistDone}/${r.checklistTotal}` : '-'}</td>
                      <td>{r.lastUpdate ? `${r.lastUpdate.actionDone} (${r.lastUpdate.date})` : '-'}</td>
                      <td>{money(r.soValue)}</td>
                      <td><span style={{ color: 'green' }}>{money(r.received)}</span>{r.pending ? <> / <span style={{ color: '#e53935' }}>{money(r.pending)} due</span></> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {P.followups && (
        <Panel title="⏰ Follow-ups due today">
          {P.followups.length === 0 ? <p className="muted">No follow-ups due. Great job!</p> : (
            <table className="data-table">
              <thead><tr><th>Enquiry</th><th>Segment</th><th>Next Action</th><th>Due</th></tr></thead>
              <tbody>
                {P.followups.map(r => (
                  <tr key={r.enquiryId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/enquiries/${r.enquiryId}`)}>
                    <td>{r.name}</td><td>{r.segment}</td><td>{r.nextAction}</td><td style={{ color: '#e53935' }}>{r.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {user.role === 'admin' && inv && (
        <>
          <div className="kpi-bar" style={{ marginTop: 16 }}>
            <Kpi value={inv.totalItems} label="Inventory Items" />
            <Kpi value={money(inv.stockValue)} label="Stock Value" />
            <Kpi value={inv.lowStock + inv.outOfStock} label="Low / Out of Stock" danger={inv.lowStock + inv.outOfStock > 0} />
            <Kpi value={inv.materialWithStaff} label="Material With Staff" />
          </div>
          <LowStockPanel rows={inv.lowStockList || []} />
        </>
      )}

      {P.projects && (
        <Panel title={`🏗️ Ongoing ${P.projects.division || ''} Projects`}>
          {P.projects.rows.length === 0 ? <p className="muted">No ongoing projects.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>SO</th><th>Project</th><th>Stage</th><th>Engineer</th><th>Checklist</th><th>Timeline</th><th>Target End</th><th>Delay</th><th>Next Action</th><th>Next Action Date</th><th>Received</th><th>Pending</th><th>Next Milestone Due</th></tr></thead>
                <tbody>
                  {P.projects.rows.map(r => (
                    <tr key={r.projectId} style={{ cursor: 'pointer', ...(r.overduePoints ? { background: '#fdf6f6' } : {}) }}
                      onClick={() => navigate(`/projects/${r.projectId}`)}>
                      <td>{r.orderNumber || '-'}</td><td><b>{r.name}</b></td><td>{r.stage}</td><td>{r.engineers.join(', ') || '—'}</td>
                      <td>{r.checklistDone}/{r.checklistTotal}</td><td>{r.timelineSet ? 'Set' : 'Not set'}</td><td>{r.targetEnd || '-'}</td>
                      <td style={r.overduePoints ? { color: '#e53935' } : undefined}>{r.overduePoints ? `${r.overduePoints} overdue ⚠` : (r.timelineSet ? 'On track' : '-')}</td>
                      <td>{r.nextAction}</td>
                      <td style={r.nextActionOverdue ? { color: '#e53935' } : undefined}>{r.nextActionDate || '-'}</td>
                      <td>{r.pay ? money(r.pay.received) : '-'}</td><td>{r.pay ? money(r.pay.pending) : '-'}</td>
                      <td>{r.pay && r.pay.nextMilestone ? `${r.pay.nextMilestone.description} — ${money(r.pay.nextMilestone.amount)}` : '-'}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 800, background: '#f7f9fb' }}>
                    <td colSpan={10}>TOTAL</td><td>{money(P.projects.totalReceived)}</td><td>{money(P.projects.totalPending)}</td><td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {P.pmDue && (
        <Panel title={`🔁 PM Due — ${new Date().toLocaleString('en', { month: 'long', year: 'numeric' })} (incl. overdue)`}>
          {P.pmDue.length === 0 ? <p className="muted">No PM due. All caught up!</p> : (
            <table className="data-table">
              <thead><tr><th>Site</th><th>Customer</th><th>Phone</th><th>Type</th><th>Service Due (month)</th><th></th></tr></thead>
              <tbody>
                {P.pmDue.map(r => (
                  <tr key={`${r.contractId}-${r.visitIndex}`}>
                    <td><b>{r.site}</b></td><td>{r.customer}</td><td>{r.phone}</td><td>{r.category}</td>
                    <td style={r.overdue ? { color: '#e53935' } : undefined}>{r.month}{r.overdue ? ' (overdue)' : ''}</td>
                    <td><button className="btn sm" onClick={() => navigate(`/service-calls/new?contractId=${r.contractId}`)}>Schedule PM</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {P.openCalls && (
        <Panel title="🛠️ Open Service Calls" action={<button className="btn sm" onClick={() => navigate('/service-calls/new')}>+ Register Complaint</button>}>
          {P.openCalls.length === 0 ? <p className="muted">No open calls.</p> : (
            <table className="data-table">
              <thead><tr><th>PSC</th><th>Type</th><th>Customer</th><th>Site</th><th>Engineer</th><th>Status</th></tr></thead>
              <tbody>
                {P.openCalls.map(r => (
                  <tr key={r.serviceCallId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/service-calls/${r.serviceCallId}`)}>
                    <td><b>PSC-{r.complaintNumber}</b></td><td>{r.type}</td><td>{r.customer}</td><td>{r.site}</td><td>{r.engineer || '—'}</td><td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {P.payments && (
        <Panel title="💰 Pending Payments" action={<span className="muted">Billed: {money(P.payments.billed)} · Part received: {money(P.payments.partReceived)} · Balance: {money(P.payments.balance)}</span>}>
          {P.payments.rows.length === 0 ? <p className="muted">Nothing pending. Excellent!</p> : (
            <>
              {P.payments.rows.some(r => r.raised) && (
                <div className="panel" style={{ borderColor: '#f3c1c1', background: '#fdf6f6' }}>
                  <b>📤 {P.payments.rows.filter(r => r.raised).length} milestone(s) raised by project managers — collection requested:</b>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {P.payments.rows.filter(r => r.raised).map(r => (
                      <li key={r.paymentId}>
                        {r.raised.priority === 'Urgent' && <b style={{ color: '#e53935' }}>URGENT · </b>}
                        {r.project} — <b>{money(r.balance)}</b> · raised by {r.raised.by} on {r.raised.date} · collect by {r.raised.collectBy || '-'}
                        <br /><span className="muted">{r.raised.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <table className="data-table">
                <thead><tr><th>Project</th><th>Person</th><th>Phone</th><th>Amount</th><th>Received</th><th>Balance</th><th>Next Call</th></tr></thead>
                <tbody>
                  {P.payments.rows.map(r => (
                    <tr key={r.paymentId} style={{ cursor: 'pointer' }} onClick={() => navigate('/payments')}>
                      <td>{r.project}</td><td>{r.person}</td><td>{r.phone}</td><td>{money(r.amount)}</td>
                      <td>{money(r.received) || '-'}</td><td style={{ color: '#e53935' }}>{money(r.balance)}</td><td>{r.nextCallDate || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
