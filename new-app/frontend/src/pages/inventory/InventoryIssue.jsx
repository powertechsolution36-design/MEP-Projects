import { useState, useEffect, useCallback } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import { ReturnModal, MarkUsedModal, issueBalance, issueStatusClass } from './IssueActions';

/**
 * Issue Material — PWA `vIssue()` exact reproduction.
 *
 * Shows issued material list + issue form.
 * PWA MENUS: admin + inventory have issue access.
 * PWA FACT: MANAGE_ROLES only (inventory, admin).
 */

const MANAGE_ROLES = ['inventory', 'admin'];

function totalQty(item) {
  const sbl = item.stockByLocation || {};
  return Object.values(sbl).reduce((s, v) => s + (Number(v) || 0), 0);
}

export default function InventoryIssue() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const emptyForm = { itemId: '', quantity: '1', staffId: '', siteIndex: '0', fromLocationId: '', date: today, remark: '' };
  const [showIssue, setShowIssue] = useState(false);
  const [issueForm, setIssueForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [returnTarget, setReturnTarget] = useState(null);
  const [usedTarget, setUsedTarget] = useState(null);

  const canManage = MANAGE_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsData, locData, issData, staffData, siteData] = await Promise.all([
        api.get('/api/inventory/items'),
        api.get('/api/inventory/locations'),
        api.get('/api/inventory/issues'),
        api.get('/api/inventory/recipient-candidates').catch(() => ({ candidates: [] })),
        api.get('/api/inventory/site-options').catch(() => ({ sites: [] })),
      ]);
      setItems(itemsData.items || []);
      setLocations(locData.locations || []);
      setIssues(issData.issues || []);
      setUsers(staffData.candidates || []);
      setSites(siteData.sites || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (canManage) load(); }, [load, canManage]);

  const inStock = items.filter(i => totalQty(i) > 0);

  function openIssue() {
    if (!inStock.length) { alert('No stock available to issue'); return; }
    setIssueForm({
      ...emptyForm,
      itemId: inStock[0].id,
      fromLocationId: locations[0]?.id || '',
      staffId: users[0]?.id || '',
    });
    setShowIssue(true);
  }

  async function handleIssue(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const site = sites[Number(issueForm.siteIndex)] || { label: '', projectId: null };
      await api.post('/api/inventory/issues', {
        itemId: issueForm.itemId,
        quantity: Number(issueForm.quantity) || 0,
        staffId: issueForm.staffId,
        site: site.label,
        projectId: site.projectId || undefined,
        fromLocationId: issueForm.fromLocationId,
        date: issueForm.date || undefined,
        remark: issueForm.remark || undefined,
      });
      setShowIssue(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/issued.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'issued-material-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel"><p className="muted">You do not have permission to issue material.</p></div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = q
    ? issues.filter(x => [x.staffName, x.site, x.date && fmtDate(x.date), x.status, x.remark, x.issuedByName, x.itemName, x.itemCode]
        .join(' ').toLowerCase().includes(q))
    : issues;

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Issue Material to Staff</h2>
        <div className="enq-actions">
          <button className="btn pri" onClick={openIssue}>+ Issue Material</button>
          <button className="btn sec" onClick={handleExport}>⬇ Report</button>
        </div>
      </div>
      <p className="muted">Choose the staff member and the site — both come from the system. Issued material shows on that person's own login under <b>My Material</b>.</p>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <div className="panel">
          <div className="search-bar">
            <input placeholder="Search staff, site, item, status..." value={search} onChange={e => setSearch(e.target.value)} />
            <span className="muted">{rows.length} of {issues.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Staff</th><th>Site</th><th>From Location</th><th>Returned</th><th>Balance</th><th>Status</th><th>Issued By</th><th></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={12} className="muted">No material issued yet.</td></tr>}
                {rows.map(x => {
                  const bal = issueBalance(x);
                  return (
                    <tr key={x.id} style={bal > 0 ? { background: '#fffaf0' } : undefined}>
                      <td>{fmtDate(x.date)}</td>
                      <td><b>{x.itemName}</b><div className="muted">{x.itemCode}</div></td>
                      <td>{x.returnable ? 'Returnable' : 'Non-returnable'}</td>
                      <td>{x.quantityIssued} {x.unit}</td>
                      <td><b>{x.staffName}</b></td>
                      <td>{x.site}</td>
                      <td>{x.fromLocationName}</td>
                      <td>{Number(x.quantityReturned) || '—'}</td>
                      <td>{bal > 0 ? bal : '—'}</td>
                      <td><span className={`status-badge ${issueStatusClass(x.status)}`}>{x.status}</span></td>
                      <td>{x.issuedByName}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {bal > 0 && (
                          <>
                            <button className="btn sm pri" onClick={() => setReturnTarget(x)}>Return</button>{' '}
                            <button className="btn sm sec" onClick={() => setUsedTarget(x)}>Mark Used</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showIssue && (
        <div className="modal-overlay" onClick={() => setShowIssue(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Issue Material</h3>
            <form onSubmit={handleIssue}>
              <div className="form-grid">
                <div className="filter-field"><label>Item *</label>
                  <select value={issueForm.itemId} onChange={e => setIssueForm(p => ({ ...p, itemId: e.target.value }))} required>
                    {inStock.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.code ? `${i.code} — ` : ''}{i.name} ({totalQty(i)} {i.unit} available){i.returnable ? ' · returnable' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-field"><label>From Location *</label>
                  <select value={issueForm.fromLocationId} onChange={e => setIssueForm(p => ({ ...p, fromLocationId: e.target.value }))} required>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Quantity *</label>
                  <input type="number" min="1" value={issueForm.quantity} onChange={e => setIssueForm(p => ({ ...p, quantity: e.target.value }))} required />
                </div>
                <div className="filter-field"><label>Date</label>
                  <input type="date" value={issueForm.date} onChange={e => setIssueForm(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div className="filter-field"><label>Issue To (staff) *</label>
                  <select value={issueForm.staffId} onChange={e => setIssueForm(p => ({ ...p, staffId: e.target.value }))} required>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div className="filter-field"><label>Site / Project *</label>
                  <select value={issueForm.siteIndex} onChange={e => setIssueForm(p => ({ ...p, siteIndex: e.target.value }))}>
                    {sites.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                  </select>
                </div>
                <div className="filter-field full-width"><label>Remark</label>
                  <input type="text" value={issueForm.remark} onChange={e => setIssueForm(p => ({ ...p, remark: e.target.value }))} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn sec" onClick={() => setShowIssue(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={saving}>{saving ? 'Issuing...' : 'Issue Material'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {returnTarget && (
        <ReturnModal issue={returnTarget} locations={locations}
          onClose={() => setReturnTarget(null)}
          onDone={() => { setReturnTarget(null); load(); }} />
      )}
      {usedTarget && (
        <MarkUsedModal issue={usedTarget}
          onClose={() => setUsedTarget(null)}
          onDone={() => { setUsedTarget(null); load(); }} />
      )}
    </div>
  );
}
