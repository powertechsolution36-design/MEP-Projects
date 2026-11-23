import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { money, fmtDate } from '../../utils/format';
import { todayKey } from '../../utils/platform';
import { EnquiryFilterPanel, EnquiryTable, filterParams } from './EnquiryFilterPanel';
import SortSelect, { sortRows, useSort } from '../../components/SortSelect';

/**
 * Won Enquiries — owner request (20 Nov 2026): "Won enquiries should moved
 * out from enquiry list. like lost enquiries. Above Lost Enquiries add Won
 * Enquiries."
 *
 * A won lead has become a quotation and an order; it is finished business,
 * and leaving it among the leads still being chased is the same clutter the
 * Lost screen already removed. So this is the Lost screen's twin, read from
 * GET /api/enquiries/won: the same filter bar, the same table, the same two
 * KPI cards over the UNFILTERED set while the panel heading counts what is
 * on screen — green here rather than red, because this is the good pile.
 *
 * The export is the shared enquiry export scoped with ?won=true and named
 * won-enquiries-<today>.csv.
 */
export default function WonEnquiries() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [unfiltered, setUnfiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  // Owner request (23 Nov 2026): A–Z, Z–A, newest, oldest.
  const [sort, setSort] = useSort('enquiries-won');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = filterParams(filters);
      const qs = params.toString();
      const [filtered, all] = await Promise.all([
        api.get('/api/enquiries/won' + (qs ? '?' + qs : '')),
        qs ? api.get('/api/enquiries/won') : null,
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
      params.set('won', 'true');
      const resp = await fetch(`${API_BASE_URL}/api/enquiries/export.csv?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `won-enquiries-${todayKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  }

  // Newest first, as on the Lost screen.
  const ordered = sortRows([...rows].reverse(), sort, { name: (e) => e.name, date: (e) => e.createdAt });
  const wonValue = unfiltered.reduce((a, b) => a + (b.estimatedValue || 0), 0);
  const filteredValue = rows.reduce((a, b) => a + (b.estimatedValue || 0), 0);
  const today = todayKey();

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>🏆 Won Enquiries</h2>
        <div className="enq-actions">
          {/* Owner request (23 Nov 2026): the sort, on the right. */}
          <SortSelect value={sort} onChange={setSort} />
          {/* Owner request (21 Nov 2026): "This quotation option not required
              move this inside Won enquiries." The register left the menu, so
              it lives here — and it is the only way to reach a quotation
              that was raised without a lead behind it. */}
          <button className="btn sec sm" onClick={() => navigate('/quotations')}>📄 All Quotations</button>
          <button className="btn sec sm" onClick={() => setShowFilters(!showFilters)}>
            🔎 {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
          <button className="btn sec sm" onClick={handleExport} disabled={loading}>📥 Export CSV</button>
        </div>
      </div>

      <div className="kpi-bar">
        <div className="kpi-card kpi-ok">
          <div className="kpi-value">{unfiltered.length}</div>
          <div className="kpi-label">Won Enquiries</div>
        </div>
        <div className="kpi-card kpi-ok">
          <div className="kpi-value">{money(wonValue) || '₹ 0'}</div>
          <div className="kpi-label">Total Won Value</div>
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
            Won Enquiries{' '}
            <span className="muted">({rows.length} of {unfiltered.length}, {money(filteredValue) || '₹ 0'})</span>
          </h3>
        </div>
        {loading ? (
          <p className="muted">Loading won enquiries...</p>
        ) : ordered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏆</div>
            <div className="empty-state-title">Nothing won yet.</div>
            <p className="muted">A lead lands here once its quotation is accepted and the order is raised.</p>
          </div>
        ) : (
          <EnquiryTable
            rows={ordered}
            todayKey={today}
            onOpen={(e) => navigate(`/enquiries/${e.id}`)}
            /* Owner request (21 Nov 2026): "In won Enquiries we can view
               each client their quotation and Sales order." Each one opens
               the document itself; a lead with none says so. */
            extraColumns={[
              {
                key: 'quotation',
                label: 'Quotation',
                render: (e) => (e.quotation ? (
                  <button
                    className="btn sec sm"
                    onClick={(ev) => { ev.stopPropagation(); navigate(`/quotations/${e.quotation.id}`); }}
                  >
                    {e.quotation.quotationNumber || 'View'}
                  </button>
                ) : <span className="muted">—</span>),
              },
              {
                key: 'salesOrder',
                label: 'Sales Order',
                render: (e) => (e.salesOrder ? (
                  <button
                    className="btn sec sm"
                    onClick={(ev) => { ev.stopPropagation(); navigate(`/sales-orders/${e.salesOrder.id}`); }}
                  >
                    SO-{e.salesOrder.orderNumber}
                  </button>
                ) : <span className="muted">—</span>),
              },
              { key: 'reviewDate', label: 'Won On', render: (e) => fmtDate(e.lastReviewDate) || '-' },
            ]}
          />
        )}
      </div>
      {ordered.length > 0 && (
        <p className="muted">Open any row to see the follow-up history behind the win.</p>
      )}
    </div>
  );
}
