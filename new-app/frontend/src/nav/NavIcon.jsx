/**
 * The navigation icons.
 *
 * Owner request (24 Nov 2026): a cleaner header and real icons instead of
 * the emoji the menu had carried since the PWA. Emoji are drawn by the
 * operating system, so the rail looked different on his laptop, his phone
 * and a client's machine, and they never match the typeface.
 *
 * These are plain inline SVG — no icon package, nothing to download, and
 * they take their colour from the text around them, so one rule in the
 * stylesheet re-colours every one of them. Each is drawn on the same 24
 * grid with the same stroke weight so a column of them lines up.
 *
 * Keyed by the menu key from menuConfig.js, which is what the shell knows.
 * A key with no icon yet falls back to a dot rather than a broken box: a
 * new menu item appears in the rail looking deliberate, and gets its own
 * drawing when somebody adds one.
 */
const P = {
  dash: 'M3 11.2 12 4l9 7.2M5.6 9.8V19a1 1 0 0 0 1 1h3.2v-4.6h4.4V20h3.2a1 1 0 0 0 1-1V9.8',
  clients: 'M4 20V6.2a1 1 0 0 1 .7-1l6-1.9a1 1 0 0 1 1.3 1V20M4 20h16M12 20V9.6l6 1.9a1 1 0 0 1 .7 1V20M7.4 9.4h1.6M7.4 13h1.6M7.4 16.6h1.6',
  enquiries: 'M9 4.6h6M9 4.6a1 1 0 0 0-1 1v.8h8v-.8a1 1 0 0 0-1-1M8 6.4H6.4a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h11.2a1 1 0 0 0 1-1V7.4a1 1 0 0 0-1-1H16M8.8 11h6.4M8.8 14.4h6.4M8.8 17.4h4',
  sos: 'M6 3.6h8.4L19 8.2V20a.8.8 0 0 1-.8.8H6a.8.8 0 0 1-.8-.8V4.4A.8.8 0 0 1 6 3.6Z M14 3.8v4.4h4.6M8.4 13h7.2M8.4 16.4h5',
  won: 'M7.5 4.5h9v3.2a4.5 4.5 0 0 1-9 0ZM7.5 5.6H5.2a2.3 2.3 0 0 0 2.3 3.6M16.5 5.6h2.3a2.3 2.3 0 0 1-2.3 3.6M12 12.2V16M9 20h6M10 16h4l.6 4h-5.2Z',
  lost: 'M12 4.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4ZM9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8',
  projects: 'M12 3.6 20.4 8 12 12.4 3.6 8ZM3.6 12 12 16.4 20.4 12M3.6 16 12 20.4 20.4 16',
  service: 'M14.6 6.2a3.8 3.8 0 0 0 4.8 4.9l-8 8a2.3 2.3 0 0 1-3.3-3.3l8-8a3.8 3.8 0 0 0-1.5-1.6ZM6.4 17.6h.01',
  pmlist: 'M4.6 12a7.4 7.4 0 0 1 12.6-5.3l2 2M19.4 12a7.4 7.4 0 0 1-12.6 5.3l-2-2M19.2 4.4v4.3h-4.3M4.8 19.6v-4.3h4.3',
  payments: 'M4.4 6.6h15.2a1 1 0 0 1 1 1v8.8a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1V7.6a1 1 0 0 1 1-1ZM3.4 10.2h17.2M6.6 14h3',
  stock: 'M12 3.8 20 8v8L12 20.2 4 16V8ZM4 8l8 4.2L20 8M12 12.2v8',
  invissue: 'M12 16.4V5.2M8.4 8.6 12 5l3.6 3.6M4.6 15v4a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-4',
  invreturn: 'M12 5v11.2M8.4 12.6 12 16.2l3.6-3.6M4.6 15v4a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-4',
  invtransfer: 'M4.6 8.6h12.2M13.6 5.4l3.2 3.2-3.2 3.2M19.4 15.4H7.2M10.2 12.2 7 15.4l3.2 3.2',
  // A delivery truck -- the challan register (owner, 26 Nov 2026).
  challans: 'M3.4 7.4h9.4v9.2H3.4ZM12.8 10.4h3.6l3.2 3v3.2h-6.8ZM7.4 18.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM16.6 18.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z',
  invcats: 'M4 7.2a1 1 0 0 1 1-1h3.8l1.6 2H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z',
  invhistory: 'M4.6 9.6h14.8M4.6 14.4h14.8M4.6 5.4h14.8M4.6 18.8h9',
  users: 'M9.2 11.4a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2ZM3.8 19.4a5.4 5.4 0 0 1 10.8 0M15.8 5.6a3.1 3.1 0 0 1 0 5.8M17 14.6a5.4 5.4 0 0 1 3.2 4.8',
  checklists: 'M5 5.4h14a.8.8 0 0 1 .8.8v12.4a.8.8 0 0 1-.8.8H5a.8.8 0 0 1-.8-.8V6.2A.8.8 0 0 1 5 5.4ZM8 12l2.6 2.6L16 9.2',
  soclosing: 'M12 4.6a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 0 1 0-14.8ZM8.6 12.2l2.4 2.4 4.4-4.6',
  dailyTasks: 'M5.4 6.4h13.2a1 1 0 0 1 1 1v11.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V7.4a1 1 0 0 1 1-1ZM8.2 4.2v4M15.8 4.2v4M4.4 10.6h15.2M9 14.6l2 2 3.8-3.8',
  quotations: 'M6.4 3.8h7.2L18.6 9v11.2H6.4ZM13.4 4v5h5M9 13h6M9 16.2h4',
  customerLogins: 'M10 11.6a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM4.2 19.6a5.8 5.8 0 0 1 11.6 0M16.4 13.8l1.8 1.8 3.2-3.4',
  companyprofile: 'M4.4 11.6 11.6 4.4h5.8a1.4 1.4 0 0 1 1.4 1.4v5.8l-7.2 7.2a1.4 1.4 0 0 1-2 0l-5.2-5.2a1.4 1.4 0 0 1 0-2ZM15.4 8.6h.01',
  myservice: 'M14.6 6.2a3.8 3.8 0 0 0 4.8 4.9l-8 8a2.3 2.3 0 0 1-3.3-3.3l8-8a3.8 3.8 0 0 0-1.5-1.6ZM4.4 20.2h5',
  mymaterial: 'M12 3.8 20 8v8L12 20.2 4 16V8ZM4 8l8 4.2L20 8M12 12.2v8M8 5.8l8 4.3',
  subscriptions: 'M4.4 6.6h15.2a1 1 0 0 1 1 1v8.8a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1V7.6a1 1 0 0 1 1-1ZM3.4 10.6h17.2M14.4 14.2h3',
  companies: 'M4 20V7.4a1 1 0 0 1 1-1h5v13.6M10 20h9.4a1 1 0 0 0 1-1V11a1 1 0 0 0-1-1H10M3.4 20h17.2M6.6 9.6h1.2M6.6 13h1.2M6.6 16.4h1.2M13.4 13.2h2.4M13.4 16.6h2.4',
  usage: 'M4.6 19.4h14.8M7.6 19.4v-6.2M12 19.4V6.6M16.4 19.4v-9',
  reports: 'M6 3.8h8.4L18.6 8v12.2H6ZM13.8 4v4.2h4.6M9 16.4v-3M12 16.4v-5.4M15 16.4v-2',
  expiring: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM12 8.4v4l2.6 1.6',
  locations: 'M12 20.4s6.4-5 6.4-9.6a6.4 6.4 0 1 0-12.8 0c0 4.6 6.4 9.6 6.4 9.6ZM12 13a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  revenue: 'M4.6 17.4 10 12l3.2 3.2 6.2-6.4M15.4 8.8h4v4',
};

export default function NavIcon({ name, className = 'nav-item-icon' }) {
  const d = P[name];
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d
        ? <path d={d} />
        : <circle cx="12" cy="12" r="3.4" />}
    </svg>
  );
}
