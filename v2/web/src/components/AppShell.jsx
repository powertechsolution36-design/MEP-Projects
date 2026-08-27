import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getRoleLabel } from '../utils/responsibilities';
import Shell from './Shell';
import { SUPER_ADMIN_MENU } from '../config/superAdminMenu';

/**
 * AppShell — replacement shell that reverts the Super Admin sidebar to the
 * flat "previous" version imported from ../config/superAdminMenu.
 *
 * For every non-super role it defers to the existing Shell component
 * unchanged (so admin/sales/store/service/etc. keep the current sidebar).
 *
 * The super branch is a re-implementation of Shell's layout — same DOM
 * structure and class names — so app.css styles apply identically.
 */
export default function AppShell({ children }) {
  const user = useStore(s => s.user);
  const company = useStore(s => s.company);
  const companies = useStore(s => s.companies);
  const notifications = useStore(s => s.notifications);
  const scopedCompany = useStore(s => s.scopedCompany);
  const setScopedCompany = useStore(s => s.setScopedCompany);
  const logout = useStore(s => s.logout);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const unread = notifications.filter(n => !n.isRead).length;

  // Non-super roles: use the existing Shell as-is.
  if (!user || user.role !== 'super') {
    return <Shell>{children}</Shell>;
  }

  // Super admin: render the flat sidebar from the config file.
  const menu = SUPER_ADMIN_MENU;
  const currentCoName = scopedCompany
    ? (companies.find(c => String(c._id) === String(scopedCompany))?.name || 'Unknown')
    : 'All Companies';

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
          ) : (scopedCompany ? currentCoName : 'All Companies')}
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
          {companies.length > 0 && (
            <select
              className="co-picker"
              value={scopedCompany || ''}
              onChange={e => setScopedCompany(e.target.value || null)}
            >
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
