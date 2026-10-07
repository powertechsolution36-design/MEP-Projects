import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { today } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Service Call Creation — supports two paths:
 *
 * Path A — Complaint registration (PWA `registerComplaint()`):
 *   Manual entry: customer (required by validation), phone, site,
 *   appointmentDate, appointmentTime, complaintDescription.
 *   POST /api/service-calls/complaints
 *
 * Path B — PM scheduling from contract (PWA `schedulePM()`):
 *   Reached via ?contractId=xxx&month=YYYY-MM
 *   Pre-fills customer/phone/site from contract.
 *   POST /api/service-calls/pm/:contractId
 *
 * PWA FACT: only admin/service_mgr (MANAGE_ROLES) can create.
 */

const MANAGE_ROLES = ['admin', 'service_mgr'];

export default function ServiceCallCreate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contractId = searchParams.get('contractId');
  const visitMonth = searchParams.get('month');

  const isPM = !!contractId;

  const [form, setForm] = useState({
    customer: '',
    phone: '',
    site: '',
    appointmentDate: today(),
    appointmentTime: '',
    complaintDescription: '',
  });
  const [contract, setContract] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /* If PM path, load contract to pre-fill fields */
  useEffect(() => {
    if (!contractId) return;
    api.get(`/api/contracts/${contractId}`)
      .then(data => {
        const c = data.contract || data;
        setContract(c);
        setForm(prev => ({
          ...prev,
          customer: c.customer || '',
          phone: c.phone || '',
          site: c.site || '',
        }));
      })
      .catch(err => setError('Failed to load contract: ' + err.message));
  }, [contractId]);

  function onChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isPM) {
        /* Path B — Schedule PM */
        const body = {
          appointmentDate: form.appointmentDate || undefined,
          appointmentTime: form.appointmentTime || undefined,
          complaintDescription: form.complaintDescription || undefined,
          visitMonth: visitMonth || undefined,
        };
        const data = await api.post(`/api/service-calls/pm/${contractId}`, body);
        const id = data.serviceCall?.id || data.serviceCall?._id;
        navigate(`/service-calls/${id}`);
      } else {
        /* Path A — Register Complaint */
        const body = {
          customer: form.customer,
          phone: form.phone || undefined,
          site: form.site || undefined,
          appointmentDate: form.appointmentDate || undefined,
          appointmentTime: form.appointmentTime || undefined,
          complaintDescription: form.complaintDescription || undefined,
        };
        const data = await api.post('/api/service-calls/complaints', body);
        const id = data.serviceCall?.id || data.serviceCall?._id;
        navigate(`/service-calls/${id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /* Role gate */
  if (!MANAGE_ROLES.includes(user?.role)) {
    return (
      <div className="enq-page">
        <div className="panel">
          <p className="muted">You do not have permission to create service calls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>{isPM ? 'Schedule PM Visit' : 'Register Complaint'}</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {isPM && contract && (
        <div className="panel">
          <strong>Contract:</strong> {contract.customer} — {contract.site} ({contract.category} / {contract.amcType})
          {visitMonth && <span> | Month: {visitMonth}</span>}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="panel">
          <div className="form-grid">
            <div className="filter-field">
              <label>Customer {!isPM && '*'}</label>
              <input
                type="text"
                value={form.customer}
                onChange={e => onChange('customer', e.target.value)}
                required={!isPM}
                readOnly={isPM}
              />
            </div>
            <div className="filter-field">
              <label>Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => onChange('phone', e.target.value)}
                readOnly={isPM}
              />
            </div>
            <div className="filter-field">
              <label>Site</label>
              <input
                type="text"
                value={form.site}
                onChange={e => onChange('site', e.target.value)}
                readOnly={isPM}
              />
            </div>
            <div className="filter-field">
              <label>Appointment Date</label>
              <input
                type="date"
                value={form.appointmentDate}
                onChange={e => onChange('appointmentDate', e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label>Appointment Time</label>
              <input
                type="time"
                value={form.appointmentTime}
                onChange={e => onChange('appointmentTime', e.target.value)}
              />
            </div>
          </div>
          <div className="filter-field full-width" style={{ marginTop: 8 }}>
            <label>Description</label>
            <textarea
              rows={3}
              value={form.complaintDescription}
              onChange={e => onChange('complaintDescription', e.target.value)}
            />
          </div>
        </div>

        <div className="detail-actions">
          <button type="submit" className="btn pri" disabled={saving}>
            {saving ? 'Saving...' : (isPM ? 'Schedule PM' : 'Register Complaint')}
          </button>
          <button type="button" className="btn sec" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
