import { useStore } from '../store/useStore';
import { DonutChart, BarChart, LineChart } from '../components/Charts';
import ReportDownload from '../components/ReportDownload';
import ResponsibilitiesCard from '../components/ResponsibilitiesCard';
import { ROLE_DASHBOARD, ROLE_MODULES } from '../utils/responsibilities';

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

const STATUS_COLORS = { active: '#1d9e5f', planning: '#d98a00', onhold: '#2563c9', completed: '#6b7a8c', cancelled: '#d92b2b' };
const CALL_COLORS = { open: '#d98a00', assigned: '#2563c9', inprogress: '#7c3aed', onhold: '#6b7a8c', closed: '#1d9e5f' };

// Which stat cards to show for each role
const STAT_DEFS = {
  companies: (s) => ({ label: 'Companies', value: s.companies.length, color: '#0891b2', icon: '🏢' }),
  users: (s) => ({ label: 'Users', value: s.users.length, color: '#7c3aed', icon: '👥' }),
  projects: (s) => ({ label: 'Projects', value: s.projects.length, color: '#d92b2b', icon: '🏗️' }),
  projectsActive: (s) => ({ label: 'Active Projects', value: s.projects.filter(p => p.status === 'active').length, color: '#1d9e5f', icon: '🟢' }),
  projectsPlanning: (s) => ({ label: 'Planning', value: s.projects.filter(p => p.status === 'planning').length, color: '#d98a00', icon: '📋' }),
  projectsCompleted: (s) => ({ label: 'Completed', value: s.projects.filter(p => p.status === 'completed').length, color: '#6b7a8c', icon: '✅' }),
  serviceCalls: (s) => ({ label: 'Open Service Calls', value: s.serviceCalls.filter(c => c.status !== 'closed').length, color: '#d98a00', icon: '🔧' }),
  contracts: (s) => ({ label: 'Active Contracts', value: s.contracts.filter(c => c.status === 'active').length, color: '#2563c9', icon: '📄' }),
  payments: (s) => ({ label: 'Pending Payments', value: '₹' + s.payments.filter(p => p.status !== 'paid').reduce((sum, p) => sum + (p.amount || 0), 0).toLocaleString(), color: '#1d9e5f', icon: '💰' }),
  paymentsPending: (s) => ({ label: 'Pending', value: s.payments.filter(p => p.status === 'pending').length, color: '#d98a00', icon: '⏳' }),
  paymentsPaid: (s) => ({ label: 'Paid', value: s.payments.filter(p => p.status === 'paid').length, color: '#1d9e5f', icon: '✔️' }),
  enquiries: (s) => ({ label: 'Enquiries', value: s.enquiries.length, color: '#7c3aed', icon: '📞' }),
  enquiriesNew: (s) => ({ label: 'New Enquiries', value: s.enquiries.filter(e => e.status === 'new').length, color: '#0891b2', icon: '🆕' }),
  salesOrders: (s) => ({ label: 'Sales Orders', value: s.salesOrders.length, color: '#2563c9', icon: '🛒' }),
  salesOrdersTotal: (s) => ({ label: 'Sales Total', value: '₹' + s.salesOrders.reduce((sum, o) => sum + (o.total || 0), 0).toLocaleString(), color: '#1d9e5f', icon: '💵' }),
  inventory: (s) => ({ label: 'Inventory Items', value: s.invItems.length, color: '#d98a00', icon: '📦' }),
  lowStock: (s) => ({ label: 'Low Stock Items', value: s.invItems.filter(i => (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0).length, color: '#d92b2b', icon: '⚠️' }),
  invIssues: (s) => ({ label: 'Open Issues', value: s.invIssues.filter(i => i.status !== 'returned').length, color: '#d98a00', icon: '📤' }),
  invValue: (s) => ({ label: 'Inventory Value', value: '₹' + s.invItems.reduce((sum, i) => sum + ((i.qty || 0) * (i.rate || 0)), 0).toLocaleString(), color: '#1d9e5f', icon: '💎' }),
  myProjects: (s) => ({ label: 'My Projects', value: s.projects.filter(p => p.engs?.includes(s.user?.name)).length, color: '#d92b2b', icon: '🏗️' }),
  myChecklistItems: (s) => {
    const myProjects = s.projects.filter(p => p.engs?.includes(s.user?.name));
    const pending = myProjects.reduce((sum, p) => sum + (p.chk?.filter(c => !c.done).length || 0), 0);
    return { label: 'My Pending Tasks', value: pending, color: '#d98a00', icon: '📝' };
  },
  myCallsOpen: (s) => ({ label: 'My Open Calls', value: s.serviceCalls.filter(c => c.eng === s.user?.name && c.status !== 'closed').length, color: '#d98a00', icon: '🔧' }),
  myCallsClosed: (s) => ({ label: 'My Closed Calls', value: s.serviceCalls.filter(c => c.eng === s.user?.name && c.status === 'closed').length, color: '#1d9e5f', icon: '✅' }),
  myCallsUrgent: (s) => ({ label: 'My Urgent Calls', value: s.serviceCalls.filter(c => c.eng === s.user?.name && c.priority === 'urgent' && c.status !== 'closed').length, color: '#d92b2b', icon: '🚨' }),
};

export default function Dashboard() {
  const s = useStore();
  const role = s.user?.role || 'viewer';
  const isSuper = role === 'super';

  const statKeys = ROLE_DASHBOARD[role] || [];
  const stats = statKeys.map(k => STAT_DEFS[k]?.(s)).filter(Boolean);

  const showCharts = ROLE_MODULES[role]?.includes('/reports') || isSuper;

  return (
    <div>
      <div className="main-header">
        <h2>Dashboard {isSuper && <span className="text-mut text-sm" style={{marginLeft: 10}}>(All Companies)</span>}</h2>
      <ReportDownload /></div>

      <ResponsibilitiesCard />

      {stats.length > 0 && (
        <div className="grid grid-3 mb-3">
          {stats.map((st, i) => <Stat key={i} {...st} />)}
        </div>
      )}

      {/* Role-specific charts */}
      {showCharts && (
        <RoleCharts role={role} s={s} />
      )}
    </div>
  );
}

function RoleCharts({ role, s }) {
  // Filter data relevant to this role
  const projects = role === 'engineer' ? s.projects.filter(p => p.engs?.includes(s.user?.name)) : s.projects;
  const serviceCalls = role === 'service_eng' ? s.serviceCalls.filter(c => c.eng === s.user?.name) : s.serviceCalls;

  const cards = [];

  if (['super', 'admin', 'mep_pm', 'hvac_pm', 'solar_pm', 'engineer', 'viewer'].includes(role)) {
    cards.push(
      <div key="p1" className="card">
        <DonutChart title="Projects by Status" data={countBy(projects, 'status').map(x => ({ ...x, color: STATUS_COLORS[x.label] }))} />
      </div>,
      <div key="p2" className="card">
        <BarChart title="Projects by Division" data={countBy(projects, 'div')} />
      </div>
    );
  }

  if (['super', 'admin', 'service_eng', 'viewer'].includes(role)) {
    cards.push(
      <div key="c1" className="card">
        <DonutChart title="Service Calls by Status" data={countBy(serviceCalls, 'status').map(x => ({ ...x, color: CALL_COLORS[x.label] }))} />
      </div>,
      <div key="c2" className="card">
        <DonutChart title="Service Calls by Priority" data={countBy(serviceCalls, 'priority')} />
      </div>
    );
  }

  if (['super', 'admin', 'sales'].includes(role)) {
    cards.push(
      <div key="e1" className="card">
        <BarChart title="Enquiries by Status" data={countBy(s.enquiries, 'status')} />
      </div>,
      <div key="e2" className="card">
        <BarChart title="Enquiries by Source" data={countBy(s.enquiries, 'source')} />
      </div>
    );
  }

  if (['super', 'admin', 'accounts'].includes(role)) {
    cards.push(
      <div key="pay1" className="card">
        <DonutChart title="Payments by Status" data={countBy(s.payments, 'status')} />
      </div>
    );
  }

  if (['super', 'admin', 'store'].includes(role)) {
    cards.push(
      <div key="inv1" className="card">
        <BarChart title="Inventory Issues by Status" data={countBy(s.invIssues, 'status')} />
      </div>
    );
  }

  if (cards.length === 0) return null;

  return <div className="grid grid-2">{cards}</div>;
}
