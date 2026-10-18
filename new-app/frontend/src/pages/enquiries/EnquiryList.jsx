import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getStoredToken, assertDownloadOk } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { todayKey } from '../../utils/platform';
import { EnquiryFilterPanel, EnquiryTable, filterParams } from './EnquiryFilterPanel';

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

export default function EnquiryList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // PWA FACT: goSeg(k) (index.html:1607) — a dashboard segment row opens
  // the enquiry list pre-filtered to that segment (?segment=HVAC).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => (searchParams.get('segment') ? { segment: searchParams.get('segment') } : {}));
  const [showFilters, setShowFilters] = useState(() => Boolean(searchParams.get('segment')));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterParams(filters);
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
      const params = filterParams(filters);
      const qs = params.toString();
      const resp = await fetch(
        API_BASE_URL + '/api/enquiries/export.csv' + (qs ? '?' + qs : ''),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      await assertDownloadOk(resp); // a refused export must not be saved as a file
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `enquiries-${todayKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }


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
        <EnquiryFilterPanel
          rows={enquiries}
          filters={filters}
          setFilter={setFilter}
          clearFilters={clearFilters}
          showStatus
        />
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading enquiries...</p>
      ) : enquiries.length === 0 ? (
        <p className="muted">No enquiries found.</p>
      ) : (
        <EnquiryTable
          rows={enquiries}
          todayKey={todayKey()}
          onOpen={(e) => navigate(`/enquiries/${e.id}`)}
        />
      )}
    </div>
  );
}
