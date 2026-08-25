export const ROLE_META = {
  super: {
    label: 'Super Admin',
    subtitle: 'Platform Owner',
    icon: '👑',
    color: '#d92b2b',
    responsibilities: [
      'Manage companies',
      'Manage subscriptions',
      'Activate / suspend companies',
      'Configure platform modules',
      'Manage platform-level settings',
      'Monitor overall platform usage',
    ],
  },
  admin: {
    label: 'Company Admin',
    subtitle: 'Company Owner / IT Admin',
    icon: '🛡️',
    color: '#2563c9',
    responsibilities: [
      'Manage company users and roles',
      'Manage company settings',
      'Oversee projects, sales, service, inventory, and finance',
      'View company-wide reports',
      'Control access to company modules',
    ],
  },
  sales: {
    label: 'Sales Manager',
    subtitle: 'Sales Team',
    icon: '📞',
    color: '#d98a00',
    responsibilities: [
      'Manage enquiries and customers',
      'Handle sales orders',
      'Track follow-ups',
      'Monitor sales performance',
      'Manage assigned sales staff',
    ],
  },
  mep_pm: {
    label: 'MEP Project Manager',
    subtitle: 'MEP Division',
    icon: '🏗️',
    color: '#7c3aed',
    responsibilities: [
      'Create and manage MEP projects',
      'Assign team members',
      'Track project progress',
      'Manage timelines and checklists',
      'Monitor delayed projects',
    ],
  },
  hvac_pm: {
    label: 'HVAC Project Manager',
    subtitle: 'HVAC Division',
    icon: '❄️',
    color: '#0891b2',
    responsibilities: [
      'Create and manage HVAC projects',
      'Assign engineers to HVAC works',
      'Track project progress and timelines',
      'Manage checklists and updates',
      'Monitor delayed projects',
    ],
  },
  solar_pm: {
    label: 'Solar Project Manager',
    subtitle: 'Solar Division',
    icon: '☀️',
    color: '#d98a00',
    responsibilities: [
      'Create and manage Solar projects',
      'Assign engineers and site teams',
      'Track project progress',
      'Manage timelines and checklists',
      'Monitor delayed projects',
    ],
  },
  service_mgr: {
    label: 'Service Manager',
    subtitle: 'Service Operations',
    icon: '🛠️',
    color: '#2563c9',
    responsibilities: [
      'Manage service calls',
      'Assign engineers',
      'Schedule service visits',
      'Manage AMC / PM work',
      'Review service reports',
    ],
  },
  service_eng: {
    label: 'Service Engineer',
    subtitle: 'Field Service',
    icon: '🔧',
    color: '#1d9e5f',
    responsibilities: [
      'Complete assigned service calls',
      'Update service reports',
      'Upload site photos',
      'Capture customer signatures',
      'Record material usage',
    ],
  },
  engineer: {
    label: 'Engineer',
    subtitle: 'Project Execution',
    icon: '⚙️',
    color: '#1d9e5f',
    responsibilities: [
      'Complete assigned work on projects',
      'Update project checklists',
      'Upload site photos and notes',
      'Track issued materials',
      'Submit daily / weekly updates',
    ],
  },
  store: {
    label: 'Inventory Manager',
    subtitle: 'Stores & Materials',
    icon: '📦',
    color: '#d98a00',
    responsibilities: [
      'Manage stock and locations',
      'Issue and receive materials',
      'Transfer inventory between sites',
      'Maintain stock records',
      'Monitor low-stock items',
    ],
  },
  accounts: {
    label: 'Finance / Accounts',
    subtitle: 'Finance Team',
    icon: '💰',
    color: '#1d9e5f',
    responsibilities: [
      'Record payments',
      'Track outstanding balances',
      'Manage payment follow-ups',
      'Review financial information',
      'Generate finance reports',
    ],
  },
  viewer: {
    label: 'Viewer',
    subtitle: 'Read-only Access',
    icon: '👁️',
    color: '#6b7a8c',
    responsibilities: [
      'View permitted dashboards',
      'Review reports',
      'Monitor projects and operations',
      'Access approved business information',
    ],
  },
};

