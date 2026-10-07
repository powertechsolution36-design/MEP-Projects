import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiRequest, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Inventory Stock — PWA `vStock()` exact reproduction.
 *
 * Shows dashboard KPIs + item list with stock levels.
 * PWA MENUS: admin, inventory, service_mgr, hvac_pm, solar_pm have stock access.
 * PWA FACT: mep_pm does NOT have stock menu entry.
 * MANAGE_ROLES (inventory, admin) can create/edit/delete items, adjust stock.
 * STOCK_REPORT_ROLES can export CSV.
 */

const MANAGE_ROLES = ['inventory', 'admin'];
const STOCK_REPORT_ROLES = ['admin', 'inventory', 'hvac_pm', 'solar_pm', 'service_mgr'];
const UNITS = ['Nos', 'Mtr', 'Kg', 'Set', 'Box', 'Roll', 'Ltr'];
const ADJUSTMENT_TYPES = ['Purchase In', 'Opening Stock', 'Damage / Write-off', 'Adjustment'];

function totQty(item) {
  if (!item?.stockByLocation) return 0;
  const entries = item.stockByLocation instanceof Map
    ? Array.from(item.stockByLocation.values())
    : Object.values(item.stockByLocation);
  return entries.reduce((s, v) => s + (Number(v) || 0), 0);
}

function stockState(item) {
  const t = totQty(item);
  if (t <= 0) return { label: 'Out of Stock', cls: 'status-lost' };
  if (item.minimumStockLevel && t <= item.minimumStockLevel) return { label: 'Low Stock', cls: 'status-pending' };
  return { label: 'In Stock', cls: 'status-open' };
}

