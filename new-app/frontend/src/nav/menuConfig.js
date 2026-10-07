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
  solar_pm: 'Solar Project Manager',
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
    ['enquiries', '📋 Enquiries', '/enquiries'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['lost', '❌ Lost Enquiries', '/enquiries/lost'],
  ],
  hvac_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['projects', '🏗️ Projects', '/projects'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['checklists', '✅ Checklist Template', '/checklists'],
  ],
  solar_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['projects', '🏗️ Projects', '/projects'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['checklists', '✅ Checklist Template', '/checklists'],
  ],
  mep_pm: [
    ['dash', '🏠 Dashboard', '/'],
    ['projects', '🏗️ Projects', '/projects'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
    ['checklists', '✅ Checklist Template', '/checklists'],
  ],
  engineer: [
    ['dash', '🏠 My Work', '/'],
    ['mymaterial', '📦 My Material', '/my-material'],
  ],
  inventory: [
    ['dash', '🏠 Dashboard', '/'],
    ['stock', '📦 Stock', '/inventory/stock'],
    ['invissue', '📤 Issue Material', '/inventory/issue'],
    ['invreturn', '📥 Material Returns', '/inventory/returns'],
    ['invtransfer', '🔄 Stock Transfer', '/inventory/transfer'],
    ['invcats', '🗂 Categories & Locations', '/inventory/categories'],
    ['invhistory', '🧾 Transactions', '/inventory/history'],
  ],
  service_mgr: [
    ['dash', '🏠 Dashboard', '/'],
    ['service', '🛠️ Service Calls', '/service-calls'],
    ['pmlist', '🔁 AMC / PM List', '/contracts'],
    ['stock', '📦 Stock', '/inventory/stock'],
  ],
  service_eng: [
    ['dash', '🏠 My Service Jobs', '/'],
    ['mymaterial', '📦 My Material', '/my-material'],
  ],
  finance: [
    ['dash', '🏠 Dashboard', '/'],
    ['payments', '💰 Pending Payments', '/payments'],
    ['sos', '🧾 Sales Orders', '/sales-orders'],
  ],
};

export function menuForRole(role) {
  return MENUS[role] || [];
}