// Which sidebar routes each role can access — mirrors old-app MENUS mapping
export const ROLE_MODULES = {
  super:       ['/', '/companies', '/analytics', '/users', '/projects', '/contracts', '/payments', '/enquiries', '/lost-enquiries', '/sales-orders', '/checklists', '/reports', '/notifications'],
  admin:       ['/', '/enquiries', '/lost-enquiries', '/sales-orders', '/projects', '/service-calls', '/contracts', '/payments', '/inventory', '/users', '/checklists', '/reports', '/notifications'],
  sales:       ['/', '/enquiries', '/lost-enquiries', '/sales-orders', '/reports', '/notifications'],
  hvac_pm:     ['/', '/projects', '/sales-orders', '/inventory', '/checklists', '/reports', '/notifications'],
  solar_pm:    ['/', '/projects', '/sales-orders', '/inventory', '/checklists', '/reports', '/notifications'],
  mep_pm:      ['/', '/projects', '/sales-orders', '/checklists', '/reports', '/notifications'],
  engineer:    ['/', '/projects', '/inventory', '/notifications'],
  service_mgr: ['/', '/service-calls', '/contracts', '/inventory', '/reports', '/notifications'],
  service_eng: ['/', '/service-calls', '/inventory', '/notifications'],
  store:       ['/', '/inventory', '/reports', '/notifications'],
  accounts:    ['/', '/payments', '/sales-orders', '/reports', '/notifications'],
  viewer:      ['/', '/reports', '/notifications'],
};

// Which dashboard cards each role sees (compact stat labels)
export const ROLE_DASHBOARD = {
  super:       ['companies', 'users', 'projects', 'contracts', 'payments', 'enquiries', 'salesOrders'],
  admin:       ['users', 'projects', 'serviceCalls', 'contracts', 'payments', 'enquiries', 'salesOrders', 'inventory'],
  mep_pm:      ['projects', 'projectsActive', 'projectsPlanning', 'projectsCompleted'],
  hvac_pm:     ['projects', 'projectsActive', 'projectsPlanning', 'projectsCompleted'],
  solar_pm:    ['projects', 'projectsActive', 'projectsPlanning', 'projectsCompleted'],
  engineer:    ['myProjects', 'myChecklistItems'],
  service_mgr: ['serviceCalls', 'contracts', 'lowStock'],
  service_eng: ['myCallsOpen', 'myCallsClosed', 'myCallsUrgent'],
  sales:       ['enquiries', 'enquiriesNew', 'salesOrders', 'salesOrdersTotal', 'payments'],
  store:       ['inventory', 'lowStock', 'invIssues', 'invValue'],
  accounts:    ['payments', 'paymentsPending', 'paymentsPaid', 'salesOrders'],
  viewer:      ['projects', 'serviceCalls', 'payments'],
};

export function canAccess(role, path) {
  const mods = ROLE_MODULES[role] || ROLE_MODULES.viewer;
  return mods.includes(path);
}

export function getRoleMeta(role) {
  return ROLE_META[role] || {
    label: role || 'User',
    subtitle: '',
    icon: '👤',
    color: '#6b7a8c',
    responsibilities: [],
  };
}

export function getRoleLabel(role) {
  return ROLE_META[role]?.label || role || '—';
}

// Ordered options for role dropdowns: {value, label}
export function roleOptions(includeSuper = false) {
  const order = ['admin', 'mep_pm', 'hvac_pm', 'solar_pm', 'sales', 'service_mgr', 'service_eng', 'engineer', 'store', 'accounts', 'viewer'];
  const opts = order.map(r => ({ value: r, label: ROLE_META[r].label }));
  if (includeSuper) opts.unshift({ value: 'super', label: ROLE_META.super.label });
  return opts;
}
