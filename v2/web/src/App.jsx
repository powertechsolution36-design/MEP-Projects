import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ServiceCalls from './pages/ServiceCalls';
import Users from './pages/Users';
import Contracts from './pages/Contracts';
import Payments from './pages/Payments';
import Enquiries from './pages/Enquiries';
import SalesOrders from './pages/SalesOrders';
import Inventory from './pages/Inventory';
import Checklists from './pages/Checklists';
import Notifications from './pages/Notifications';
import Companies from './pages/Companies';
import Reports from './pages/Reports';
import LostEnquiries from './pages/LostEnquiries';
import SuperAnalytics from './pages/SuperAnalytics';
import Toast from './components/Toast';

export default function App() {
  const user = useStore(s => s.user);
  const restoreSession = useStore(s => s.restoreSession);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    restoreSession().finally(() => setBooted(true));
  }, [restoreSession]);

  if (!booted) return <div className="login-shell"><div className="spinner" /></div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/*" element={<Projects />} />
        <Route path="/service-calls/*" element={<ServiceCalls />} />
        <Route path="/contracts/*" element={<Contracts />} />
        <Route path="/payments/*" element={<Payments />} />
        <Route path="/enquiries/*" element={<Enquiries />} />
        <Route path="/sales-orders/*" element={<SalesOrders />} />
        <Route path="/inventory/*" element={<Inventory />} />
        <Route path="/checklists/*" element={<Checklists />} />
        <Route path="/users/*" element={<Users />} />
        <Route path="/companies/*" element={<Companies />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/lost-enquiries" element={<LostEnquiries />} />
        <Route path="/analytics/*" element={<SuperAnalytics />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toast />
    </Shell>
  );
}
