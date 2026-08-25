import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getRoleLabel } from '../utils/responsibilities';

/**
 * Role → flat menu list. Mirrors the old MENUS[U.role] mapping 1:1.
 * Each item = { to, label, icon }. No nesting.
 */
const MENUS = {
  super: [
    { to: '/',                    label: 'Dashboard',       icon: '🏠', end: true },
    { to: '/companies',           label: 'Companies',       icon: '🏢' },
    { to: '/analytics',           label: 'Client Business', icon: '📈', end: true },
    { to: '/analytics/revenue',   label: 'Revenue',         icon: '💵' },
    { to: '/analytics/expiring',  label: 'Expiring Soon',   icon: '⏳' },
    { to: '/analytics/locations', label: 'Locations',       icon: '📍' },
    { to: '/reports',             label: 'Reports',         icon: '📊' },
  ],
  admin: [
    { to: '/',                     label: 'Dashboard',        icon: '🏠', end: true },
    { to: '/enquiries',            label: 'Enquiries',        icon: '📋' },
    { to: '/sales-orders',         label: 'Sales Orders',     icon: '🧾' },
    { to: '/lost-enquiries',       label: 'Lost Enquiries',   icon: '❌' },
    { to: '/projects',             label: 'Projects',         icon: '🏗️' },
    { to: '/service-calls',        label: 'Service Calls',    icon: '🛠️' },
    { to: '/contracts',            label: 'AMC / PM List',    icon: '🔁' },
    { to: '/payments',             label: 'Payments',         icon: '💰' },
    { to: '/inventory/stock',      label: 'Stock',            icon: '📦' },
    { to: '/inventory/issue',      label: 'Issue Material',   icon: '📤' },
    { to: '/inventory/returns',    label: 'Material Returns', icon: '📥' },
    { to: '/inventory/transactions', label: 'Inventory Log',  icon: '🧾' },
    { to: '/users',                label: 'Users',            icon: '👥' },
    { to: '/checklists',           label: 'Checklists',       icon: '✅' },
  ],
  sales: [
    { to: '/',              label: 'Dashboard',      icon: '🏠', end: true },
    { to: '/enquiries',     label: 'Enquiries',      icon: '📋' },
    { to: '/sales-orders',  label: 'Sales Orders',   icon: '🧾' },
    { to: '/lost-enquiries',label: 'Lost Enquiries', icon: '❌' },
  ],
  hvac_pm: [
    { to: '/',                label: 'Dashboard',           icon: '🏠', end: true },
    { to: '/projects',        label: 'Projects',            icon: '🏗️' },
    { to: '/sales-orders',    label: 'Sales Orders',        icon: '🧾' },
    { to: '/inventory/stock', label: 'Stock',               icon: '📦' },
    { to: '/checklists',      label: 'Checklist Template',  icon: '✅' },
  ],
  solar_pm: [
    { to: '/',                label: 'Dashboard',           icon: '🏠', end: true },
    { to: '/projects',        label: 'Projects',            icon: '🏗️' },
    { to: '/sales-orders',    label: 'Sales Orders',        icon: '🧾' },
    { to: '/inventory/stock', label: 'Stock',               icon: '📦' },
    { to: '/checklists',      label: 'Checklist Template',  icon: '✅' },
  ],
  mep_pm: [
    { to: '/',              label: 'Dashboard',          icon: '🏠', end: true },
    { to: '/projects',      label: 'Projects',           icon: '🏗️' },
    { to: '/sales-orders',  label: 'Sales Orders',       icon: '🧾' },
    { to: '/checklists',    label: 'Checklist Template', icon: '✅' },
  ],
  engineer: [
    { to: '/',                 label: 'My Work',     icon: '🏠', end: true },
    { to: '/inventory/issue',  label: 'My Material', icon: '📦' },
  ],
  store: [ // Inventory Manager
    { to: '/inventory',            label: 'Dashboard',              icon: '🏠', end: true },
    { to: '/inventory/stock',      label: 'Stock',                  icon: '📦' },
    { to: '/inventory/issue',      label: 'Issue Material',         icon: '📤' },
    { to: '/inventory/returns',    label: 'Material Returns',       icon: '📥' },
    { to: '/inventory/transfer',   label: 'Stock Transfer',         icon: '🔄' },
    { to: '/inventory/categories', label: 'Categories & Locations', icon: '🗂' },
    { to: '/inventory/transactions', label: 'Transactions',         icon: '🧾' },
  ],
  service_mgr: [
    { to: '/',              label: 'Dashboard',      icon: '🏠', end: true },
    { to: '/service-calls', label: 'Service Calls',  icon: '🛠️' },
    { to: '/contracts',     label: 'AMC / PM List',  icon: '🔁' },
    { to: '/inventory/stock', label: 'Stock',        icon: '📦' },
  ],
  service_eng: [
    { to: '/',                label: 'My Service Jobs', icon: '🏠', end: true },
    { to: '/inventory/issue', label: 'My Material',     icon: '📦' },
  ],
  accounts: [ // Finance
    { to: '/',             label: 'Dashboard',         icon: '🏠', end: true },
    { to: '/payments',     label: 'Pending Payments',  icon: '💰' },
    { to: '/sales-orders', label: 'Sales Orders',      icon: '🧾' },
  ],
  viewer: [
    { to: '/',        label: 'Dashboard', icon: '🏠', end: true },
    { to: '/reports', label: 'Reports',   icon: '📊' },
  ],
};

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

  const menu = MENUS[user.role] || [];
  const isSuper = user.role === 'super';
  const currentCoName = scopedCompany ? (companies.find(c => String(c._id) === String(scopedCompany))?.name || 'Unknown') : 'All Companies';

  function handleLogout(e) { e?.preventDefault(); logout(); nav('/'); }

  return (
    <div className="app-shell">
      <div id="side" className={open ? 'open' : ''}>
        <div className="logo">
          <img src="/icons/icon-192.png" alt="" />
          <span><em>MEP</em> PROJECTS</span>
        </div>
        <div className="co">
          {company ? (
            <>
              {company.name}
              {company.divs?.length ? <><br/>Divisions: {company.divs.join(' · ')}</> : null}
            </>
          ) : (isSuper ? (scopedCompany ? currentCoName : 'All Companies') : '')}
        </div>
        <nav id="menu">
          {menu.map(item => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) => isActive ? 'on' : ''}
              onClick={() => setOpen(false)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="uinfo">
          <b>{user.name}</b>
          <span>{getRoleLabel(user.role)}</span>
          <br/>
          <a href="#" onClick={handleLogout}>Sign out</a>
        </div>
      </div>

      <div id="main">
        <div id="topbar">
          <button id="burger" onClick={() => setOpen(!open)}>☰</button>
          <h1></h1>
          {isSuper && companies.length > 0 && (
            <select className="co-picker" value={scopedCompany || ''} onChange={e => setScopedCompany(e.target.value || null)}>
              <option value="">All Companies</option>
              {companies.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          )}
          <NavLink to="/notifications" className="bell">
            🔔{unread > 0 && <i>{unread}</i>}
          </NavLink>
        </div>
        {children}
      </div>
    </div>
  );
}
