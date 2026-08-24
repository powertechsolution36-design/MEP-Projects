import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getRoleLabel, ROLE_MODULES } from '../utils/responsibilities';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/projects', label: 'Projects', icon: '🏗️' },
  { to: '/service-calls', label: 'Service Calls', icon: '🔧' },
  { to: '/contracts', label: 'Contracts', icon: '📄' },
  { to: '/payments', label: 'Payments', icon: '💰' },
  { to: '/enquiries', label: 'Enquiries', icon: '📞' },
  { to: '/sales-orders', label: 'Sales Orders', icon: '🛒' },
  { to: '/inventory', label: 'Inventory', icon: '📦' },
  { to: '/checklists', label: 'Checklists', icon: '✅' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/users', label: 'Users', icon: '👥' },
  { to: '/companies', label: 'Companies', icon: '🏢' },
];

export default function Shell({ children }) {
  const user = useStore(s => s.user);
  const company = useStore(s => s.company);
  const companies = useStore(s => s.companies);
  const connected = useStore(s => s.connected);
  const notifications = useStore(s => s.notifications);
  const scopedCompany = useStore(s => s.scopedCompany);
  const setScopedCompany = useStore(s => s.setScopedCompany);
  const logout = useStore(s => s.logout);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const unread = notifications.filter(n => !n.isRead).length;

  const allowed = ROLE_MODULES[user.role] || [];
  const visibleNav = NAV.filter(n => allowed.includes(n.to));
  const isSuper = user.role === 'super';
  const currentCoName = scopedCompany ? (companies.find(c => String(c._id) === String(scopedCompany))?.name || 'Unknown') : 'All Companies';

  function handleLogout(e) { e?.preventDefault(); logout(); nav('/'); }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-text"><em>MEP</em> PROJECTS</span>
          <div className="sidebar-company">
            {company ? company.name : (isSuper ? (scopedCompany ? currentCoName : 'All Companies') : '')}
          </div>
        </div>
        <nav className="sidebar-nav">
          {visibleNav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status-dot ${connected ? 'on' : 'off'}`}></span>
            {connected ? 'Online' : 'Offline'}
          </div>
          <b className="sidebar-user">{user.name}</b>
          <span className="sidebar-role">{getRoleLabel(user.role)}</span>
          <br />
          <a href="#" className="sidebar-signout" onClick={handleLogout}>Sign out</a>
        </div>
      </aside>
      <main className="main">
        <div className="main-header">
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <button className="mobile-menu-btn" onClick={() => setOpen(!open)}>☰</button>
            <div className="brand-header">
              <span className="brand-logo-wrap">
                <img src="/icons/icon-192.png" alt="MEP" className="brand-logo" />
              </span>
              <span className="brand-red">MEP</span> <span>PROJECTS</span>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            {isSuper && (
              <select className="co-picker" value={scopedCompany || ''} onChange={e => setScopedCompany(e.target.value || null)}>
                <option value="">All Companies</option>
                {companies.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            )}
            <NavLink to="/notifications" style={{position: 'relative', textDecoration: 'none', fontSize: 20}}>
              🔔
              {unread > 0 && <span style={{position: 'absolute', top: -4, right: -6, background: 'var(--red)', color: '#fff', fontSize: 10, borderRadius: 10, padding: '2px 6px', fontWeight: 700}}>{unread}</span>}
            </NavLink>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
