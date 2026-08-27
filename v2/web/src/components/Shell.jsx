import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getRoleLabel } from '../utils/responsibilities';
import { orgLabel } from '../utils/orgModel';

/**
 * Role → flat menu list. Mirrors the old MENUS[U.role] mapping 1:1.
 * Each item = { to, label, icon }. No nesting.
 */
const MENUS = {
  super: [
    { to: '/', label: 'Dashboard', icon: '🏠', end: true },
    { section: 'Companies', icon: '🏢', children: [
      { to: '/companies?action=new', label: 'Create company', icon: '＋' },
      { to: '/companies?view=status', label: 'Manage company status', icon: '🚦' },
      { to: '/companies?view=divisions', label: 'Manage divisions', icon: '🔀' },
      { to: '/companies?view=subscription', label: 'Subscription information', icon: '💳' },
      { to: '/companies', label: 'Company overview', icon: '📋' },
    ]},
    { section: 'Platform Usage', icon: '📈', children: [
      { to: '/analytics', label: 'Client business', icon: '📈', end: true },
      { to: '/analytics?view=stats', label: 'Usage statistics', icon: '📊' },
      { to: '/analytics?view=activity', label: 'Company activity', icon: '📋' },
    ]},
    { section: 'Platform Revenue', icon: '💵', children: [
      { to: '/analytics/revenue', label: 'Monthly revenue', icon: '📆' },
      { to: '/analytics/revenue?view=yearly', label: 'Yearly revenue', icon: '📅' },
      { to: '/analytics/revenue?view=collected', label: 'Collected revenue', icon: '💰' },
    ]},
    { section: 'Subscription Management', icon: '⏳', children: [
      { to: '/analytics/expiring', label: 'Expiring companies', icon: '⏳' },
    ]},
    { section: 'Geographic Analysis', icon: '📍', children: [
      { to: '/analytics/locations', label: 'Client locations', icon: '📍' },
    ]},
    { section: 'Reports', icon: '📊', children: [
      { to: '/reports?type=revenue', label: 'Revenue', icon: '💵' },
      { to: '/reports?type=subscribers', label: 'Subscriber reports', icon: '👥' },
    ]},
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
          {menu.map((item, i) => item.section ? (
            <div key={`sec-${i}`}>
              <div className="menu-section"><span>{item.icon}</span><span>{item.section}</span></div>
              {item.children.map(child => (
                <NavLink
                  key={child.to + child.label}
                  to={child.to}
                  end={child.end}
                  className={({ isActive }) => `sub ${isActive ? 'on' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <span>{child.icon}</span>
                  <span>{child.label}</span>
                </NavLink>
              ))}
            </div>
          ) : (
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
          <span>{orgLabel(user)}</span>
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
