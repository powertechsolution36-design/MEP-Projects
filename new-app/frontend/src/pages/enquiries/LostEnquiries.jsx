import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { money, fmtDate } from '../../utils/format';
import './enquiry.css';

/**
 * Lost Enquiries — PWA `vLost()` exact reproduction.
 *
 * Same table/filter structure as EnquiryList but scoped to status=Lost.
 * Uses GET /api/enquiries/lost (which returns only Lost enquiries).
 * No "+ New Enquiry" button on this screen.
 */

export default function LostEnquiries() {
  const navigate = useNavigate();
  const [enquiries, setEnquiries] = useState([]);
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
      const data = await api.get('/api/enquiries/lost' + (qs ? '?' + qs : ''));
      setEnquiries(data.enquiries || []);
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
      params.set('lost', 'true');
      if (search) params.set('q', search);
      const resp = await fetch(
        API_BASE_URL + '/api/enquiries/export.csv?' + params.toString(),
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lost-enquiries.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>❌ Lost Enquiries</h2>
        <div className="enq-actions">
          <button className="btn sec sm" onClick={handleExport}>📥 Export CSV</button>
        </div>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search lost enquiries..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : enquiries.length === 0 ? (
        <p className="muted">No lost enquiries found.</p>
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
                <th>Lost Reason</th>
                <th>Lost Date</th>
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
                  <td>{e.lostReason}</td>
                  <td>{fmtDate(e.lostDate)}</td>
                  <td>{money(e.estimatedValue)}</td>
                  <td><span className="status-badge status-lost">Lost</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
