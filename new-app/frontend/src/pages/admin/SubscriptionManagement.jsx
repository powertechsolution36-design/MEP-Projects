import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Subscription Management — super-only page.
 *
 * Two sections:
 *   1. Plan Catalog — list + seed default plans
 *   2. Company Subscriptions — assign/update a plan + divisions to a company
 *
 * API:
 *   GET    /api/subscriptions/plans
 *   POST   /api/subscriptions/plans/seed
 *   GET    /api/subscriptions/company/:companyId
 *   POST   /api/subscriptions/company/:companyId
 *   GET    /api/companies  (to list companies)
 */

const ALL_DIVISIONS = ['HVAC', 'Solar', 'MEP'];
const STATUS_OPTIONS = ['active', 'trial', 'expired', 'cancelled', 'suspended'];

export default function SubscriptionManagement() {
  const [plans, setPlans] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Company subscription modal
  const [showModal, setShowModal] = useState(null); // { companyId, companyName }
  const [sub, setSub] = useState(null);
  const [subForm, setSubForm] = useState({
    planCode: '', purchasedDivisions: [], status: 'active',
    startDate: '', endDate: '',
  });
  const [subLoading, setSubLoading] = useState(false);
  const [subBusy, setSubBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansData, companiesData] = await Promise.all([
        api.get('/api/subscriptions/plans'),
        api.get('/api/companies'),
      ]);
      setPlans(plansData.plans || []);
      setCompanies(companiesData.companies || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSeedPlans() {
    if (!window.confirm('Seed the 7 default plans? Existing plans with the same code will be updated.')) return;
    try {
      await api.post('/api/subscriptions/plans/seed');
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function openSubscriptionModal(company) {
    setShowModal({ companyId: company.id, companyName: company.name });
    setSubLoading(true);
    setSub(null);
    try {
      const data = await api.get(`/api/subscriptions/company/${company.id}`);
      const s = data.subscription;
      setSub(s);
      if (s) {
        setSubForm({
          planCode: s.planCode || '',
          purchasedDivisions: s.purchasedDivisions || [],
          status: s.status || 'active',
          startDate: s.startDate ? fmtDate(s.startDate) : '',
          endDate: s.endDate ? fmtDate(s.endDate) : '',
        });
      } else {
        setSubForm({ planCode: '', purchasedDivisions: [], status: 'active', startDate: fmtDate(new Date()), endDate: '' });
      }
    } catch (err) {
      alert(err.message);
      setShowModal(null);
    } finally {
      setSubLoading(false);
    }
  }

  function toggleDivision(div) {
    setSubForm(prev => {
      const has = prev.purchasedDivisions.includes(div);
      return {
        ...prev,
        purchasedDivisions: has
          ? prev.purchasedDivisions.filter(d => d !== div)
          : [...prev.purchasedDivisions, div],
      };
    });
  }

  // When plan changes, auto-select its available divisions
  function handlePlanChange(code) {
    const plan = plans.find(p => p.code === code);
    setSubForm(prev => ({
      ...prev,
      planCode: code,
      purchasedDivisions: plan ? [...(plan.availableDivisions || [])] : prev.purchasedDivisions,
    }));
  }

  async function handleSaveSubscription(e) {
    e.preventDefault();
    if (!subForm.planCode) { alert('Please select a plan.'); return; }
    if (subForm.purchasedDivisions.length === 0) { alert('At least one division is required.'); return; }
    setSubBusy(true);
    try {
      await api.post(`/api/subscriptions/company/${showModal.companyId}`, subForm);
      setShowModal(null);
      loadData();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubBusy(false);
    }
  }

  if (loading) return <div className="enq-page"><p>Loading…</p></div>;
  if (error) return <div className="enq-page"><p className="error">{error}</p></div>;

  return (
    <div className="enq-page">
      <h2>Subscription Management</h2>

      {/* ── Plan Catalog ── */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Plan Catalog ({plans.length})</h3>
          <button className="btn pri sm" onClick={handleSeedPlans}>Seed Default Plans</button>
        </div>
        {plans.length === 0 ? (
          <p style={{ color: '#888', marginTop: 8 }}>No plans yet. Click "Seed Default Plans" to create the 7 standard plans.</p>
        ) : (
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Divisions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.code || p.id}>
                  <td><strong>{p.code}</strong></td>
                  <td>{p.name}</td>
                  <td>{(p.availableDivisions || []).join(', ')}</td>
                  <td><span className={`status-badge status-${p.status === 'active' ? 'open' : 'lost'}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Company Subscriptions ── */}
      <div className="panel">
        <h3>Company Subscriptions</h3>
        <table className="data-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Company</th>
              <th>City</th>
              <th>Status</th>
              <th>Divisions</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.city || '—'}</td>
                <td><span className={`status-badge status-${c.status === 'Active' ? 'open' : c.status === 'Suspended' ? 'lost' : 'pending'}`}>{c.status || 'Active'}</span></td>
                <td>{(c.divisions || []).join(', ') || '—'}</td>
                <td>
                  <button className="btn sec sm" onClick={() => openSubscriptionModal(c)}>
                    Manage Subscription
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Subscription Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3>Subscription — {showModal.companyName}</h3>
            {subLoading ? <p>Loading subscription…</p> : (
              <form onSubmit={handleSaveSubscription}>
                <div className="form-grid">
                  <label className="filter-field">
                    Plan
                    <select value={subForm.planCode} onChange={e => handlePlanChange(e.target.value)} required>
                      <option value="">— Select Plan —</option>
                      {plans.filter(p => p.status === 'active').map(p => (
                        <option key={p.code} value={p.code}>{p.name} ({(p.availableDivisions || []).join('+')})</option>
                      ))}
                    </select>
                  </label>

                  <label className="filter-field">
                    Status
                    <select value={subForm.status} onChange={e => setSubForm(prev => ({ ...prev, status: e.target.value }))}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>

                  <label className="filter-field">
                    Start Date
                    <input type="date" value={subForm.startDate}
                      onChange={e => setSubForm(prev => ({ ...prev, startDate: e.target.value }))} />
                  </label>

                  <label className="filter-field">
                    End Date
                    <input type="date" value={subForm.endDate}
                      onChange={e => setSubForm(prev => ({ ...prev, endDate: e.target.value }))} />
                  </label>
                </div>

                <div style={{ marginTop: 12 }}>
                  <strong>Purchased Divisions:</strong>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    {ALL_DIVISIONS.map(div => (
                      <label key={div} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={subForm.purchasedDivisions.includes(div)}
                          onChange={() => toggleDivision(div)} />
                        {div}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn pri" disabled={subBusy}>
                    {subBusy ? 'Saving…' : sub ? 'Update Subscription' : 'Create Subscription'}
                  </button>
                  <button type="button" className="btn sec" onClick={() => setShowModal(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
