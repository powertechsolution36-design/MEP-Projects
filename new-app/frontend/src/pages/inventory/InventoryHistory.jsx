import { useState } from 'react';
import { getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import '../enquiries/enquiry.css';

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

  const canManage = MANAGE_ROLES.includes(user?.role);

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
        <p className="muted">
          Inventory transactions are append-only. Use the CSV export to view the full
          transaction history including all 8 types: Purchase In, Opening Stock,
          Damage / Write-off, Adjustment, Issue, Return, Transfer In, Transfer Out.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Stock adjustments are made from the <strong>Stock</strong> page.
          Issues and returns are managed from their respective pages.
          Transfers are done from the <strong>Stock Transfer</strong> page.
        </p>
      </div>
    </div>
  );
}
