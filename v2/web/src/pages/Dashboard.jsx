import { useStore } from '../store/useStore';

function Stat({ label, value, color }) {
  return (
    <div className="card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="text-mut text-sm">{label}</div>
      <div className="text-xl" style={{ fontSize: 28, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const s = useStore();
  const activeProjects = s.projects.filter(p => p.status === 'active').length;
  const openCalls = s.serviceCalls.filter(c => c.status !== 'closed').length;
  const activeContracts = s.contracts.filter(c => c.status === 'active').length;
  const pendingPayments = s.payments.filter(p => p.status !== 'paid').reduce((sum, p) => sum + (p.amount || 0), 0);
  return (
    <div>
      <div className="main-header"><h2>Dashboard</h2></div>
      <div className="grid grid-3">
        <Stat label="Active Projects" value={activeProjects} color="var(--red)" />
        <Stat label="Open Service Calls" value={openCalls} color="var(--amber)" />
        <Stat label="Active Contracts" value={activeContracts} color="var(--blue)" />
        <Stat label="Pending Payments (₹)" value={pendingPayments.toLocaleString()} color="var(--green)" />
        <Stat label="Users" value={s.users.length} color="var(--dark2)" />
        <Stat label="Enquiries (New)" value={s.enquiries.filter(e => e.status === 'new').length} color="var(--amber)" />
      </div>
    </div>
  );
}
