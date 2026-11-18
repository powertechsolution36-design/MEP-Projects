// Role -> navigation menu, traced 1:1 from the PWA's own MENUS/ROLES/TITLES
// tables (MEP_PROJECTS_PWA/index.html, `var MENUS = {...}` /
// `var ROLES = {...}`). Do NOT reorder, rename, add, or drop items relative
// to the PWA — this menu structure is the sole UI/UX source of truth for
// per-role navigation (see engagement ground rules). Only the destination
// (`path`) is new, since this app uses real routes instead of the PWA's
// single-page hash router.

export const ROLE_LABELS = {
  super: 'Super Admin',
  admin: 'Admin',
  sales: 'Sales',
  hvac_pm: 'HVAC Project Manager',
  solar_pm: 'Solar Manager',
  mep_pm: 'MEP Design Manager',
  engineer: 'Engineer',
  inventory: 'Inventory Manager',
  service_mgr: 'Service Manager',
  service_eng: 'Service Engineer',
  finance: 'Finance',
};

// [key, label, path] per PWA MENUS[role] entry (icon glyph kept from the
// PWA's own labels for visual continuity).
export const MENUS = {
  super: [
    ['dash', '🏠 Dashboard', '/'],
    ['companies', '🏢 Companies', '/admin/companies'],
    ['usage', '📈 Client Business', '/admin/usage'],
    ['revenue', '💵 Revenue', '/admin/revenue'],
    ['expiring', '⏳ Expiring Soon', '/admin/expiring'],
    ['locations', '📍 Locations', '/admin/locations'],
    ['reports', '📊 Reports', '/reports'],
  ],
  admin: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['enquiries', '📋 Enquiries', '/enquiries'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
    ['projects', '🏗️ Projects', '/projects'],
    ['service', '🛠️ Service Calls', '/service-calls'],
    ['pmlist', '🔁 AMC / PM List', '/contracts'],
    ['payments', '💰 Payments', '/payments'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['invissue', '📤 Issue Material', '/inventory/issue'],
    ['invreturn', '📥 Material Returns', '/inventory/returns'],
    ['invhistory', '🧾 Inventory Log', '/inventory/history'],
    ['users', '👥 Users', '/users'],
    ['checklists', '✅ Checklists', '/checklists'],
  ],
  sales: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['enquiries', '📋 Enquiries', '/enquiries'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
  ],
/*
 * Owner request (18 Nov 2026): "add edit option to Sales order and
 * quotation ... in Project manager login." A Manager needs the Quotations
 * register to reach one. What it shows them is their own division's, and
 * raising, duplicating, deleting and exporting stay with the commercial
 * roles — the server decides both (quotationService / quotationRoutes).
 */
  hvac_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['projects', '🏗️ Projects', '/projects'],
    ['quotations', '📄 Quotations', '/quotations'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['checklists', '✅ Checklist Template', '/checklists'],
  ],
  /**
   * Owner request (14 Nov 2026): the Solar Manager runs the solar side of
   * the business end to end, so its menu is the whole solar journey —
   * leads, orders, projects, service, AMC and material — rather than the
   * project-only menu the role started with. Everything it opens is scoped
   * to Solar by the server, not by this list.
   */
  solar_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['enquiries', '📋 Enquiries', '/enquiries'],
    ['quotations', '📄 Quotations', '/quotations'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
    ['projects', '🏗️ Projects', '/projects'],
    ['service', '🛠️ Service Calls', '/service-calls'],
    ['pmlist', '🔁 AMC / PM List', '/contracts'],
    ['invissue', '📤 Issue Material', '/inventory/issue'],
    ['checklists', '✅ Checklists', '/checklists'],
  ],
  mep_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['projects', '🏗️ Projects', '/projects'],
    ['quotations', '📄 Quotations', '/quotations'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['checklists', '✅ Checklist Template', '/checklists'],
  ],
  engineer: [
    ['dash', '🏠 My Work', '/'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    ['mymaterial', '📦 My Material', '/my-material'],
  ],
  inventory: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['invissue', '📤 Issue Material', '/inventory/issue'],
    ['invreturn', '📥 Material Returns', '/inventory/returns'],
    ['invtransfer', '🔄 Stock Transfer', '/inventory/transfer'],
    ['invcats', '🗂 Categories & Locations', '/inventory/categories'],
    ['invhistory', '🧾 Transactions', '/inventory/history'],
  ],
  service_mgr: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['service', '🛠️ Service Calls', '/service-calls'],
    ['pmlist', '🔁 AMC / PM List', '/contracts'],
    ['stock', '📦 Stock', '/inventory/stock'],
  ],
  service_eng: [
    ['dash', '🏠 My Service Jobs', '/'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    ['mymaterial', '📦 My Material', '/my-material'],
  ],
  finance: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['payments', '💰 Pending Payments', '/payments'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
  ],
};

/**
 * NEW APP additions (owner-approved, Completion order): Stage 7 screens that
 * have no PWA menu item. Appended AFTER each role's PWA items so the PWA
 * menus above stay exactly as traced (same items, labels, order).
 */
export const NEW_APP_MENU_ADDITIONS = {
  super: [['subscriptions', '💳 Subscriptions', '/admin/subscriptions']],
  admin: [
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    ['quotations', '📄 Quotations', '/quotations'],
    // Owner decision (27 Oct 2026): approving a client's portal login.
    ['customerLogins', '👤 Customer Logins', '/customer-accounts'],
    ['companyprofile', '🏷️ Company Profile', '/company-profile'],
  ],
  sales: [['quotations', '📄 Quotations', '/quotations']],
  finance: [['quotations', '📄 Quotations', '/quotations']],
  service_mgr: [
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    ['customerLogins', '👤 Customer Logins', '/customer-accounts'],
  ],
};

export function menuForRole(role) {
  return [...(MENUS[role] || []), ...(NEW_APP_MENU_ADDITIONS[role] || [])];
}

// Mobile shortcuts use the same authenticated user's role menu. Keep the
// full role menu in the sidebar; this only selects the most-used destinations
// for the compact bottom navigation.
const MOBILE_NAV_KEYS = {
  super: ['dash', 'companies', 'usage', 'reports'],
  admin: ['dash', 'dailyTasks', 'users', 'checklists'],
  sales: ['dash', 'enquiries', 'sos', 'lost'],
  hvac_pm: ['dash', 'projects', 'sos', 'checklists'],
  solar_pm: ['dash', 'enquiries', 'projects', 'service'],
  mep_pm: ['dash', 'projects', 'sos', 'checklists'],
  engineer: ['dash', 'dailyTasks', 'mymaterial'],
  inventory: ['dash', 'stock', 'invissue', 'invreturn'],
  service_mgr: ['dash', 'service', 'pmlist', 'dailyTasks'],
  service_eng: ['dash', 'dailyTasks', 'mymaterial'],
  finance: ['dash', 'payments', 'sos', 'quotations'],
};

export function mobileMenuForRole(role) {
  const entries = new Map(menuForRole(role).map((entry) => [entry[0], entry]));
  return (MOBILE_NAV_KEYS[role] || ['dash'])
    .map((key) => entries.get(key))
    .filter(Boolean);
}
