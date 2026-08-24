import { create } from 'zustand';
import { api, setToken, getToken } from '../api/client';
import { connectSocket, disconnectSocket, getSocket } from '../api/socket';

const empty = {
  companies: [], users: [], projects: [], serviceCalls: [], contracts: [], payments: [],
  enquiries: [], salesOrders: [], notifications: [], checklists: [],
  invCategories: [], invLocations: [], invItems: [], invIssues: [],
};

// Map resource name -> store key
const RESOURCE_MAP = {
  company: 'companies', user: 'users', project: 'projects', servicecall: 'serviceCalls',
  contract: 'contracts', payment: 'payments', enquiry: 'enquiries', salesorder: 'salesOrders',
  notification: 'notifications', checklist: 'checklists',
  invcategory: 'invCategories', invlocation: 'invLocations', invitem: 'invItems', invissue: 'invIssues',
};

function upsert(list, doc) {
  const idx = list.findIndex(x => String(x._id) === String(doc._id));
  if (idx >= 0) { const copy = [...list]; copy[idx] = doc; return copy; }
  return [doc, ...list];
}

function removeById(list, id) { return list.filter(x => String(x._id) !== String(id)); }

export const useStore = create((set, get) => ({
  user: null,
  company: null,
  loading: false,
  connected: false,
  // For super admin: filter all lists by this company (null = all)
  scopedCompany: null,
  ...empty,

  setScopedCompany(id) { set({ scopedCompany: id }); },

  async login(un, pw) {
    set({ loading: true });
    try {
      const { token, user, company } = await api.post('/api/auth/login', { un, pw });
      setToken(token);
      set({ user, company, loading: false });
      await get().loadAll();
      get().initSocket();
      return true;
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async restoreSession() {
    if (!getToken()) return false;
    try {
      const { user, company } = await api.get('/api/auth/me');
      set({ user, company });
      await get().loadAll();
      get().initSocket();
      return true;
    } catch (e) {
      setToken(null);
      set({ user: null, company: null });
      return false;
    }
  },

  logout() {
    setToken(null);
    disconnectSocket();
    set({ user: null, company: null, connected: false, ...empty });
  },

  async loadAll() {
    try {
      const data = await api.get('/api/bulk');
      set(data);
    } catch (e) { console.error('loadAll failed', e); }
  },

  initSocket() {
    const s = connectSocket();
    if (!s) return;
    s.on('connect', () => set({ connected: true }));
    s.on('disconnect', () => set({ connected: false }));
    // Wire up all resource events
    for (const [event, key] of Object.entries(RESOURCE_MAP)) {
      s.on(`${event}:update`, (doc) => set(state => ({ [key]: upsert(state[key], doc) })));
      s.on(`${event}:delete`, ({ _id }) => set(state => ({ [key]: removeById(state[key], _id) })));
    }
  },

  // Generic CRUD helpers
  async create(resource, data) {
    const path = pathFor(resource);
    return api.post(path, data);
  },
  async update(resource, id, data) {
    return api.put(`${pathFor(resource)}/${id}`, data);
  },
  async remove(resource, id) {
    return api.del(`${pathFor(resource)}/${id}`);
  },
}));

function pathFor(resource) {
  const map = {
    users: '/api/users', projects: '/api/projects', serviceCalls: '/api/service-calls',
    contracts: '/api/contracts', payments: '/api/payments', enquiries: '/api/enquiries',
    salesOrders: '/api/sales-orders', notifications: '/api/notifications',
    checklists: '/api/checklists', companies: '/api/companies',
    invCategories: '/api/inventory/categories', invLocations: '/api/inventory/locations',
    invItems: '/api/inventory/items', invIssues: '/api/inventory/issues',
  };
  return map[resource];
}

// Handle 401 dispatched by client
window.addEventListener('mep:logout', () => useStore.getState().logout());
