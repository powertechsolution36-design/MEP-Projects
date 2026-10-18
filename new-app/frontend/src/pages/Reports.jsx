import { useAuth } from '../auth/AuthContext';
import { API_BASE_URL } from '../config';
import { useEffect, useState } from 'react';
import { getStoredToken, api } from '../api/client';
import { todayKey, downloadCsv as dlCSV, buildRevenueRows, buildSubscriberRows } from '../utils/platform';

/**
 * Reports — PWA `vReports()` exact reproduction.
 *
 * PWA FACT: super-only. Contains revenue CSV downloads and subscriber CSV downloads.
 * PWA FACT: revenue downloads: This Month / This Year / All Time.
 * PWA FACT: subscriber downloads: Joined This Month / This Year / All.
 *
 * Since our backend doesn't have dedicated revenue/subscriber report endpoints
 * for the super admin yet (those are per-company business modules), this page
 * serves as a download hub for all available CSV exports.
 */

function downloadCsv(path) {
  const token = getStoredToken();
  const url = `${API_BASE_URL}${path}`;
  /* Use fetch + blob to attach the auth header */
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(res => {
      if (!res.ok) throw new Error('Download failed');
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const disp = path.split('/').pop();
      a.download = disp || 'export.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(err => alert(err.message));
}

export default function Reports() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super';

  return (
    <div className="enq-page">
      <div className="enq-header"><h2>Reports & Exports</h2></div>

      {/* Always-visible: business module exports available to the user's role */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>Module Exports</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {['admin', 'sales'].includes(user?.role) && (
            <button className="btn" onClick={() => downloadCsv('/api/enquiries/export.csv')}>
              📋 Enquiry CSV
            </button>
          )}
          {['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'finance'].includes(user?.role) && (
            <button className="btn" onClick={() => downloadCsv('/api/sales-orders/export.csv')}>
              🧾 Sales Orders CSV
            </button>
          )}
          {['admin', 'hvac_pm', 'solar_pm', 'mep_pm'].includes(user?.role) && (
            <button className="btn" onClick={() => downloadCsv('/api/projects/export.csv')}>
              🏗️ Projects CSV
            </button>
          )}
          {['admin', 'service_mgr'].includes(user?.role) && (
            <>
              <button className="btn" onClick={() => downloadCsv('/api/service-calls/export.csv')}>
                🛠️ Service Calls CSV
              </button>
              <button className="btn" onClick={() => downloadCsv('/api/contracts/export.csv')}>
                🔁 AMC/PM List CSV
              </button>
            </>
          )}
          {['admin', 'finance'].includes(user?.role) && (
            <>
              <button className="btn" onClick={() => downloadCsv('/api/payments/export/pending.csv')}>
                💰 Pending Payments CSV
              </button>
              <button className="btn" onClick={() => downloadCsv('/api/payments/export/receipts.csv')}>
                💰 Receipts CSV
              </button>
            </>
          )}
          {['admin', 'inventory'].includes(user?.role) && (
            <>
              <button className="btn" onClick={() => downloadCsv('/api/inventory/reports/stock.csv')}>
                📦 Stock Report CSV
              </button>
              <button className="btn" onClick={() => downloadCsv('/api/inventory/reports/issued.csv')}>
                📤 Issued Material CSV
              </button>
              <button className="btn" onClick={() => downloadCsv('/api/inventory/reports/transactions.csv')}>
                🧾 Inventory Transactions CSV
              </button>
              <button className="btn" onClick={() => downloadCsv('/api/inventory/reports/returns.csv')}>
                📥 Material Returns CSV
              </button>
            </>
          )}
          {['engineer', 'service_eng'].includes(user?.role) && (
            <button className="btn" onClick={() => downloadCsv('/api/inventory/reports/my-material.csv')}>
              📦 My Material CSV
            </button>
          )}
        </div>
      </div>

      {isSuper && <SuperReports />}
    </div>
  );
}

/* PWA FACT: vReports() (index.html:1546-1555) and dlReport(type, period)
   (index.html:1564-1590) — six client-side CSV reports built from the
   company list. Columns, ordering, TOTAL row and filenames match the PWA. */
function SuperReports() {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.get('/api/companies').then((r) => setCompanies(r.companies || [])).catch((e) => setError(e.message));
  }, []);
  function dl(type, period) {
    if (!companies) return;
    const name = `${type === 'revenue' ? 'revenue' : 'subscribers'}-${period}-${todayKey()}.csv`;
    dlCSV(name, type === 'revenue' ? buildRevenueRows(companies, period) : buildSubscriberRows(companies, period));
    setMsg(`Report downloaded: ${name}`);
  }
  const off = !companies;
  return (
    <>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {msg && <p className="muted">{msg}</p>}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>📊 Revenue Reports</h3>
        <div className="muted" style={{ marginBottom: 10 }}>CSV downloads — open directly in Excel.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn blu" disabled={off} onClick={() => dl('revenue', 'month')}>Revenue — This Month</button>
          <button className="btn blu" disabled={off} onClick={() => dl('revenue', 'year')}>Revenue — This Year</button>
          <button className="btn blu" disabled={off} onClick={() => dl('revenue', 'all')}>Revenue — All Time</button>
        </div>
      </div>
      <div className="panel">
        <h3>📊 Subscriber Reports (status wise)</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sec" disabled={off} onClick={() => dl('subs', 'month')}>Subscribers — Joined This Month</button>
          <button className="btn sec" disabled={off} onClick={() => dl('subs', 'year')}>Subscribers — Joined This Year</button>
          <button className="btn sec" disabled={off} onClick={() => dl('subs', 'all')}>Subscribers — All Time</button>
        </div>
      </div>
    </>
  );
}