export default function InventoryStock() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  /* Modals */
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [showAdjust, setShowAdjust] = useState(null);
  const [saving, setSaving] = useState(false);

  /* Create form */
  const [createForm, setCreateForm] = useState({
    code: '', name: '', categoryId: '', unit: 'Nos', returnable: false,
    minimumStockLevel: '', ratePerUnit: '', openingStock: '', openingLocationId: '',
  });

  /* Edit form */
  const [editForm, setEditForm] = useState({
    code: '', name: '', categoryId: '', unit: 'Nos', returnable: false,
    minimumStockLevel: '', ratePerUnit: '',
  });

  /* Adjust form */
  const [adjustForm, setAdjustForm] = useState({
    type: 'Purchase In', quantity: '', locationId: '', remark: '',
  });

  const canManage = MANAGE_ROLES.includes(user?.role);
  const canExport = STOCK_REPORT_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsData, catData, locData, dashData] = await Promise.all([
        api.get('/api/inventory/items'),
        api.get('/api/inventory/categories'),
        api.get('/api/inventory/locations'),
        canManage ? api.get('/api/inventory/dashboard').catch(() => null) : Promise.resolve(null),
      ]);
      setItems(itemsData.items || []);
      setCategories(catData.categories || []);
      setLocations(locData.locations || []);
      setDashboard(dashData?.dashboard || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { load(); }, [load]);

  /* Category/Location name resolution */
  function catName(id) {
    const c = categories.find(x => (x.id || x._id) === id);
    return c ? c.name : '—';
  }
  function locName(id) {
    const l = locations.find(x => (x.id || x._id) === id);
    return l ? l.name : String(id);
  }

  /* Search filter (client-side) */
  const filtered = search
    ? items.filter(i => {
        const blob = [i.code, i.name, catName(i.categoryId), i.unit].join(' ').toLowerCase();
        return blob.includes(search.toLowerCase());
      })
    : items;

  /* ---- Create Item ---- */
  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/inventory/items', {
        code: createForm.code,
        name: createForm.name,
        categoryId: createForm.categoryId || undefined,
        unit: createForm.unit,
        returnable: createForm.returnable,
        minimumStockLevel: createForm.minimumStockLevel ? Number(createForm.minimumStockLevel) : undefined,
        ratePerUnit: createForm.ratePerUnit ? Number(createForm.ratePerUnit) : undefined,
        openingStock: createForm.openingStock ? Number(createForm.openingStock) : undefined,
        openingLocationId: createForm.openingLocationId || undefined,
      });
      setShowCreate(false);
      setCreateForm({ code: '', name: '', categoryId: '', unit: 'Nos', returnable: false, minimumStockLevel: '', ratePerUnit: '', openingStock: '', openingLocationId: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- Edit Item ---- */
  function openEdit(item) {
    setEditForm({
      code: item.code || '',
      name: item.name || '',
      categoryId: item.categoryId || '',
      unit: item.unit || 'Nos',
      returnable: !!item.returnable,
      minimumStockLevel: item.minimumStockLevel != null ? String(item.minimumStockLevel) : '',
      ratePerUnit: item.ratePerUnit != null ? String(item.ratePerUnit) : '',
    });
    setShowEdit(item);
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const itemId = showEdit.id || showEdit._id;
      await apiPut(`/api/inventory/items/${itemId}`, {
        code: editForm.code,
        name: editForm.name,
        categoryId: editForm.categoryId || undefined,
        unit: editForm.unit,
        returnable: editForm.returnable,
        minimumStockLevel: editForm.minimumStockLevel ? Number(editForm.minimumStockLevel) : undefined,
        ratePerUnit: editForm.ratePerUnit ? Number(editForm.ratePerUnit) : undefined,
      });
      setShowEdit(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- Delete Item ---- */
  async function handleDelete(item) {
    if (!window.confirm(`Delete item "${item.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/inventory/items/${item.id || item._id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  /* ---- Adjust Stock ---- */
  function openAdjust(item) {
    setAdjustForm({ type: 'Purchase In', quantity: '', locationId: '', remark: '' });
    setShowAdjust(item);
  }

  async function handleAdjust(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const itemId = showAdjust.id || showAdjust._id;
      await api.post(`/api/inventory/items/${itemId}/adjust`, {
        type: adjustForm.type,
        quantity: Number(adjustForm.quantity) || 0,
        locationId: adjustForm.locationId || undefined,
        remark: adjustForm.remark || undefined,
      });
      setShowAdjust(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* ---- CSV Export ---- */
  async function handleExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/stock.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory-stock-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Stock</h2>
        <div className="enq-actions">
          {canManage && (
            <button className="btn pri" onClick={() => setShowCreate(true)}>+ New Item</button>
          )}
          {canExport && (
            <button className="btn sec" onClick={handleExport}>CSV Export</button>
          )}
        </div>
      </div>

      {/* Dashboard KPIs */}
      {dashboard && (
        <div className="kpi-bar">
          <div className="kpi-card"><div className="kpi-label">Total Items</div><div className="kpi-value">{dashboard.totalItems}</div></div>
          <div className="kpi-card"><div className="kpi-label">Categories</div><div className="kpi-value">{dashboard.categories}</div></div>
          <div className="kpi-card"><div className="kpi-label">Stock Value</div><div className="kpi-value">{money(dashboard.stockValue)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Low Stock</div><div className="kpi-value" style={{ color: dashboard.lowStock > 0 ? '#e65100' : undefined }}>{dashboard.lowStock}</div></div>
          <div className="kpi-card"><div className="kpi-label">Out of Stock</div><div className="kpi-value" style={{ color: dashboard.outOfStock > 0 ? '#c62828' : undefined }}>{dashboard.outOfStock}</div></div>
          <div className="kpi-card"><div className="kpi-label">Material w/ Staff</div><div className="kpi-value">{dashboard.materialWithStaff}</div></div>
          <div className="kpi-card"><div className="kpi-label">Return Requests</div><div className="kpi-value" style={{ color: dashboard.returnRequests > 0 ? '#e65100' : undefined }}>{dashboard.returnRequests}</div></div>
        </div>
      )}

      <div className="search-bar">
        <input type="text" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Value</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canManage ? 9 : 8} className="muted">No items found.</td></tr>
              )}
              {filtered.map(item => {
                const qty = totQty(item);
                const state = stockState(item);
                const value = qty * (Number(item.ratePerUnit) || 0);
                return (
                  <tr key={item.id || item._id}>
                    <td>{item.code || '—'}</td>
                    <td>{item.name}</td>
                    <td>{catName(item.categoryId)}</td>
                    <td>{item.unit}</td>
                    <td>{qty}</td>
                    <td>{money(item.ratePerUnit)}</td>
                    <td>{money(value)}</td>
                    <td><span className={`status-badge ${state.cls}`}>{state.label}</span></td>
                    {canManage && (
                      <td>
                        <button className="btn sec sm" onClick={() => openAdjust(item)} style={{ marginRight: 4 }}>Adjust</button>
                        <button className="btn sec sm" onClick={() => openEdit(item)} style={{ marginRight: 4 }}>Edit</button>
                        <button className="btn danger sm" onClick={() => handleDelete(item)}>Delete</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Item Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>New Item</h3>
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="filter-field"><label>Code</label><input type="text" value={createForm.code} onChange={e => setCreateForm(p => ({ ...p, code: e.target.value }))} /></div>
                <div className="filter-field"><label>Name *</label><input type="text" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="filter-field"><label>Category</label>
                  <select value={createForm.categoryId} onChange={e => setCreateForm(p => ({ ...p, categoryId: e.target.value }))}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Unit</label>
                  <select value={createForm.unit} onChange={e => setCreateForm(p => ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Min Stock Level</label><input type="number" value={createForm.minimumStockLevel} onChange={e => setCreateForm(p => ({ ...p, minimumStockLevel: e.target.value }))} /></div>
                <div className="filter-field"><label>Rate/Unit</label><input type="number" value={createForm.ratePerUnit} onChange={e => setCreateForm(p => ({ ...p, ratePerUnit: e.target.value }))} /></div>
                <div className="filter-field"><label>Opening Stock</label><input type="number" value={createForm.openingStock} onChange={e => setCreateForm(p => ({ ...p, openingStock: e.target.value }))} /></div>
                <div className="filter-field"><label>Opening Location</label>
                  <select value={createForm.openingLocationId} onChange={e => setCreateForm(p => ({ ...p, openingLocationId: e.target.value }))}>
                    <option value="">— Select —</option>
                    {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="filter-field" style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <input type="checkbox" checked={createForm.returnable} onChange={e => setCreateForm(p => ({ ...p, returnable: e.target.checked }))} />
                  <label>Returnable</label>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Edit Item</h3>
            <form onSubmit={handleEdit}>
              <div className="form-grid">
                <div className="filter-field"><label>Code</label><input type="text" value={editForm.code} onChange={e => setEditForm(p => ({ ...p, code: e.target.value }))} /></div>
                <div className="filter-field"><label>Name *</label><input type="text" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="filter-field"><label>Category</label>
                  <select value={editForm.categoryId} onChange={e => setEditForm(p => ({ ...p, categoryId: e.target.value }))}>
                    <option value="">— None —</option>
                    {categories.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Unit</label>
                  <select value={editForm.unit} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Min Stock Level</label><input type="number" value={editForm.minimumStockLevel} onChange={e => setEditForm(p => ({ ...p, minimumStockLevel: e.target.value }))} /></div>
                <div className="filter-field"><label>Rate/Unit</label><input type="number" value={editForm.ratePerUnit} onChange={e => setEditForm(p => ({ ...p, ratePerUnit: e.target.value }))} /></div>
                <div className="filter-field" style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                  <input type="checkbox" checked={editForm.returnable} onChange={e => setEditForm(p => ({ ...p, returnable: e.target.checked }))} />
                  <label>Returnable</label>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowEdit(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {showAdjust && (
        <div className="modal-overlay" onClick={() => setShowAdjust(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Adjust Stock — {showAdjust.name}</h3>
            <form onSubmit={handleAdjust}>
              <div className="form-grid">
                <div className="filter-field"><label>Adjustment Type</label>
                  <select value={adjustForm.type} onChange={e => setAdjustForm(p => ({ ...p, type: e.target.value }))}>
                    {ADJUSTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Quantity *</label><input type="number" value={adjustForm.quantity} onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))} required /></div>
                <div className="filter-field"><label>Location *</label>
                  <select value={adjustForm.locationId} onChange={e => setAdjustForm(p => ({ ...p, locationId: e.target.value }))} required>
                    <option value="">— Select —</option>
                    {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Remark</label><input type="text" value={adjustForm.remark} onChange={e => setAdjustForm(p => ({ ...p, remark: e.target.value }))} /></div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowAdjust(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Adjust'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* PUT helper — api client only has get/post/patch/delete */
function apiPut(path, body) {
  return apiRequest(path, { method: 'PUT', body });
}
