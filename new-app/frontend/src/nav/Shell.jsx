import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { menuForRole, ROLE_LABELS } from './menuConfig';
import { api } from '../api/client';

/**
 * App shell: header + role-based side navigation + routed content.
 *
 * The navigation items shown come straight from menuConfig.js's per-role
 * PWA-traced menu (see that file). This is a UI convenience only — the
 * server remains the authority on what each role may actually do; hiding a
 * nav item here does not, by itself, protect the underlying route or API.
 *
 * PWA FACT: header bar contains a notification bell icon with unread count
 * badge. Clicking it navigates to the notifications page.
 */
export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const menu = menuForRole(user?.role);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.get('/api/notifications?limit=200');
      const list = data.notifications || [];
      const count = list.filter(n => !n.isRead).length;
      setUnreadCount(count);
    } catch {
      /* silent — header badge is best-effort */
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    /* Poll every 60s for new notifications, matching PWA refresh behavior */
    const iv = setInterval(fetchUnread, 60000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">MEP Powertech — New App</div>
        <div className="shell-user">
          {/* PWA notification bell in header */}
          <button
            className="link-button"
            title="Notifications"
            onClick={() => navigate('/notifications')}
            style={{ position: 'relative', fontSize: '1.2em', marginRight: 8 }}
          >
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute',
                top: -4,
                right: -6,
                background: '#e53935',
                color: '#fff',
                borderRadius: '50%',
                fontSize: '0.6em',
                minWidth: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                padding: '0 3px',
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <span className="shell-role-badge">{ROLE_LABELS[user?.role] || user?.role}</span>
          <span>{user?.name}</span>
          <button className="link-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <div className="shell-body">
        <nav className="shell-nav">
          {menu.map(([key, label, path]) => (
            <NavLink key={key} to={path} end={path === '/'} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
