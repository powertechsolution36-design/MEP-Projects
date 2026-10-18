import { useState, useEffect } from 'react';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';

/**
 * Inventory Transaction History — PWA transaction log exact reproduction.
 *
 * Shows transaction CSV export (the primary report mechanism in PWA).
 * PWA MENUS: admin + inventory only.
 * PWA FACT: 8 transaction types: Purchase In, Opening Stock, Damage / Write-off,
 *   Adjustment, Issue, Return, Transfer In, Transfer Out.
 * PWA FACT: transactions are append-only — no edit/delete.
 */

const MANAGE_ROLES = ['inventory', 'admin'];

export default function InventoryHistory() {
  const { user } = useAuth();
  const [error, setError] = useState(null);
  const [txns, setTxns] = useState([]);
  const [search, setSearch] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);

  // PWA FACT (vInvHistory): the ledger is shown on screen, newest first.
  useEffect(() => {
    if (!canManage) return;
    api.get('/api/inventory/transactions')
      .then(d => setTxns(d.transactions || []))
      .catch(err => setError(err.message));
  }, [canManage]);

  async function handleExport() {
    setError(null);
    try {
      const resp = await fetch(
        API_BASE_URL + '/api/inventory/reports/transactions.csv',
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory-transaction-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to view inventory transactions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Inventory Transactions</h2>
        <div className="enq-actions">
          <button className="btn pri" onClick={handleExport}>Export Transaction Report (CSV)</button>
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div className="panel">
        <div className="search-bar">
          <input placeholder="Search item, type, location, reference..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th><th>From</th><th>To</th><th>Reference</th><th>By</th><th>Remark</th></tr></thead>
            <tbody>
              {txns.filter(t => !search || [t.type, t.itemName, t.itemCode, t.fromLocationName, t.toLocationName, t.referenceText, t.recordedByName, t.remark]
                .join(' ').toLowerCase().includes(search.toLowerCase())).map(t => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td><td>{t.type}</td><td><b>{t.itemName}</b></td><td>{t.quantity} {t.unit}</td>
                  <td>{t.fromLocationName || '—'}</td><td>{t.toLocationName || '—'}</td><td>{t.referenceText || '—'}</td>
                  <td>{t.recordedByName}</td><td>{t.remark || '—'}</td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td colSpan={9} className="muted">No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
