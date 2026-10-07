import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import '../enquiries/enquiry.css';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    itemId: '', fromLocationId: '', toLocationId: '', quantity: '', remark: '',
  });

  const canManage = MANAGE_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsData, locData] = await Promise.all([
        api.get('/api/inventory/items'),
        api.get('/api/inventory/locations'),
      ]);
      setItems(itemsData.items || []);
      setLocations(locData.locations || []);
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

  async function handleTransfer(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/inventory/transfers', {
        itemId: form.itemId,
        fromLocationId: form.fromLocationId,
        toLocationId: form.toLocationId,
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
            <div className="form-grid">
              <div className="filter-field"><label>Item *</label>
                <select value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))} required>
                  <option value="">— Select Item —</option>
                  {items.map(i => <option key={i.id || i._id} value={i.id || i._id}>{i.name} ({i.code || '—'})</option>)}
                </select>
              </div>
              <div className="filter-field"><label>From Location *</label>
                <select value={form.fromLocationId} onChange={e => setForm(p => ({ ...p, fromLocationId: e.target.value }))} required>
                  <option value="">— Select —</option>
                  {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                </select>
              </div>
              <div className="filter-field"><label>To Location *</label>
                <select value={form.toLocationId} onChange={e => setForm(p => ({ ...p, toLocationId: e.target.value }))} required>
                  <option value="">— Select —</option>
                  {locations.map(l => <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>)}
                </select>
              </div>
              <div className="filter-field"><label>Quantity *</label>
                <input type="number" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} required min="1" />
              </div>
              <div className="filter-field"><label>Remark</label>
                <input type="text" value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
            </div>

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
