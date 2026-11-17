import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { today } from '../../utils/format';
import ClientPicker, { coverageOf, COVERAGE_TEXT } from './ClientPicker';
import ClientSelect from '../../components/ClientSelect';
import ContactPick from '../../components/ContactPick';
import useMyDivisions from '../../hooks/useMyDivisions';

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

const MANAGE_ROLES = ['admin', 'service_mgr', 'solar_pm'];

export default function ServiceCallCreate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contractId = searchParams.get('contractId');
  const visitMonth = searchParams.get('month');
  // Arriving from an AMC client's page pre-selects that client.
  const clientIdParam = searchParams.get('clientId');

  const isPM = !!contractId;

  const [form, setForm] = useState({
    customer: '',
    phone: '',
    site: '',
    appointmentDate: today(),
    appointmentTime: '',
    complaintDescription: '',
    // Owner request (14 Nov 2026): which side of the business the call is.
    // A call against an AMC / Warranty client takes that client's division
    // on the server; this is for a walk-in with no client behind it.
    division: '',
    // Owner request (17 Nov 2026): the directory client this is for, and
    // which person at them reported it. The number goes in `phone` above.
    clientId: null,
    contactName: '',
    contactDesignation: '',
  });
  // Whose people the picker offers: the AMC client when there is one, and
  // otherwise the directory client chosen below. Held only while the form is
  // open; what is SAVED is the client's id and the person's name.
  const [directoryClient, setDirectoryClient] = useState(null);
  const myDivisions = useMyDivisions();
  const [contract, setContract] = useState(null);
  // Complaint path: the AMC / Warranty client it is for, or Chargeable.
  const [client, setClient] = useState(null);
  const [chargeable, setChargeable] = useState(false);
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

  function pickClient(c) {
    setClient(c);
    setChargeable(false);
    setDirectoryClient(null);
    if (c) {
      setForm(prev => ({
        ...prev,
        customer: c.customer || '',
        phone: c.phone || '',
        site: c.site || '',
        // A different client means a different set of people.
        clientId: null,
        contactName: '',
        contactDesignation: '',
      }));
    }
  }

  /**
   * Owner request (17 Nov 2026): a complaint from somebody who is NOT on an
   * AMC was typed out in full every time, even for a client we have worked
   * for all year. Picking them from the directory fills their name, number
   * and address, and records WHICH client it was.
   */
  function pickFromDirectory(c) {
    setDirectoryClient(c);
    setForm(prev => ({
      ...prev,
      clientId: c.id,
      customer: c.companyName || c.clientName || prev.customer,
      phone: prev.phone || c.phone || '',
      site: prev.site || c.address || '',
      contactName: '',
      contactDesignation: '',
    }));
  }

  /** Whichever record the people on the form should come from. */
  const peopleSource = client || directoryClient;

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
        navigate(`/service-calls/${id}`, { state: { customerMessage: data.customerMessage || '' } });
      } else {
        /* Path A — Register Complaint */
        if (!client && !chargeable) {
          setError('Choose the AMC / Warranty client, or mark it as not a client (Chargeable).');
          setSaving(false);
          return;
        }
        const body = {
          contractId: client ? client.id : undefined,
          clientId: form.clientId || undefined,
          customer: form.customer,
          phone: form.phone || undefined,
          site: form.site || undefined,
          contactName: form.contactName || undefined,
          contactDesignation: form.contactDesignation || undefined,
          appointmentDate: form.appointmentDate || undefined,
          appointmentTime: form.appointmentTime || undefined,
          complaintDescription: form.complaintDescription || undefined,
          division: form.division || undefined,
        };
        const data = await api.post('/api/service-calls/complaints', body);
        const id = data.serviceCall?.id || data.serviceCall?._id;
        navigate(`/service-calls/${id}`, { state: { customerMessage: data.customerMessage || '' } });
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
        {!isPM && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Who is this complaint for?</h3>
            <ClientPicker
              value={client}
              chargeable={chargeable}
              onPick={pickClient}
              onChargeable={(v) => { setChargeable(v); if (v) setClient(null); }}
              initialClientId={clientIdParam}
            />
            {(client || chargeable) && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                Service type will default to: <strong>{COVERAGE_TEXT[coverageOf(client)]}</strong>
              </div>
            )}
            {/* Owner request (17 Nov 2026): not an AMC client is not the same
                as a stranger. Pick them from the client list and their name,
                number and address fill in. A name that is not on the list is
                still simply typed below, exactly as before. */}
            {chargeable && (
              <div style={{ marginTop: 10 }}>
                <ClientSelect
                  label="Client (from the client list)"
                  placeholder="Search the client list, or leave blank and type below"
                  value={directoryClient ? (directoryClient.companyName || directoryClient.clientName || '') : form.customer}
                  onType={(v) => { setDirectoryClient(null); onChange('customer', v); onChange('clientId', null); }}
                  onPick={pickFromDirectory}
                />
              </div>
            )}
            {/* And WHO at them reported it. Their number fills the phone the
                engineer rings; their name prints on the service report. */}
            <ContactPick
              client={peopleSource}
              picked={form.contactName ? { name: form.contactName, phone: form.phone } : null}
              onPick={(person) => setForm(prev => ({
                ...prev,
                contactName: person ? person.name : '',
                contactDesignation: person ? person.designation : '',
                phone: person ? (person.phone || prev.phone) : prev.phone,
              }))}
              label="Who reported it?"
            />
          </div>
        )}
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
            {!isPM && !client && (
              <div className="filter-field">
                <label>Division</label>
                <select value={form.division} onChange={e => onChange('division', e.target.value)}>
                  <option value="">— select —</option>
                  {myDivisions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
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
