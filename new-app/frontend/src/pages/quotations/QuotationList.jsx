import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { money, fmtDate } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import '../enquiries/enquiry.css';

/**
 * Quotation list — admin, sales, finance roles.
 *
 * API: GET /api/quotations?division=&status=&customerName=
 *      GET /api/quotations/export/csv
 */

const STATUS_OPTIONS = ['', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Revised', 'Cancelled'];

export default function QuotationList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreate = ['admin', 'sales'].includes(user?.role);

  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [divFilter, setDivFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (divFilter) params.set('division', divFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const data = await api.get(`/api/quotations${qs ? '?' + qs : ''}`);
      setQuotations(data.quotations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [divFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = quotations.filter(q => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (q.quotationNumber || '').toLowerCase().includes(s) ||
           (q.customerName || '').toLowerCase().includes(s) ||
           (q.subject || '').toLowerCase().includes(s);
  });

  async function handleExportCsv() {
    try {
      const token = localStorage.getItem('mep_new_app_token');
      const resp = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'}/api/quotations/export/csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'quotations.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
  }

  function statusClass(status) {
    switch (status) {
      case 'Draft': return 'status-pending';
      case 'Sent': return 'status-open';
      case 'Accepted': return 'status-won';
      case 'Rejected': return 'status-lost';
      case 'Revised': return 'status-pending';
      case 'Cancelled': return 'status-lost';
      default: return '';
    }
  }

  return (
    <div className="enq-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Quotations</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sec sm" onClick={handleExportCsv}>Export CSV</button>
          {canCreate && <button className="btn pri" onClick={() => navigate('/quotations/new')}>+ New Quotation</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="search-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Search by number, customer, subject…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <DivisionSelector value={divFilter} onChange={setDivFilter} allOption />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Quotation #</th>
              <th>Date</th>
              <th>Division</th>
              <th>Customer</th>
              <th>Subject</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888' }}>No quotations found.</td></tr>
            ) : filtered.map(q => (
              <tr key={q.id} onClick={() => navigate(`/quotations/${q.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong>{q.quotationNumber}</strong></td>
                <td>{fmtDate(q.date)}</td>
                <td>{q.division}</td>
                <td>{q.customerName}</td>
                <td>{q.subject || '—'}</td>
                <td><span className={`status-badge ${statusClass(q.status)}`}>{q.status}</span></td>
                <td style={{ textAlign: 'right' }}>{money(q.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
