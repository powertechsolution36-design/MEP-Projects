import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Sales Order List — PWA `vSOs()` exact reproduction.
 *
 * PWA MENUS: admin, sales, hvac_pm, solar_pm, mep_pm, finance have the SO menu item.
 * PWA "+ New SO" button: shown ONLY for sales/admin.
 * Table columns: SO No, Project, Division, Start, Total Cost, Received, Pending.
 * Search: free-text over SO fields.
 * Export: dlSOs -> CSV.
 */

export default function SalesOrderList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const qs = params.toString();
      const data = await api.get('/api/sales-orders' + (qs ? '?' + qs : ''));
      setOrders(data.salesOrders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const resp = await fetch(
        API_BASE_URL + '/api/sales-orders/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sales-orders.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  const canCreate = ['sales', 'admin'].includes(user?.role);

  return (
    <div className="so-page">
      <div className="so-header">
        <h2>🧾 Sales Orders</h2>
        <div className="so-actions">
          <button className="btn sec sm" onClick={handleExport}>📥 Export CSV</button>
          {/* PWA FACT: "+ New SO" button only for sales/admin */}
          {canCreate && (
            <button className="btn pri sm" onClick={() => navigate('/sales-orders/new')}>+ New SO</button>
          )}
        </div>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search sales orders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading sales orders...</p>
      ) : orders.length === 0 ? (
        <p className="muted">No sales orders found.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SO No</th>
                <th>Project</th>
                <th>Division</th>
                <th>Start</th>
                <th>Total Cost</th>
                <th>Received</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(so => (
                <tr key={so.id} className="clickable-row" onClick={() => navigate(`/sales-orders/${so.id}`)}>
                  <td>SO-{so.orderNumber}</td>
                  <td>{so.projectName}</td>
                  <td>{so.division}</td>
                  <td>{so.startDate ? new Date(so.startDate).toISOString().slice(0, 10) : ''}</td>
                  <td>{money(so.totalCost)}</td>
                  <td>{money(so.paySummary?.received)}</td>
                  <td>{money(so.paySummary?.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
