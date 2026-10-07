import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Contract (AMC / PM) List — PWA `vPM()` exact reproduction.
 *
 * PWA MENUS: admin + service_mgr have the "AMC / PM List" menu item.
 * PWA vPM: shows all company contracts (no division filter).
 * Search: 10-field case-insensitive substring (customer, phone, email,
 *   site, capacity, amcType, category, start, end, amount).
 * Table columns: Customer, Site, Category, AMC Type, Amount, Start, End,
 *   Status, PM Due.
 * Export: dlContracts -> CSV download (admin/service_mgr only).
 *
 * PWA FACT: no division restriction on viewing — any authenticated
 * company member may see the list. The menu is gated to admin/service_mgr
 * only, but the route itself enforces no role check (same as the PWA's own
 * lack of function-level role checks on the Contract view path).
 *
 * PWA FACT: no "+ New Contract" button on the list page itself. Manual
 * AMC creation is a separate route (/contracts/new). Project->Warranty
 * conversion is triggered from the project detail page.
 */

/* Status badge colours — matches PWA's own visual conventions */
function statusClass(status) {
  if (status === 'Active') return 'status-open';
  if (status === 'Expiring Soon') return 'status-pending';
  if (status === 'Expired') return 'status-lost';
  return '';
}

export default function ContractList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
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
      const data = await api.get('/api/contracts' + (qs ? '?' + qs : ''));
      setContracts(data.contracts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  /* PWA FACT: export is admin/service_mgr only (MANAGE_ROLES) */
  const canManage = ['admin', 'service_mgr'].includes(user?.role);

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const resp = await fetch(
        API_BASE_URL + '/api/contracts/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contracts.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  /* PWA FACT: contractStatus computed client-side for display */
  function computeStatus(c) {
    if (!c.endDate) return 'Expired';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(c.endDate);
    end.setHours(0, 0, 0, 0);
    if (end < today) return 'Expired';
    const soonMs = 45 * 24 * 60 * 60 * 1000;
    if (today >= new Date(end.getTime() - soonMs)) return 'Expiring Soon';
    return 'Active';
  }

  /* PWA FACT: pmDue — count of uncompleted visits where month <= current month */
  function computePmDue(c) {
    const now = new Date();
    const tm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    let count = 0;
    (c.scheduledVisits || []).forEach(v => {
      if (!v.completedDate && v.month <= tm) count++;
    });
    return count;
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>AMC / Warranty &amp; PM List</h2>
        <div className="enq-actions">
          {canManage && (
            <button className="btn pri" onClick={() => navigate('/contracts/new')}>
              + New AMC
            </button>
          )}
          {canManage && (
            <button className="btn sec" onClick={handleExport}>
              CSV Export
            </button>
          )}
        </div>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search contracts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Site</th>
                <th>Category</th>
                <th>AMC Type</th>
                <th>Amount</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>PM Due</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 && (
                <tr><td colSpan={9} className="muted">No contracts found.</td></tr>
              )}
              {contracts.map(c => {
                const status = computeStatus(c);
                const pmDue = computePmDue(c);
                return (
                  <tr key={c.id || c._id} className="clickable-row" onClick={() => navigate(`/contracts/${c.id || c._id}`)}>
                    <td>{c.customer}</td>
                    <td>{c.site}</td>
                    <td>{c.category}</td>
                    <td>{c.amcType}</td>
                    <td>{money(c.amount)}</td>
                    <td>{fmtDate(c.startDate)}</td>
                    <td>{fmtDate(c.endDate)}</td>
                    <td><span className={`status-badge ${statusClass(status)}`}>{status}</span></td>
                    <td>{pmDue > 0 ? <span style={{ color: '#c62828', fontWeight: 600 }}>{pmDue}</span> : '0'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
