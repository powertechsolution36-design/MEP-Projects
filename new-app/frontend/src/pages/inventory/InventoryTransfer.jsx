import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { UsedForPicker, ItemFilters, filterItems, EMPTY_FILTERS } from './StockPickers';

/**
 * Stock Transfer — PWA `vTransfer()` exact reproduction.
 *
 * Allows inventory/admin to transfer stock between locations.
 * PWA MENUS: admin + inventory have transfer access.
 * PWA FACT: same-location transfer blocked server-side.
 * PWA FACT: transfer creates two transactions — Transfer Out at fromLocation
 *   and Transfer In at toLocation, atomically.
 */

const MANAGE_ROLES = ['inventory', 'admin'];

export default function InventoryTransfer() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    itemId: '', fromLocationId: '', toLocationId: '', quantity: '', remark: '',
  });
  /* Owner request (26 Nov 2026): say where the stock is going to be used
     and which kind of item it is, and the two long lists below shorten to
     match. Nothing is hidden for good -- clearing a filter brings it
     back. */
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const canManage = MANAGE_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsData, locData, siteData] = await Promise.all([
        api.get('/api/inventory/items'),
        api.get('/api/inventory/locations'),
        /* Owner request (21 Nov 2026): "Customer name or site Name will
           show in Stock transfer in From location and To location." The
           same list the Issue screen offers — projects, orders, won leads,
           AMC sites and clients. */
        api.get('/api/inventory/site-options').catch(() => ({ sites: [] })),
      ]);
      setItems(itemsData.items || []);
      setLocations(locData.locations || []);
      setSites(siteData.sites || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Selected item's stock by location for guidance */
  function selectedItemStock() {
    if (!form.itemId) return [];
    const item = items.find(x => (x.id || x._id) === form.itemId);
    if (!item?.stockByLocation) return [];
    const entries = item.stockByLocation instanceof Map
      ? Array.from(item.stockByLocation.entries())
      : Object.entries(item.stockByLocation);
    return entries.map(([locId, qty]) => ({
      locId,
      locName: locations.find(l => (l.id || l._id) === locId)?.name || locId,
      qty: Number(qty) || 0,
    })).filter(e => e.qty > 0);
  }

  /* The sites, grouped by where they came from, minus any that is already
     a stock point — it is offered above under its own name. */
  const known = new Set(locations.map((l) => String(l.name || '').trim().toLowerCase()));
  const siteGroups = [];
  for (const s of sites) {
    const name = String(s.label || '').trim();
    if (!name || known.has(name.toLowerCase())) continue;
    const group = s.group || 'Sites';
    const row = siteGroups.find((g) => g[0] === group);
    if (row) { if (!row[1].includes(name)) row[1].push(name); } else siteGroups.push([group, [name]]);
  }
  /* "Used for" decides which kind of place the destination list offers.
     Stock point means the company's own locations. */
  const wantKind = filters.usedFor;
  const showStockPoints = !wantKind || wantKind === 'Stock point';
  const destGroups = wantKind && wantKind !== 'Stock point'
    ? siteGroups.filter(([g]) => g === wantKind)
    : siteGroups;
  const pickable = filterItems(items, filters);

  async function handleTransfer(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      /* A value of "name:<site>" is a place that is not a stock point yet.
         The server matches it to one by name, or makes it as it saves. */
      const end = (value, idKey, nameKey) => (String(value).startsWith('name:')
        ? { [nameKey]: String(value).slice(5) }
        : { [idKey]: value });
      await api.post('/api/inventory/transfers', {
        itemId: form.itemId,
        ...end(form.fromLocationId, 'fromLocationId', 'fromLocationName'),
        ...end(form.toLocationId, 'toLocationId', 'toLocationName'),
        quantity: Number(form.quantity) || 0,
        remark: form.remark || undefined,
      });
      setForm({ itemId: '', fromLocationId: '', toLocationId: '', quantity: '', remark: '' });
      alert('Stock transferred successfully.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to transfer stock.</p>
        </div>
      </div>
    );
  }

  const stockEntries = selectedItemStock();

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Stock Transfer</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <div className="panel">
          <form onSubmit={handleTransfer}>
            {/* Where it is going, and which kind of item (26 Nov 2026). */}
            <div className="form-grid stock-filter-row">
              <UsedForPicker
                sites={sites}
                value={filters.usedFor}
                onChange={v => {
                  setFilters(f => ({ ...f, usedFor: v }));
                  setForm(p => ({ ...p, toLocationId: '' }));
                }}
                label="Used for"
              />
              <ItemFilters
                value={filters}
                onChange={next => {
                  setFilters(next);
                  const still = filterItems(items, next)
                    .some(i => String(i.id || i._id) === String(form.itemId));
                  if (!still) setForm(p => ({ ...p, itemId: '' }));
                }}
              />
            </div>

            <div className="form-grid">
              <div className="filter-field"><label>Item *</label>
                <select value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))} required>
                  <option value="">— Select Item —</option>
                  {pickable.map(i => (
                    <option key={i.id || i._id} value={i.id || i._id}>
                      {i.name} ({i.code || '—'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="filter-field"><label>From Location *</label>
                <select value={form.fromLocationId} onChange={e => setForm(p => ({ ...p, fromLocationId: e.target.value }))} required>
                  <option value="">— Select —</option>
                  <optgroup label="Stock points">
                    {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                  </optgroup>
                  {siteGroups.map(([group, rows]) => (
                    <optgroup key={group} label={group}>
                      {rows.map((siteName) => (
                        <option key={siteName} value={`name:${siteName}`}>{siteName}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="filter-field"><label>To Location *</label>
                <select value={form.toLocationId} onChange={e => setForm(p => ({ ...p, toLocationId: e.target.value }))} required>
                  <option value="">— Select —</option>
                  {showStockPoints && (
                    <optgroup label="Stock points">
                      {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                    </optgroup>
                  )}
                  {destGroups.map(([group, rows]) => (
                    <optgroup key={group} label={group}>
                      {rows.map((siteName) => (
                        <option key={siteName} value={`name:${siteName}`}>{siteName}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="filter-field"><label>Quantity *</label>
                <input type="number" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} required min="1" />
              </div>
              <div className="filter-field"><label>Remark</label>
                <input type="text" value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
            </div>

            <p className="muted" style={{ margin: '6px 0 0', fontSize: '.86em' }}>
              {pickable.length} of {items.length} item{items.length === 1 ? '' : 's'} match.
            </p>

            {/* Stock guidance for selected item */}
            {stockEntries.length > 0 && (
              <div style={{ margin: '12px 0', fontSize: '0.9em', color: '#555' }}>
                <strong>Current stock:</strong>{' '}
                {stockEntries.map(e => `${e.locName}: ${e.qty}`).join(', ')}
              </div>
            )}

            <div className="modal-actions">
              <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Transferring...' : 'Transfer'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
