import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { menuForRole, mobileMenuForRole, ROLE_LABELS } from './menuConfig';
import { api } from '../api/client';
import { onPushToken, currentPushToken } from '../utils/nativePush';
import NavIcon from './NavIcon';

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
 *
 * REDESIGNED 24 Nov 2026 at the owner's request — "cleaner header and
 * icons", "collapsible sidebar", "and also remember how it will look in
 * mobile", and two looks to choose between:
 *
 *   · the menu's emoji are replaced by drawn icons (NavIcon.jsx), so the
 *     rail looks the same on every machine and matches the typeface;
 *   · the rail collapses to an icon strip on a laptop, which the tables
 *     wanted, and the choice is remembered;
 *   · the company name and its divisions move up into the header, which is
 *     where the eye goes first and which gives the rail its height back;
 *   · the role badge and Log out move into one menu under the user's name,
 *     with the look switch in it: dark rail or light.
 *
 * MOBILE IS UNCHANGED BY ALL OF THIS, deliberately. Below 1024px the rail
 * is a drawer and always shows its labels — collapsing a drawer to icons
 * would be a worse phone, not a better one — the company line moves back
 * into the drawer where there is room for it, and the bottom bar keeps the
 * same destinations it had, now with the same drawn icons.
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
  const mobileMenu = mobileMenuForRole(user?.role);
  const [unreadCount, setUnreadCount] = useState(0);
  const [companyInfo, setCompanyInfo] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  /* Owner request (24 Nov 2026): the rail collapses to icons, and stays
     how it was left. Laptop only — see the note above about the phone. */
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return window.localStorage.getItem('mep_rail_collapsed') === '1'; } catch { return false; }
  });
  const toggleRail = () => setRailCollapsed((v) => {
    const next = !v;
    try { window.localStorage.setItem('mep_rail_collapsed', next ? '1' : '0'); } catch { /* best effort */ }
    return next;
  });

  /* Two looks for him to choose between (24 Nov 2026): the dark rail he
     has now, and a lighter one with the same red accent. Remembered the
     same way; the stylesheet does the rest from [data-skin]. */
  const [skin, setSkin] = useState(() => {
    try { return window.localStorage.getItem('mep_shell_skin') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const chooseSkin = (next) => {
    setSkin(next);
    try { window.localStorage.setItem('mep_shell_skin', next); } catch { /* best effort */ }
  };

  /* The user menu: role, the look switch, and Log out, under one name. */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const close = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [userMenuOpen]);

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

  /* Phone push notifications (owner decision 21 Oct 2026): inside the Android
     app, register this phone for the logged-in user's notifications. */
  useEffect(() => {
    if (!user || user.role === 'super') return undefined;
    return onPushToken(({ token, platform }) => {
      api.post('/api/push-devices', { token, platform: platform || 'android' }).catch(() => {});
    });
  }, [user]);

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
    const pushToken = currentPushToken();
    if (pushToken) {
      // Stop this phone receiving the old user's notifications.
      await api.delete('/api/push-devices', { body: { token: pushToken.token } }).catch(() => {});
    }
    await logout();
    navigate('/login', { replace: true });
  }

  const companyLine = user?.role === 'super' ? 'Platform Administration' : (companyInfo?.name || '');
  const divisions = user?.role === 'super' ? [] : (companyInfo?.divisions || []);
  const shellClass = [
    'shell',
    navOpen ? 'nav-open' : '',
    railCollapsed ? 'rail-collapsed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClass} data-skin={skin}>
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
          <span aria-hidden="true">{navOpen ? '✕' : '☰'}</span>
        </button>

        {/* Owner request (24 Nov 2026): the rail folds to icons. Laptop
            only — on a phone the same button is the drawer above. */}
        <button
          type="button"
          className="icon-button rail-toggle"
          aria-label={railCollapsed ? 'Widen the menu' : 'Collapse the menu to icons'}
          aria-pressed={railCollapsed}
          title={railCollapsed ? 'Widen the menu' : 'Collapse the menu'}
          onClick={toggleRail}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.4 5.6h15.2M4.4 12h15.2M4.4 18.4h15.2" />
          </svg>
        </button>

        {/* Owner's choice (24 Nov 2026), shown four ways and picked: the
            mark stands on the dark bar with no white plate behind it, and
            the word sits in two tight lines — which also makes the block
            narrow enough to leave the company name room on a phone. The
            mark is lifted a little in brightness, because red line art on
            a near-black bar is otherwise muddy. */}
        <div className="shell-brand">
          <img className="shell-logo" src="/icons/icon-192.png" alt="" width="34" height="34" />
          <span className="shell-wordmark">
            <span className="shell-wordmark-top">MEP</span>
            <span className="shell-wordmark-sub">PROJECTS</span>
          </span>
        </div>

        {/* The company and its divisions, up where the eye goes first. On a
            phone this is hidden and shown inside the drawer instead. */}
        {companyLine && (
          <div className="shell-org">
            <span className="shell-org-name">{companyLine}</span>
            {divisions.length > 0 && (
              <span className="shell-org-divisions">
                {divisions.map((d) => <span key={d} className="rail-chip">{d}</span>)}
              </span>
            )}
          </div>
        )}

        <div className="shell-user">
          {/* PWA notification bell in header */}
          <button
            type="button"
            className="icon-button"
            title="Notifications"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            onClick={() => navigate('/notifications')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4.2a5.4 5.4 0 0 0-5.4 5.4c0 4-1.6 5.4-1.6 5.4h14s-1.6-1.4-1.6-5.4A5.4 5.4 0 0 0 12 4.2ZM10.4 18.2a1.8 1.8 0 0 0 3.2 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>

          {/* Owner request (24 Nov 2026): the role and Log out under one
              menu, with the look switch beside them. */}
          <div className="user-menu" ref={userMenuRef}>
            <button
              type="button"
              className="user-menu-button"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              <span className="user-avatar" aria-hidden="true">
                {(user?.name || user?.username || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="user-menu-text">
                <span className="shell-user-name">{user?.name || user?.username}</span>
                <span className="shell-user-role">{ROLE_LABELS[user?.role] || user?.role}</span>
              </span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m7.5 10 4.5 4.5L16.5 10" />
              </svg>
            </button>

            {userMenuOpen && (
              <div className="user-menu-panel" role="menu">
                <div className="user-menu-head">
                  <strong>{user?.name || user?.username}</strong>
                  <span className="muted">{ROLE_LABELS[user?.role] || user?.role}</span>
                </div>
                <div className="user-menu-section">
                  <span className="user-menu-label">Menu look</span>
                  <div className="skin-switch" role="group" aria-label="Menu look">
                    <button
                      type="button"
                      className={skin === 'dark' ? 'is-on' : ''}
                      onClick={() => chooseSkin('dark')}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      className={skin === 'light' ? 'is-on' : ''}
                      onClick={() => chooseSkin('light')}
                    >
                      Light
                    </button>
                  </div>
                </div>
                <button type="button" className="user-menu-item" role="menuitem" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="shell-body">
        <nav className="shell-nav" id="main-nav" aria-label="Main navigation">
          {/* The company sits in the header on a laptop; on a phone the
              header has no room for it, so the drawer carries it. */}
          <div className="shell-company">
            <div className="shell-company-name">{companyLine}</div>
            {divisions.length > 0 && (
              <>
                <div className="shell-company-label" style={{ marginTop: 'var(--s-3)' }}>Divisions</div>
                <div className="shell-company-meta">
                  {divisions.map((d) => <span key={d} className="rail-chip">{d}</span>)}
                </div>
              </>
            )}
          </div>

          {menu.map(([key, label, path]) => {
            const { text } = splitLabel(label);
            return (
              <NavLink
                key={key}
                to={path}
                end={path === '/'}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                /* Collapsed, the name is gone from the screen but not from
                   the page: the title shows it on hover and the label is
                   still read out. */
                title={text}
                onClick={() => setNavOpen(false)}
              >
                <NavIcon name={key} />
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

      <nav className="shell-mobile-nav" aria-label="Mobile navigation">
        {mobileMenu.map(([key, label, path]) => {
          const { text } = splitLabel(label);
          return (
            <NavLink
              key={key}
              to={path}
              end={path === '/'}
              className={({ isActive }) => (isActive ? 'mobile-nav-item active' : 'mobile-nav-item')}
              aria-label={text}
              title={text}
            >
              {/* The same drawn icons as the rail, so the phone and the
                  laptop read as one app (24 Nov 2026). */}
              <NavIcon name={key} className="mobile-nav-icon" />
              <span className="mobile-nav-label">{text}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
