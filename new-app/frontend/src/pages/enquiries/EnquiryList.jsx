import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import './enquiry.css';

/**
 * Enquiry List — PWA `vEnqs()` / `enqTable()` exact reproduction.
 *
 * PWA MENUS: only sales + admin have the Enquiries menu item.
 * PWA vEnqs: shows all non-Lost enquiries by default.
 * PWA "+ New Enquiry" button: shown ONLY for sales (not admin).
 * Filters: q, seg, siteType, rating, status, ref, from/to, ndFrom/ndTo, vmin/vmax
 * Table columns: #, Project/Address, Site Type, Cap., Customer, Reference,
 *   Segment, Rating, Action Done, Next Action, Next Date, Value, Status
 * Export: dlEnq -> CSV download
 */

const SITE_TYPES = ['Residential', 'Commercial', 'Factory', 'Banquet Hall', 'Hospital', 'Office'];
const SEGMENTS = ['HVAC', 'Solar', 'MEP', 'AMC'];
const RATINGS = ['1', '2', '3', '4', '5'];

export default function EnquiryList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.segment) params.set('segment', filters.segment);
      if (filters.siteType) params.set('siteType', filters.siteType);
      if (filters.rating) params.set('rating', filters.rating);
      if (filters.referenceSource) params.set('referenceSource', filters.referenceSource);
      if (filters.reviewFrom) params.set('reviewFrom', filters.reviewFrom);
      if (filters.reviewTo) params.set('reviewTo', filters.reviewTo);
      if (filters.nextActionFrom) params.set('nextActionFrom', filters.nextActionFrom);
      if (filters.nextActionTo) params.set('nextActionTo', filters.nextActionTo);
      if (filters.valueMin) params.set('valueMin', filters.valueMin);
      if (filters.valueMax) params.set('valueMax', filters.valueMax);
      const qs = params.toString();
      const data = await api.get('/api/enquiries' + (qs ? '?' + qs : ''));
      setEnquiries(data.enquiries || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  function setFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }
  function clearFilters() {
    setFilters({});
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.segment) params.set('segment', filters.segment);
      if (filters.siteType) params.set('siteType', filters.siteType);
      if (filters.rating) params.set('rating', filters.rating);
      const qs = params.toString();
      const resp = await fetch(
        API_BASE_URL + '/api/enquiries/export.csv' + (qs ? '?' + qs : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'enquiries.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  // Unique values for filter dropdowns (derived from data, PWA pattern)
  const refs = [...new Set(enquiries.map(e => e.referenceSource).filter(Boolean))].sort();

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>📋 Enquiries</h2>
        <div className="enq-actions">
          <button className="btn sec sm" onClick={() => setShowFilters(!showFilters)}>
            🔎 {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
          <button className="btn sec sm" onClick={handleExport}>📥 Export CSV</button>
          {/* PWA FACT: "+ New Enquiry" shown only for sales, NOT admin */}
          {user?.role === 'sales' && (
            <button className="btn pri sm" onClick={() => navigate('/enquiries/new')}>+ New Enquiry</button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="panel filter-panel">
          <div className="filter-head">
            <h3>🔎 Filters & Search</h3>
            <button className="btn sec sm" onClick={clearFilters}>Clear all</button>
          </div>
          <label>Search (project, customer, reference, remark, action)</label>
          <input
            value={filters.q || ''}
            placeholder="type and press Enter..."
            onKeyDown={e => e.key === 'Enter' && setFilter('q', e.target.value)}
            onChange={e => setFilter('q', e.target.value)}
          />
          <div className="filter-grid">
            <FilterSelect label="Segment" value={filters.segment} options={SEGMENTS} onChange={v => setFilter('segment', v)} />
            <FilterSelect label="Site Type" value={filters.siteType} options={SITE_TYPES} onChange={v => setFilter('siteType', v)} />
            <FilterSelect label="Rating" value={filters.rating} options={RATINGS} onChange={v => setFilter('rating', v)} />
            <FilterSelect label="Reference" value={filters.referenceSource} options={refs} onChange={v => setFilter('referenceSource', v)} />
          </div>
          <div className="filter-grid">
            <div className="filter-field">
              <label>Review From</label>
              <input type="date" value={filters.reviewFrom || ''} onChange={e => setFilter('reviewFrom', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Review To</label>
              <input type="date" value={filters.reviewTo || ''} onChange={e => setFilter('reviewTo', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Next Date From</label>
              <input type="date" value={filters.nextActionFrom || ''} onChange={e => setFilter('nextActionFrom', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Next Date To</label>
              <input type="date" value={filters.nextActionTo || ''} onChange={e => setFilter('nextActionTo', e.target.value)} />
            </div>
          </div>
          <div className="filter-grid">
            <div className="filter-field">
              <label>Value Min</label>
              <input type="number" value={filters.valueMin || ''} onChange={e => setFilter('valueMin', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Value Max</label>
              <input type="number" value={filters.valueMax || ''} onChange={e => setFilter('valueMax', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading enquiries...</p>
      ) : enquiries.length === 0 ? (
        <p className="muted">No enquiries found.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Project/Address</th>
                <th>Site Type</th>
                <th>Cap.</th>
                <th>Customer</th>
                <th>Reference</th>
                <th>Segment</th>
                <th>Rating</th>
                <th>Action Done</th>
                <th>Next Action</th>
                <th>Next Date</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e, i) => (
                <tr key={e.id} className="clickable-row" onClick={() => navigate(`/enquiries/${e.id}`)}>
                  <td>{i + 1}</td>
                  <td>{e.name}</td>
                  <td>{e.siteType}</td>
                  <td>{e.capacity}</td>
                  <td>{e.phone}</td>
                  <td>{e.referenceSource}</td>
                  <td>{e.segment}</td>
                  <td>{e.rating}</td>
                  <td>{e.lastActionDone}</td>
                  <td>{e.nextActionDescription}</td>
                  <td>{fmtDate(e.nextActionDate)}</td>
                  <td>{money(e.estimatedValue)}</td>
                  <td><span className={`status-badge status-${(e.status || '').toLowerCase()}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <div className="filter-field">
      <label>{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
