import { useAuth } from '../auth/AuthContext';
import { API_BASE_URL } from '../config';
import { getStoredToken } from '../api/client';
import './enquiries/enquiry.css';

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

      {isSuper && (
        <div className="panel">
          <h3>Platform Reports (Super Admin)</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Revenue and subscriber reports are computed from company subscription data.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.location.href = '/admin/revenue'}>
              📈 Revenue Dashboard
            </button>
            <button className="btn" onClick={() => window.location.href = '/admin/usage'}>
              📊 Client Business
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
