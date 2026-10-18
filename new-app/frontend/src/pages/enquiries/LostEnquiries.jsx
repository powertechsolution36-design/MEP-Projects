import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { money, fmtDate } from '../../utils/format';
import { todayKey } from '../../utils/platform';
import { EnquiryFilterPanel, EnquiryTable, filterParams } from './EnquiryFilterPanel';

/**
 * Lost Enquiries — PWA `vLost()` (MEP_PROJECTS_PWA/index.html:1889-1900).
 *
 * PWA FACT (index.html:1890-1893): the screen scopes to `status === "Lost"`,
 * reverses the rows (newest first), and shows two red KPI cards computed
 * over the UNFILTERED lost set:
 *   kpi(all.length,"Lost Enquiries","r")
 *   kpi(money(sum(value)),"Total Lost Value","r")
 * while the panel heading shows the FILTERED counts:
 *   'Lost Enquiries <span>(N of M, ₹X)</span>'   (index.html:1895)
 * That asymmetry is deliberate in the PWA and is reproduced here: the cards
 * state the size of the problem, the heading states what you are looking at.
 *
 * PWA FACT (index.html:1894): the filter bar is `enqFilterBar(all,false)` —
 * the same bar as the Enquiry List with the Status select left out — and the
 * table is `enqTable(rows)` verbatim, so both come from the shared
 * EnquiryFilterPanel module rather than a second copy here.
 *
 * Deviation, carried over deliberately: this screen also shows Lost Reason
 * and Lost On as two extra columns. The PWA shows them only on the enquiry
 * detail screen (index.html:1940), but they were already shipped here and
 * they are the reason this screen exists, so they are kept and appended
 * after the PWA's thirteen columns rather than replacing any of them.
 *
 * PWA FACT (dlEnq, index.html:1901-1908): the export is the shared enquiry
 * export scoped to Lost, named `lost-enquiries-<today>.csv`, and it carries
 * the screen's active filters.
 */
export default function LostEnquiries() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [unfiltered, setUnfiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterParams(filters);
      const qs = params.toString();
      // Two calls: the filtered rows for the table, and the unfiltered set
      // the PWA's KPI cards are computed over (index.html:1893).
      const [filtered, all] = await Promise.all([
        api.get('/api/enquiries/lost' + (qs ? '?' + qs : '')),
        qs ? api.get('/api/enquiries/lost') : null,
      ]);
      const list = filtered.enquiries || [];
      setRows(list);
      setUnfiltered(all ? all.enquiries || [] : list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleExport() {
    try {
      const params = filterParams(filters);
      params.set('lost', 'true');
      const resp = await fetch(`${API_BASE_URL}/api/enquiries/export.csv?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lost-enquiries-${todayKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  }

  // PWA FACT (index.html:1891): newest first.
  const ordered = [...rows].reverse();
  const lostValue = unfiltered.reduce((a, b) => a + (b.estimatedValue || 0), 0);
  const filteredValue = rows.reduce((a, b) => a + (b.estimatedValue || 0), 0);
  const today = todayKey();

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>❌ Lost Enquiries</h2>
        <div className="enq-actions">
          <button className="btn sec sm" onClick={() => setShowFilters(!showFilters)}>
            🔎 {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
          <button className="btn sec sm" onClick={handleExport} disabled={loading}>📥 Export CSV</button>
        </div>
      </div>

      {/* PWA FACT (index.html:1893): two red cards over the unfiltered set. */}
      <div className="kpi-bar">
        <div className="kpi-card kpi-bad">
          <div className="kpi-value">{unfiltered.length}</div>
          <div className="kpi-label">Lost Enquiries</div>
        </div>
        <div className="kpi-card kpi-bad">
          <div className="kpi-value">{money(lostValue) || '₹ 0'}</div>
          <div className="kpi-label">Total Lost Value</div>
        </div>
      </div>

      {showFilters && (
        <EnquiryFilterPanel
          rows={unfiltered}
          filters={filters}
          setFilter={setFilter}
          clearFilters={() => setFilters({})}
          showStatus={false}
        />
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="panel flush">
        <div className="panel-head">
          <h3>
            Lost Enquiries{' '}
            <span className="muted">({rows.length} of {unfiltered.length}, {money(filteredValue) || '₹ 0'})</span>
          </h3>
        </div>
        {loading ? (
          <p className="muted">Loading lost enquiries...</p>
        ) : ordered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">❌</div>
            <div className="empty-state-title">No lost enquiries.</div>
            <p className="muted">Nothing here is good news — every enquiry is still open or won.</p>
          </div>
        ) : (
          <EnquiryTable
            rows={ordered}
            todayKey={today}
            onOpen={(e) => navigate(`/enquiries/${e.id}`)}
            extraColumns={[
              { key: 'lostReason', label: 'Lost Reason', render: (e) => <span className="fg-bad">{e.lostReason || '-'}</span> },
              { key: 'lostDate', label: 'Lost On', render: (e) => fmtDate(e.lostDate) || '-' },
            ]}
          />
        )}
      </div>
      {ordered.length > 0 && (
        <p className="muted">Open any row to review the follow-up history, or reopen it from the enquiry page.</p>
      )}
    </div>
  );
}
