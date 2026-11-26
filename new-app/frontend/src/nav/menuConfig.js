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
/*
 * Owner request (21 Nov 2026): "This quotation option not required move
 * this inside Won enquiries. All quotation need to belong to enquiries
 * only." So admin, sales and the Solar Manager no longer carry a
 * Quotations register in the menu: a quotation is reached from the lead it
 * belongs to (the enquiry's own Quotations panel, the Won Enquiries column)
 * or from the client. The /quotations pages themselves are untouched, and
 * the roles with no Enquiries menu of their own — the HVAC and MEP
 * Managers and finance — keep the register, since removing it would leave
 * them no way in at all.
 */
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
    // Owner request (20 Nov 2026): "Above Lost Enquiries add Won Enquiries."
    ['won', '🏆 Won Enquiries', '/enquiries/won'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
    ['projects', '🏗️ Projects', '/projects'],
    // Owner request (26 Nov 2026): every challan in one register, each
    // one linked back to the project it was written against.
    ['challans', '🚚 Delivery Challan', '/delivery-challans'],
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
    // Owner request (20 Nov 2026): "Above Lost Enquiries add Won Enquiries."
    ['won', '🏆 Won Enquiries', '/enquiries/won'],
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
    ['challans', '🚚 Delivery Challan', '/delivery-challans'],
    ['quotations', '📄 Quotations', '/quotations'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    // Owner request (20 Nov 2026): "Add my Service Task and Daily task to
    // Project manager and Solar Manager Account." A Manager can be sent to
    // a service call like any engineer, and can be given a daily task —
    // given one, not handing them out, which stays with admin and the
    // service manager.
    ['myservice', '🛠️ My Service Tasks', '/my-service-tasks'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
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
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    // Owner request (20 Nov 2026): "Above Lost Enquiries add Won Enquiries."
    ['won', '🏆 Won Enquiries', '/enquiries/won'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
    ['projects', '🏗️ Projects', '/projects'],
    ['challans', '🚚 Delivery Challan', '/delivery-challans'],
    ['service', '🛠️ Service Calls', '/service-calls'],
    // Owner request (20 Nov 2026): the Solar Manager's own calls, beside
    // the division register it already has, and its daily tasks.
    ['myservice', '🛠️ My Service Tasks', '/my-service-tasks'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    ['pmlist', '🔁 AMC / PM List', '/contracts'],
    ['invissue', '📤 Issue Material', '/inventory/issue'],
    ['checklists', '✅ Checklists', '/checklists'],
  ],
  mep_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['clients', '🏢 Clients', '/clients'],
    ['projects', '🏗️ Projects', '/projects'],
    ['challans', '🚚 Delivery Challan', '/delivery-challans'],
    ['quotations', '📄 Quotations', '/quotations'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['myservice', '🛠️ My Service Tasks', '/my-service-tasks'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
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
    ['challans', '🚚 Delivery Challan', '/delivery-challans'],

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
    // Owner decision (20 Nov 2026): finance closes an order once the work
    // is finished and the money is in, and writes the actual expense.
    ['soclosing', '✅ Closing Sales Orders', '/sales-orders/closing'],
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
    ['soclosing', '✅ Closing Sales Orders', '/sales-orders/closing'],
    ['dailyTasks', '✅ Daily Tasks', '/daily-tasks'],
    // Owner decision (27 Oct 2026): approving a client's portal login.
    ['customerLogins', '👤 Customer Logins', '/customer-accounts'],
    ['companyprofile', '🏷️ Company Profile', '/company-profile'],
  ],
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
  sales: ['dash', 'enquiries', 'sos', 'won', 'lost'],
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
