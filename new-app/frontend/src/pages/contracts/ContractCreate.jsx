import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { today } from '../../utils/format';
import ContactsField from '../../components/ContactsField';
import ClientSelect from '../../components/ClientSelect';
import ContactPick from '../../components/ContactPick';
import useMyDivisions from '../../hooks/useMyDivisions';

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
  // Owner request (14 Nov 2026): say which side of the business the cover is.
  const myDivisions = useMyDivisions();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    customer: '',
    phone: '',
    email: '',
    site: '',
    capacity: '',
    make: '',
    equipmentModel: '',
    equipmentType: '',
    division: '',
    category: 'AMC',
    amcType: 'Quarterly',
    amount: '',
    start: today(),
    end: '',
    // Owner request (5 Nov 2026): the other people at the site.
    contacts: [],
  });
  const [busy, setBusy] = useState(false);
  // Whose people the picker offers. Held only while the form is open.
  const [pickedClient, setPickedClient] = useState(null);
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
    if (!form.division) {
      alert('Choose the division — Solar, HVAC or MEP.');
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
        make: form.make,
        equipmentModel: form.equipmentModel,
        equipmentType: form.equipmentType,
        division: form.division,
        category: form.category,
        amcType: form.amcType,
        amount: form.amount ? Number(form.amount) : 0,
        start: form.start || undefined,
        end: form.end || undefined,
        contacts: form.contacts,
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
            {/* Owner request (21 Nov 2026): "Everywhere dropdown required
                for select client ... which is saved with us or add new
                client." Typing a name that is not on file still works —
                the client is remembered when the record saves. */}
            <ClientSelect
              label="Customer Name"
              value={form.customer}
              onType={(v) => { setField('customer', v); setPickedClient(null); }}
              onPick={(c) => {
                setPickedClient(c);
                setForm((f) => ({
                  ...f,
                  customer: c.companyName || c.clientName || f.customer,
                  phone: f.phone || c.phone || '',
                  email: f.email || c.email || '',
                  site: f.site || c.address || '',
                  contacts: (f.contacts || []).some((r) => r.name) ? f.contacts : (c.contacts || []),
                }));
              }}
            />
            <div className="filter-field">
              <label>Phone</label>
              <input value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Email</label>
              <input value={form.email} onChange={e => setField('email', e.target.value)} />
            </div>
            <div className="filter-field">
              {/* Owner's wording (23 Nov 2026): the firm is the Site, the
                  person is the Customer Name. */}
              <label>Site *</label>
              <input
                value={form.site}
                placeholder="The firm, e.g. Kapil Agencies Moto Central"
                onChange={e => setField('site', e.target.value)}
                required
              />
            </div>
            <div className="filter-field">
              <label>Capacity</label>
              <input value={form.capacity} onChange={e => setField('capacity', e.target.value)} />
            </div>
            {/* Owner request (19 Nov 2026): the machine under cover, kept on
                the client so every service report of theirs starts filled. */}
            <div className="filter-field">
              <label>Make</label>
              <input value={form.make} placeholder="e.g. Samsung" onChange={e => setField('make', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Model</label>
              <input value={form.equipmentModel} onChange={e => setField('equipmentModel', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Type</label>
              <input value={form.equipmentType} placeholder="e.g. Cassette, Hi-wall, VRF" onChange={e => setField('equipmentType', e.target.value)} />
            </div>
          </div>

          {/* And which person at them. */}
          <ContactPick
            client={pickedClient}
            picked={null}
            onPick={(person) => {
              if (!person) return;
              setForm((prev) => {
                const rows = Array.isArray(prev.contacts) ? [...prev.contacts] : [];
                const already = rows.some((r) => String(r.name || '').trim() === person.name
                  && String(r.phone || '').trim() === person.phone);
                if (already) return prev;
                const next = { name: person.name, designation: person.designation || '', phone: person.phone || '' };
                const slot = rows.findIndex((r) => !String(r.name || '').trim() && !String(r.phone || '').trim());
                if (slot === -1) rows.push(next); else rows[slot] = { ...rows[slot], ...next };
                return { ...prev, contacts: rows, phone: prev.phone || (person.main ? person.phone : '') };
              });
            }}
            label="Add a person from this client"
          />
          <ContactsField
            value={form.contacts}
            onChange={(contacts) => setField('contacts', contacts)}
          />
        </div>

        <div className="panel">
          <h3>Contract Details</h3>
          <div className="form-grid">
            <div className="filter-field">
              <label>Division *</label>
              <select value={form.division} onChange={e => setField('division', e.target.value)} required>
                <option value="">— select —</option>
                {myDivisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
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
