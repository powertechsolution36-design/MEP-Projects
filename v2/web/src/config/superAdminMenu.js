/**
 * Super Admin sidebar — flat "previous" version.
 * Kept in a separate file so Shell.jsx (with its grouped-section variant)
 * doesn't have to be touched. AppShell.jsx imports this and swaps it in
 * for the super role.
 */
export const SUPER_ADMIN_MENU = [
  { to: '/',                     label: 'Dashboard',        icon: '🏠', end: true },
  { to: '/companies',            label: 'Companies',        icon: '🏢' },
  { to: '/analytics',            label: 'Analytics',        icon: '📈' },
  { to: '/analytics/revenue',    label: 'Revenue',          icon: '💵' },
  { to: '/analytics/expiring',   label: 'Expiring',         icon: '⏳' },
  { to: '/analytics/locations',  label: 'Client Locations', icon: '📍' },
  { to: '/reports',              label: 'Reports',          icon: '📊' },
];
