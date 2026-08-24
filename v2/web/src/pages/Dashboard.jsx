import { useStore } from '../store/useStore';
import { DonutChart, BarChart, LineChart } from '../components/Charts';
import ResponsibilitiesCard from '../components/ResponsibilitiesCard';

function Stat({ label, value, color, icon }) {
  return (
    <div className="stat-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="text-mut text-sm">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

function countBy(arr, key) {
  const map = {};
  arr.forEach(x => { const k = x[key] || 'unknown'; map[k] = (map[k] || 0) + 1; });
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

function monthlyPayments(payments) {
  const map = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = d.toLocaleString('en', { month: 'short' });
    map[k] = 0;
  }
  payments.forEach(p => {
    if (!p.paid || !p.paid.length) return;
    p.paid.forEach(pp => {
      const d = new Date(pp.at);
      const k = d.toLocaleString('en', { month: 'short' });
      if (k in map) map[k] += pp.amt || 0;
    });
  });
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

const STATUS_COLORS = { active: '#1d9e5f', planning: '#d98a00', onhold: '#2563c9', completed: '#6b7a8c', cancelled: '#d92b2b' };
const CALL_COLORS = { open: '#d98a00', assigned: '#2563c9', inprogress: '#7c3aed', onhold: '#6b7a8c', closed: '#1d9e5f' };

function CompanySection({ company, projects, serviceCalls, contracts, payments, enquiries, users }) {
  const active = projects.filter(p => p.status === 'active').length;
  const openCalls = serviceCalls.filter(c => c.status !== 'closed').length;
  const pending = payments.filter(p => p.status !== 'paid').reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div className="card mt-2">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--line)', paddingBottom: 10}}>
        <h3 style={{fontSize: 18, fontWeight: 700}}>🏢 {company.name}</h3>
        <span className="text-mut text-sm">{company.code || '—'}</span>
      </div>
      <div className="grid grid-3 mb-2">
        <Stat label="Projects (active)" value={active} color="#d92b2b" icon="🏗️" />
        <Stat label="Open Calls" value={openCalls} color="#d98a00" icon="🔧" />
        <Stat label="Users" value={users.length} color="#7c3aed" icon="👥" />
        <Stat label="Pending ₹" value={pending.toLocaleString()} color="#1d9e5f" icon="💰" />
      </div>
      <div className="grid grid-2">
        <DonutChart
          title="Projects by Status"
          data={countBy(projects, 'status').map(x => ({ ...x, color: STATUS_COLORS[x.label] }))}
        />
        <DonutChart
          title="Calls by Status"
          data={countBy(serviceCalls, 'status').map(x => ({ ...x, color: CALL_COLORS[x.label] }))}
        />
        <BarChart title="Projects by Division" data={countBy(projects, 'div')} />
        <BarChart title="Enquiries by Status" data={countBy(enquiries, 'status')} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const s = useStore();

  // Totals (across all companies for super, or single company for others)
  const activeProjects = s.projects.filter(p => p.status === 'active').length;
  const openCalls = s.serviceCalls.filter(c => c.status !== 'closed').length;
  const activeContracts = s.contracts.filter(c => c.status === 'active').length;
  const pendingAmount = s.payments.filter(p => p.status !== 'paid').reduce((sum, p) => sum + (p.amount || 0), 0);

  const isSuper = s.user?.role === 'super';

  return (
    <div>
      <div className="main-header">
        <h2>Dashboard {isSuper && <span className="text-mut text-sm" style={{marginLeft: 10}}>(All Companies)</span>}</h2>
      </div>

      <ResponsibilitiesCard />

      <div className="grid grid-3 mb-3">
        <Stat label="Active Projects" value={activeProjects} color="#d92b2b" icon="🏗️" />
        <Stat label="Open Service Calls" value={openCalls} color="#d98a00" icon="🔧" />
        <Stat label="Active Contracts" value={activeContracts} color="#2563c9" icon="📄" />
        <Stat label="Pending Payments" value={`₹${pendingAmount.toLocaleString()}`} color="#1d9e5f" icon="💰" />
        <Stat label="Users" value={s.users.length} color="#7c3aed" icon="👥" />
        <Stat label="Companies" value={s.companies.length} color="#0891b2" icon="🏢" />
      </div>

      {/* Global aggregate charts */}
      <div className="grid grid-2">
        <div className="card">
          <DonutChart
            title="All Projects by Status"
            data={countBy(s.projects, 'status').map(x => ({ ...x, color: STATUS_COLORS[x.label] }))}
          />
        </div>
        <div className="card">
          <DonutChart
            title="All Service Calls by Status"
            data={countBy(s.serviceCalls, 'status').map(x => ({ ...x, color: CALL_COLORS[x.label] }))}
          />
        </div>
        <div className="card">
          <BarChart title="Projects by Division" data={countBy(s.projects, 'div')} />
        </div>
        <div className="card">
          <BarChart title="Enquiries by Status" data={countBy(s.enquiries, 'status')} />
        </div>
      </div>

      <div className="card mt-2">
        <LineChart title="Payments Collected (last 6 months, ₹)" data={monthlyPayments(s.payments)} />
      </div>

      {/* Per-company breakdown (super admin only) */}
      {isSuper && s.companies.length > 1 && (
        <div className="mt-3">
          <h2 style={{fontSize: 20, fontWeight: 700, marginBottom: 12}}>Per-Company Breakdown</h2>
          {s.companies.map(co => (
            <CompanySection
              key={co._id}
              company={co}
              projects={s.projects.filter(p => String(p.co) === String(co._id))}
              serviceCalls={s.serviceCalls.filter(c => String(c.co) === String(co._id))}
              contracts={s.contracts.filter(c => String(c.co) === String(co._id))}
              payments={s.payments.filter(p => String(p.co) === String(co._id))}
              enquiries={s.enquiries.filter(e => String(e.co) === String(co._id))}
              users={s.users.filter(u => String(u.co) === String(co._id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
