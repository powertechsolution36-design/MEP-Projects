import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Service Call List — PWA `viewServiceCalls()` exact reproduction.
 *
 * PWA MENUS: admin + service_mgr have the "Service Calls" menu item.
 * PWA FACT: list is admin/service_mgr only (MANAGE_ROLES).
 * PWA FACT: newest-first display (server returns `.slice().reverse()`).
 * PWA FACT: 9-field case-insensitive search (complaintNumber, customer,
 *   phone, site, engineerName, status, type, serviceType, complaintDescription).
 * Table columns: #, Type, Customer, Phone, Site, Date, Status, Engineer, Amount.
 * Export: CSV download (admin/service_mgr only).
 */

const MANAGE_ROLES = ['admin', 'service_mgr'];

function statusClass(status) {
  if (status === 'Registered') return 'status-pending';
  if (status === 'Assigned') return 'status-open';
  if (status === 'Scheduled') return 'status-won';
  if (status === 'Completed') return 'status-received';
  return '';
}

export default function ServiceCallList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const canManage = MANAGE_ROLES.includes(user?.role);

  /* Engineer name map for display (backend list returns engineerId only) */
  const [engineerMap, setEngineerMap] = useState({});
  useEffect(() => {
    api.get('/api/service-calls/engineer-candidates')
      .then(data => {
        const map = {};
        (data.candidates || []).forEach(c => { map[c.id] = c.name; });
        setEngineerMap(map);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const qs = params.toString();
      const data = await api.get('/api/service-calls' + (qs ? '?' + qs : ''));
      setCalls(data.serviceCalls || []);
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
        API_BASE_URL + '/api/service-calls/export.csv' + (params.toString() ? '?' + params.toString() : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'service-calls.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  /* Role gate: only MANAGE_ROLES can see the list (PWA exact) */
  if (!canManage) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to view service calls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Service Calls</h2>
        <div className="enq-actions">
          <button className="btn pri" onClick={() => navigate('/service-calls/new')}>
            + Register Complaint
          </button>
          <button className="btn sec" onClick={handleExport}>
            CSV Export
          </button>
        </div>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search service calls..."
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
                <th>#</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Site</th>
                <th>Date</th>
                <th>Status</th>
                <th>Engineer</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {calls.length === 0 && (
                <tr><td colSpan={9} className="muted">No service calls found.</td></tr>
              )}
              {calls.map(c => (
                <tr
                  key={c.id || c._id}
                  className="clickable-row"
                  onClick={() => navigate(`/service-calls/${c.id || c._id}`)}
                >
                  <td>{c.complaintNumber || '—'}</td>
                  <td>{c.type || '—'}</td>
                  <td>{c.customer || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.site || '—'}</td>
                  <td>{fmtDate(c.appointmentDate || c.registeredDate)}</td>
                  <td><span className={`status-badge ${statusClass(c.status)}`}>{c.status}</span></td>
                  <td>{engineerMap[c.engineerId] || '—'}</td>
                  <td>{c.report?.amount ? money(c.report.amount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
