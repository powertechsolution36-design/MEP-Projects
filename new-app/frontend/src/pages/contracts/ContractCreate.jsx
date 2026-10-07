import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { today } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Manual AMC / Warranty Contract Creation — PWA `saveContract()` (Path B)
 * exact reproduction.
 *
 * PWA FACT (§4 Path B, §8): the ONLY client-side validation is non-empty
 * `site`. Every other field (customer, phone, email, amount, end) can be
 * blank. `start` defaults to today; `amount` defaults to 0; `end` has NO
 * fallback (a blank end is accepted and the contract immediately reads as
 * Expired — Decision 8, preserved exactly).
 *
 * PWA FACT: category select defaults to "AMC"; amcType select defaults to
 * "Quarterly". No other defaults.
 *
 * PWA FACT: only admin/service_mgr (MANAGE_ROLES) can create. Server
 * enforces this; the route itself is only navigable from the list page's
 * "+ New AMC" button which is also gated.
 *
 * PWA FACT: manual creation fires ZERO notifications (asymmetric with
 * conversion path — Decision 7, preserved).
 *
 * PWA FACT: no duplicate-guard — calling this with the same fields
 * creates independent contracts.
 */

const AMC_TYPES = ['Monthly', 'Quarterly', 'Half-Yearly'];
const CATEGORIES = ['AMC', 'Warranty'];

export default function ContractCreate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    customer: '',
    phone: '',
    email: '',
    site: '',
    capacity: '',
    category: 'AMC',
    amcType: 'Quarterly',
    amount: '',
    start: today(),
    end: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canManage = ['admin', 'service_mgr'].includes(user?.role);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    /* PWA FACT: only client-side validation is non-empty site */
    if (!form.site.trim()) {
      alert('Site name required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        customer: form.customer,
        phone: form.phone,
        email: form.email,
        site: form.site,
        capacity: form.capacity,
        category: form.category,
        amcType: form.amcType,
        amount: form.amount ? Number(form.amount) : 0,
        start: form.start || undefined,
        end: form.end || undefined,
      };
      const data = await api.post('/api/contracts', body);
      const created = data.contract;
      navigate(`/contracts/${created.id || created._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="enq-page">
        <p style={{ color: 'red' }}>Only Admin and Service Manager can create contracts.</p>
        <button className="btn sec" onClick={() => navigate('/contracts')}>Back</button>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="detail-head">
        <button className="btn sec sm" onClick={() => navigate('/contracts')}>Back</button>
        <h2>New AMC / Warranty Contract</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div className="panel">
          <h3>Customer Information</h3>
          <div className="form-grid">
            <div className="filter-field">
              <label>Customer Name</label>
              <input value={form.customer} onChange={e => setField('customer', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Phone</label>
              <input value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Email</label>
              <input value={form.email} onChange={e => setField('email', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Site *</label>
              <input value={form.site} onChange={e => setField('site', e.target.value)} required />
            </div>
            <div className="filter-field">
              <label>Capacity</label>
              <input value={form.capacity} onChange={e => setField('capacity', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Contract Details</h3>
          <div className="form-grid">
            <div className="filter-field">
              <label>Category</label>
              <select value={form.category} onChange={e => setField('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>AMC Type</label>
              <select value={form.amcType} onChange={e => setField('amcType', e.target.value)}>
                {AMC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Amount</label>
              <input type="number" value={form.amount} onChange={e => setField('amount', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Start Date</label>
              <input type="date" value={form.start} onChange={e => setField('start', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>End Date</label>
              <input type="date" value={form.end} onChange={e => setField('end', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="detail-actions">
          <button className="btn pri" type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create Contract'}
          </button>
          <button className="btn sec" type="button" onClick={() => navigate('/contracts')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
