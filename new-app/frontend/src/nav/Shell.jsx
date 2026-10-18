import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { menuForRole, ROLE_LABELS } from './menuConfig';
import { api } from '../api/client';

/**
 * App shell: top bar + role-based navigation rail + routed content.
 *
 * The navigation items shown come straight from menuConfig.js's per-role
 * PWA-traced menu (see that file). This is a UI convenience only — the
 * server remains the authority on what each role may actually do; hiding a
 * nav item here does not, by itself, protect the underlying route or API.
 *
 * PWA FACT: header bar contains a notification bell icon with unread count
 * badge. Clicking it navigates to the notifications page.
 * PWA FACT (index.html:1320): the rail shows the company name and its
 * divisions ("Platform Administration" for super).
 *
 * Layout note: below 1024px the rail becomes an off-canvas drawer opened by
 * the header's menu button (see styles/layout.css). Nothing about which
 * items appear changes with viewport — only how they are presented.
 */

/* Menu labels carry a leading glyph from the PWA ("🏠 Dashboard"). Split it
   off so the glyph can be sized and aligned independently of the text. */
function splitLabel(label) {
  const i = label.indexOf(' ');
  if (i <= 0) return { icon: '', text: label };
  return { icon: label.slice(0, i), text: label.slice(i + 1) };
}

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const menu = menuForRole(user?.role);
  const [unreadCount, setUnreadCount] = useState(0);
  const [companyInfo, setCompanyInfo] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!user || user.role === 'super') return;
    Promise.all([
      api.get('/api/companies/my-profile').catch(() => null),
      api.get('/api/subscriptions/my-divisions').catch(() => null),
    ]).then(([p, d]) => {
      setCompanyInfo({
        name: p?.company?.displayName || p?.company?.name || '',
        divisions: d?.divisions || p?.company?.divisions || [],
      });
    });
  }, [user]);

  const fetchUnread = useCallback(async () => {
    if (!user || user.role === 'super') return; // super has no company notifications
    try {
      const data = await api.get('/api/notifications?limit=200');
      const list = data.notifications || [];
      setUnreadCount(list.filter((n) => !n.isRead).length);
    } catch {
      /* silent — header badge is best-effort */
    }
  }, [user]);

  useEffect(() => {
    fetchUnread();
    /* Poll every 60s for new notifications, matching PWA refresh behavior */
    const iv = setInterval(fetchUnread, 60000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  /* Following a link inside the drawer should close it. */
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  /* Escape closes the drawer, like any other overlay in the app. */
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={navOpen ? 'shell nav-open' : 'shell'}>
      <a className="skip-link" href="#main-content">Skip to content</a>

      <header className="shell-header">
        <button
          type="button"
          className="icon-button nav-toggle"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="main-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? '✕' : '☰'}
        </button>

        <div className="shell-brand">
          <span className="shell-logo-plate"><img className="shell-logo" src="/icons/icon-192.png" alt="" width="28" height="28" /></span>
          <span><em>MEP</em> PROJECTS</span>
        </div>

        <div className="shell-user">
          {/* PWA notification bell in header */}
          <button
            type="button"
            className="icon-button"
            title="Notifications"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            onClick={() => navigate('/notifications')}
          >
            <span aria-hidden="true">🔔</span>
            {unreadCount > 0 && (
              <span className="icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
          <span className="shell-role-badge">{ROLE_LABELS[user?.role] || user?.role}</span>
          <span className="shell-user-name">{user?.name}</span>
          <button className="link-button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <div className="shell-body">
        <nav className="shell-nav" id="main-nav" aria-label="Main navigation">
          <div className="shell-company">
            {user?.role === 'super' ? (
              <div className="shell-company-name">Platform Administration</div>
            ) : (
              <>
                <div className="shell-company-name">{companyInfo?.name || ''}</div>
                {companyInfo?.divisions?.length > 0 && (
                  <>
                    <div className="shell-company-label" style={{ marginTop: 'var(--s-3)' }}>Divisions</div>
                    <div className="shell-company-meta">
                      {companyInfo.divisions.map((d) => (
                        <span key={d} className="rail-chip">{d}</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {menu.map(([key, label, path]) => {
            const { icon, text } = splitLabel(label);
            return (
              <NavLink
                key={key}
                to={path}
                end={path === '/'}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                {icon && <span className="nav-item-icon" aria-hidden="true">{icon}</span>}
                <span className="nav-item-label">{text}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Tapping outside the drawer closes it (narrow viewports only). */}
        <button
          type="button"
          className="shell-scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />

        <main className="shell-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
