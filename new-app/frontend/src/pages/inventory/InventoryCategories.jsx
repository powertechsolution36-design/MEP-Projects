import { useState, useEffect, useCallback } from 'react';
import { api, apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import '../enquiries/enquiry.css';

/**
 * Categories & Locations — PWA `vCat()` + `vLoc()` exact reproduction.
 *
 * CRUD for inventory categories and storage locations on one page.
 * PWA MENUS: admin + inventory only.
 * PWA FACT: category delete blocked if any item references it.
 * PWA FACT: location delete blocked if any item has stock at that location.
 */

const MANAGE_ROLES = ['inventory', 'admin'];

export default function InventoryCategories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  /* Category modals */
  const [showCreateCat, setShowCreateCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [editCat, setEditCat] = useState(null);
  const [editCatName, setEditCatName] = useState('');

  /* Location modals */
  const [showCreateLoc, setShowCreateLoc] = useState(false);
  const [locName, setLocName] = useState('');
  const [editLoc, setEditLoc] = useState(null);
  const [editLocName, setEditLocName] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catData, locData] = await Promise.all([
        api.get('/api/inventory/categories'),
        api.get('/api/inventory/locations'),
      ]);
      setCategories(catData.categories || []);
      setLocations(locData.locations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* PUT helper */
  function apiPut(path, body) {
    return apiRequest(path, { method: 'PUT', body });
  }

  /* ---- Category CRUD ---- */
  async function handleCreateCat(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/inventory/categories', { name: catName });
      setShowCreateCat(false);
      setCatName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditCat(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const id = editCat.id || editCat._id;
      await apiPut(`/api/inventory/categories/${id}`, { name: editCatName });
      setEditCat(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCat(cat) {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api.delete(`/api/inventory/categories/${cat.id || cat._id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  /* ---- Location CRUD ---- */
  async function handleCreateLoc(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/inventory/locations', { name: locName });
      setShowCreateLoc(false);
      setLocName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditLoc(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const id = editLoc.id || editLoc._id;
      await apiPut(`/api/inventory/locations/${id}`, { name: editLocName });
      setEditLoc(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLoc(loc) {
    if (!window.confirm(`Delete location "${loc.name}"?`)) return;
    try {
      await api.delete(`/api/inventory/locations/${loc.id || loc._id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to manage categories and locations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Categories &amp; Locations</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <>
          {/* ── Categories ── */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Categories</h3>
              <button className="btn pri sm" onClick={() => setShowCreateCat(true)}>+ Add Category</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th style={{ width: 160 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {categories.length === 0 && (
                    <tr><td colSpan={2} className="muted">No categories.</td></tr>
                  )}
                  {categories.map(c => (
                    <tr key={c.id || c._id}>
                      <td>{c.name}</td>
                      <td>
                        <button className="btn sec sm" onClick={() => { setEditCat(c); setEditCatName(c.name); }} style={{ marginRight: 4 }}>Rename</button>
                        <button className="btn danger sm" onClick={() => handleDeleteCat(c)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Locations ── */}
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Storage Locations</h3>
              <button className="btn pri sm" onClick={() => setShowCreateLoc(true)}>+ Add Location</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th style={{ width: 160 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {locations.length === 0 && (
                    <tr><td colSpan={2} className="muted">No locations.</td></tr>
                  )}
                  {locations.map(l => (
                    <tr key={l.id || l._id}>
                      <td>{l.name}</td>
                      <td>
                        <button className="btn sec sm" onClick={() => { setEditLoc(l); setEditLocName(l.name); }} style={{ marginRight: 4 }}>Rename</button>
                        <button className="btn danger sm" onClick={() => handleDeleteLoc(l)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Create Category Modal */}
      {showCreateCat && (
        <div className="modal-overlay" onClick={() => setShowCreateCat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Category</h3>
            <form onSubmit={handleCreateCat}>
              <div className="form-grid">
                <div className="filter-field"><label>Name *</label>
                  <input type="text" value={catName} onChange={e => setCatName(e.target.value)} required autoFocus />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowCreateCat(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Category Modal */}
      {editCat && (
        <div className="modal-overlay" onClick={() => setEditCat(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Rename Category</h3>
            <form onSubmit={handleEditCat}>
              <div className="form-grid">
                <div className="filter-field"><label>Name *</label>
                  <input type="text" value={editCatName} onChange={e => setEditCatName(e.target.value)} required autoFocus />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setEditCat(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Location Modal */}
      {showCreateLoc && (
        <div className="modal-overlay" onClick={() => setShowCreateLoc(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Location</h3>
            <form onSubmit={handleCreateLoc}>
              <div className="form-grid">
                <div className="filter-field"><label>Name *</label>
                  <input type="text" value={locName} onChange={e => setLocName(e.target.value)} required autoFocus />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowCreateLoc(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Location Modal */}
      {editLoc && (
        <div className="modal-overlay" onClick={() => setEditLoc(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Rename Location</h3>
            <form onSubmit={handleEditLoc}>
              <div className="form-grid">
                <div className="filter-field"><label>Name *</label>
                  <input type="text" value={editLocName} onChange={e => setEditLocName(e.target.value)} required autoFocus />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setEditLoc(null)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
