import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate, today } from '../../utils/format';
import { whatsappUrl, displayNumber, canSendToClients } from '../../utils/whatsapp';
import PortalInvitePanel from '../../components/PortalInvitePanel';
import ContactsField, { ContactsList } from '../../components/ContactsField';
import useMyDivisions from '../../hooks/useMyDivisions';

/**
 * AMC Client — one page per AMC / Warranty client (owner request, 22 Oct 2026).
 *
 * Everything about the client in one place: who they are, their cover today
 * (Active / Expiring Soon / Expired), whether this period is paid, every
 * service call ever raised for them — scheduled AMC visits and complaints,
 * before AND after their AMC ran out — with the totals: services given, AMC
 * visits done, parts repaired and replaced, gas filled. Renewing extends this
 * same record, so the history never splits; earlier periods are listed at the
 * bottom.
 *
 * The AMC letter can be sent once the AMC is marked paid. Client messages go
 * out from the service manager's / admin's device, which holds the company
 * WhatsApp number.
 *
 * API: GET  /api/contracts/:id/history
 *      POST /api/contracts/:id/payment
 *      POST /api/contracts/:id/renew
 *      GET  /api/contracts/:id/letter-link
 *      GET  /api/companies/my-profile   (company WhatsApp number)
 */

const MANAGE_ROLES = ['admin', 'service_mgr', 'solar_pm'];
const PAYMENT_ROLES = ['admin', 'service_mgr', 'finance'];
const PAYMENT_MODES = ['Bank Transfer/NEFT', 'Cheque', 'UPI', 'Cash', 'RTGS'];
const AMC_TYPES = ['Monthly', 'Quarterly', 'Half-Yearly'];

function statusClass(status) {
  if (status === 'Active') return 'status-won';
  if (status === 'Expiring Soon') return 'status-pending';
  if (status === 'Expired') return 'status-lost';
  return '';
}

function callStatusClass(status) {
  if (status === 'Completed') return 'status-won';
  if (status === 'Registered') return 'status-pending';
  return 'status-open';
}

function coverageClass(cov) {
  if (cov === 'AMC' || cov === 'Warranty') return 'status-won';
  if (String(cov || '').endsWith('expired')) return 'status-lost';
  return 'status-pending';
}

function currentMonth() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function isoDay(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day before the same date next year: a one-year AMC period. */
function oneYearEnd(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const next = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function ContractDetail() {
  const myDivisions = useMyDivisions();
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const [companyWa, setCompanyWa] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [letterToken, setLetterToken] = useState('');

  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({ amountPaid: '', paidOn: today(), mode: 'UPI', reference: '' });
  const [showRenew, setShowRenew] = useState(false);
  const [renewForm, setRenewForm] = useState({ startDate: '', endDate: '', amount: '', amcType: 'Quarterly' });
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [visitDraft, setVisitDraft] = useState({});
  const [busyVisit, setBusyVisit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get(`/api/contracts/${id}/history`);
      setData(d);
      const c = d.contract;
      setPayForm((p) => ({ ...p, amountPaid: c.amount != null ? String(c.amount) : '' }));
      const start = c.endDate ? addDays(isoDay(c.endDate), 1) : today();
      setRenewForm({
        startDate: start,
        endDate: oneYearEnd(start),
        amount: c.amount != null ? String(c.amount) : '',
        amcType: c.amcType || 'Quarterly',
      });
      if (c.payment && c.payment.status === 'Paid') {
        api.get(`/api/contracts/${id}/letter-link`)
          .then((x) => { if (x && x.letterToken) setLetterToken(x.letterToken); })
          .catch(() => {});
      } else {
        setLetterToken('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/companies/my-profile')
      .then((d) => {
        const co = d.company || {};
        setCompanyWa(co.whatsappNumber || '');
        setCompanyName(co.displayName || co.name || '');
      })
      .catch(() => {});
  }, []);

  async function markPaid(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/contracts/${id}/payment`, {
        amountPaid: payForm.amountPaid === '' ? undefined : Number(payForm.amountPaid),
        paidOn: payForm.paidOn,
        mode: payForm.mode,
        reference: payForm.reference,
      });
      setShowPay(false);
      setNotice('AMC marked as paid. The AMC letter can now be sent.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function renew(e) {
    e.preventDefault();
    if (!window.confirm('Renew this AMC? The current period and its history are kept; the new period starts unpaid.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/contracts/${id}/renew`, {
        startDate: renewForm.startDate,
        endDate: renewForm.endDate,
        amount: renewForm.amount === '' ? undefined : Number(renewForm.amount),
        amcType: renewForm.amcType,
      });
      setShowRenew(false);
      setNotice('AMC renewed on the same client record.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  if (error && !data) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!data) return <div className="enq-page"><p className="muted">Client not found.</p></div>;

  const { contract: c, stats, calls } = data;
  const paid = c.payment && c.payment.status === 'Paid';
  const tm = currentMonth();
  const letterUrl = letterToken ? `${window.location.origin}/api/public/amc-letters/${letterToken}` : '';
  const letterMessage = letterUrl
    ? `Dear ${c.customer || 'Customer'},\n\nThank you for choosing us for your ${c.category === 'Warranty' ? 'warranty' : 'Annual Maintenance Contract'}`
      + ` at ${c.site || 'your site'} (${fmtDate(c.startDate)} to ${fmtDate(c.endDate)}).\n\nYour AMC letter: ${letterUrl}`
      + `${companyName ? `\n\nRegards,\n${companyName}` : ''}`
    : '';
  const waLink = whatsappUrl(c.phone, letterMessage);
  const sender = canSendToClients(role);

  /* The schedule and the history are two different things, so they are two
     different lists. A visit counts as completed only because a completion
     date is stored against it — never because its month has passed. */
  /* Owner decision (23 Nov 2026): one AMC may cover more than one address —
     "Kapil Agency has a site in Baner and Nana Peth" — on one amount, with
     the visits and the machine details held per site. The server sends the
     sites ready-made, the contract's own first; an older contract that has
     only ever had one site arrives as a list of one, so everything below
     reads the same for both. */
  const sites = c.sites && c.sites.length
    ? c.sites
    : [{
      index: 0, name: c.site || '', capacity: c.capacity || '', make: c.make || '',
      equipmentModel: c.equipmentModel || '', equipmentType: c.equipmentType || '',
      scheduledVisits: c.scheduledVisits || [],
    }];
  const manySites = sites.length > 1;
  const visitKey = (siteIndex, i) => `${siteIndex}:${i}`;

  const pendingVisits = sites.flatMap((site) => (site.scheduledVisits || [])
    .map((v, i) => ({ ...v, i, siteIndex: site.index, siteName: site.name }))
    .filter((v) => !v.completedDate));

  const periodLabel = (r) => `${r.startDate ? fmtDate(r.startDate) : '?'} \u2013 ${r.endDate ? fmtDate(r.endDate) : '?'}`;
  const completedVisits = [
    ...(c.renewals || []).flatMap((r) => [
      ...(r.visits || []).map((v, i) => ({ ...v, i, siteIndex: 0, siteName: sites[0].name, current: false, period: periodLabel(r) })),
      ...(r.siteVisits || []).flatMap((list, k) => (list || [])
        .map((v, i) => ({ ...v, i, siteIndex: k + 1, siteName: (sites[k + 1] || {}).name || '', current: false, period: periodLabel(r) }))),
    ].filter((v) => v.completedDate)),
    ...sites.flatMap((site) => (site.scheduledVisits || [])
      .map((v, i) => ({ ...v, i, siteIndex: site.index, siteName: site.name, current: true, period: 'This period' }))
      .filter((v) => v.completedDate)),
  ].sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate));

  /* Owner request (29 Oct 2026): one history. A completed AMC visit belongs
     beside the service calls, not in a schedule of work still to do — so the
     completed visits are folded into Service history and the schedule panel
     shows only what is still outstanding. Newest first. */
  const historyRows = [
    ...calls.map((r) => ({ kind: 'call', key: `c-${r.id}`, date: r.appointmentDate || r.registeredDate, r })),
    ...completedVisits.map((v) => ({ kind: 'visit', key: `v-${v.period}-${v.siteIndex}-${v.i}`, date: v.completedDate, v })),
  ].sort((x, y) => new Date(y.date) - new Date(x.date));

  /* Owner request (29 Oct 2026): correct the client's AMC details in place.
     Only the fields below are sent; the visit schedule is never regenerated,
     so recorded completions survive an edit. */
  function openEdit() {
    setEditForm({
      customer: c.customer || '', phone: c.phone || '', email: c.email || '',
      division: c.division || '',
      site: c.site || '', address: c.address || '', capacity: c.capacity || '',
      make: c.make || '', equipmentModel: c.equipmentModel || '', equipmentType: c.equipmentType || '',
      startDate: c.startDate ? fmtDate(c.startDate) : '',
      endDate: c.endDate ? fmtDate(c.endDate) : '',
      amcType: c.amcType || 'Quarterly', category: c.category || 'AMC',
      amount: c.amount === undefined || c.amount === null ? '' : String(c.amount),
      // Owner request (5 Nov 2026): the other people at the site.
      contacts: (c.contacts || []).map((x) => ({ ...x })),
      /* Owner decision (23 Nov 2026): the other addresses this one AMC
         covers. A site keeps its own machine details and its own visits —
         editing them here never touches the schedule, because the server
         matches a site by name and keeps what it had. */
      extraSites: (c.extraSites || []).map((x) => ({
        name: x.name || '', capacity: x.capacity || '', make: x.make || '',
        equipmentModel: x.equipmentModel || '', equipmentType: x.equipmentType || '',
      })),
    });
    setShowPay(false); setShowRenew(false); setShowEdit(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice('');
    try {
      await api.patch(`/api/contracts/${id}`, {
        ...editForm,
        amount: editForm.amount === '' ? 0 : Number(editForm.amount),
        endDate: editForm.endDate === '' ? null : editForm.endDate,
      });
      setShowEdit(false);
      setNotice('Client details updated.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* One visit's completed date — for a service done before this app existed,
     or one recorded against the wrong month. Blank clears it. */
  async function saveVisit(siteIndex, i, override) {
    const key = visitKey(siteIndex, i);
    const value = override !== undefined
      ? override
      : (visitDraft[key] !== undefined ? visitDraft[key] : '');
    setBusyVisit(key); setError(null); setNotice('');
    const where = manySites ? ` at ${(sites[siteIndex] || {}).name || ''}` : '';
    try {
      await api.patch(`/api/contracts/${id}/visits/${i}`, {
        completedDate: value === '' ? null : value,
        siteIndex,
      });
      setVisitDraft((p) => { const n = { ...p }; delete n[key]; return n; });
      setNotice(value === '' ? `Visit ${i + 1}${where} marked not done.` : `Visit ${i + 1}${where} completed date saved.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyVisit(null);
    }
  }

  return (
    <div className="enq-page">
      <div className="detail-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn sec sm" onClick={() => navigate('/contracts')}>Back</button>
        <h2 style={{ margin: 0 }}>{c.customer || c.site || 'AMC Client'}</h2>
        <span className={`status-badge ${statusClass(c.status)}`}>{c.category} · {c.status}</span>
        <span className={`status-badge ${paid ? 'status-won' : 'status-pending'}`}>{paid ? 'Paid' : 'Payment pending'}</span>
      </div>

      <div className="detail-actions" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {MANAGE_ROLES.includes(role) && (
          <button className="btn sm pri" onClick={() => navigate(`/service-calls/new?clientId=${c.id}`)}>Register complaint</button>
        )}
        {MANAGE_ROLES.includes(role) && (
          <button className="btn sm sec" onClick={() => navigate(`/service-calls/new?contractId=${c.id}`)}>Schedule PM visit</button>
        )}
        {MANAGE_ROLES.includes(role) && (
          <button className="btn sm sec" onClick={openEdit}>Edit details</button>
        )}
        {PAYMENT_ROLES.includes(role) && !paid && (
          <button className="btn sm sec" onClick={() => { setShowPay((v) => !v); setShowRenew(false); }}>Mark AMC paid</button>
        )}
        {MANAGE_ROLES.includes(role) && (
          <button className="btn sm sec" onClick={() => { setShowRenew((v) => !v); setShowPay(false); }}>Renew AMC</button>
        )}
        <button className="btn sm sec" onClick={() => navigate(`/contracts/${c.id}/amc-document?type=comprehensive`)}>AMC documents</button>
      </div>

      {notice && <div className="panel" style={{ borderLeft: '4px solid #137a47' }}>{notice}</div>}
      {error && <div className="panel" style={{ borderLeft: '4px solid #d92b2b', color: '#b91c1c' }}>{error}</div>}

      {showPay && (
        <form className="panel" onSubmit={markPaid}>
          <h3 style={{ marginTop: 0 }}>Mark AMC paid</h3>
          <div className="form-grid">
            <label className="filter-field">Amount paid
              <input type="number" min={0} value={payForm.amountPaid} onChange={(e) => setPayForm((p) => ({ ...p, amountPaid: e.target.value }))} />
            </label>
            <label className="filter-field">Paid on
              <input type="date" value={payForm.paidOn} onChange={(e) => setPayForm((p) => ({ ...p, paidOn: e.target.value }))} />
            </label>
            <label className="filter-field">Mode
              <select value={payForm.mode} onChange={(e) => setPayForm((p) => ({ ...p, mode: e.target.value }))}>
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="filter-field">Reference (UTR / cheque no.)
              <input value={payForm.reference} onChange={(e) => setPayForm((p) => ({ ...p, reference: e.target.value }))} />
            </label>
          </div>
          <div className="detail-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button>
            <button type="button" className="btn sec" onClick={() => setShowPay(false)}>Cancel</button>
          </div>
        </form>
      )}

      {showRenew && (
        <form className="panel" onSubmit={renew}>
          <h3 style={{ marginTop: 0 }}>Renew AMC</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            The same client record is extended. This period&apos;s visits and payment are kept below under &quot;Earlier periods&quot;.
          </p>
          <div className="form-grid">
            <label className="filter-field">New start
              <input type="date" value={renewForm.startDate} onChange={(e) => setRenewForm((p) => ({ ...p, startDate: e.target.value }))} />
            </label>
            <label className="filter-field">New end
              <input type="date" value={renewForm.endDate} onChange={(e) => setRenewForm((p) => ({ ...p, endDate: e.target.value }))} />
            </label>
            <label className="filter-field">AMC amount
              <input type="number" min={0} value={renewForm.amount} onChange={(e) => setRenewForm((p) => ({ ...p, amount: e.target.value }))} />
            </label>
            <label className="filter-field">Visits
              <select value={renewForm.amcType} onChange={(e) => setRenewForm((p) => ({ ...p, amcType: e.target.value }))}>
                {AMC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <div className="detail-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Renew'}</button>
            <button type="button" className="btn sec" onClick={() => setShowRenew(false)}>Cancel</button>
          </div>
        </form>
      )}

      {showEdit && editForm && (
        <form className="panel" onSubmit={saveEdit}>
          <h3 style={{ marginTop: 0 }}>Edit client AMC details</h3>
          <p className="muted">
            The visit schedule and every recorded completion are left exactly as they are.
            Correct a visit date in the two visit lists below.
          </p>
          <div className="filter-grid">
            <label className="filter-field">Customer Name
              <input
                value={editForm.customer}
                placeholder="The person, e.g. Rohit Gupta"
                onChange={(e) => setEditForm((f) => ({ ...f, customer: e.target.value }))}
              />
            </label>
            <label className="filter-field">Site *
              <input
                value={editForm.site}
                required
                placeholder="The firm, e.g. Kapil Agencies Moto Central"
                onChange={(e) => setEditForm((f) => ({ ...f, site: e.target.value }))}
              />
            </label>
            {/* Owner, 23 Nov 2026: "Nana Peth is Address not Site, it is a
                place in Pune." The site is the firm; this is where it is,
                and it is what tells two records of the same firm apart. */}
            <label className="filter-field">Address
              <input
                value={editForm.address}
                placeholder="e.g. Baner"
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
              />
            </label>
            <label className="filter-field">Phone
              <input inputMode="tel" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
            </label>
            <label className="filter-field">Email
              <input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="filter-field">Capacity
              <input value={editForm.capacity} onChange={(e) => setEditForm((f) => ({ ...f, capacity: e.target.value }))} />
            </label>
            {/* The machine under cover — it fills this client's service
                reports (owner request, 19 Nov 2026). */}
            <label className="filter-field">Make
              <input value={editForm.make} placeholder="e.g. Samsung" onChange={(e) => setEditForm((f) => ({ ...f, make: e.target.value }))} />
            </label>
            <label className="filter-field">Model
              <input value={editForm.equipmentModel} onChange={(e) => setEditForm((f) => ({ ...f, equipmentModel: e.target.value }))} />
            </label>
            <label className="filter-field">Type
              <input value={editForm.equipmentType} placeholder="e.g. Cassette, Hi-wall, VRF" onChange={(e) => setEditForm((f) => ({ ...f, equipmentType: e.target.value }))} />
            </label>
            <label className="filter-field">Division
              <select value={editForm.division} onChange={(e) => setEditForm((f) => ({ ...f, division: e.target.value }))}>
                <option value="">— not set —</option>
                {myDivisions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="filter-field">Cover
              <select value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}>
                <option>AMC</option><option>Warranty</option>
              </select>
            </label>
            <label className="filter-field">Frequency
              <select value={editForm.amcType} onChange={(e) => setEditForm((f) => ({ ...f, amcType: e.target.value }))}>
                {AMC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="filter-field">Amount
              <input type="number" min="0" value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
            </label>
            <label className="filter-field">Start date
              <input type="date" value={editForm.startDate} onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))} />
            </label>
            <label className="filter-field">End date
              <input type="date" value={editForm.endDate} onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))} />
              <span className="muted" style={{ fontSize: 12 }}>Leave blank if there is no end date.</span>
            </label>
          </div>

          {/* Owner decision (23 Nov 2026): one AMC, more than one address —
              "Kapil Agency has a site in Baner and Nana Peth". One amount
              for the contract; each site keeps its own machine details and
              its own PM visits. */}
          <fieldset className="contacts-field" style={{ marginTop: 12 }}>
            <legend>Other addresses under this AMC</legend>
            <p className="muted" style={{ marginTop: 0 }}>
              Only if ONE contract covers more than one address. Your AMC records stay one
              per address, so leave this empty unless a single contract really does cover two
              places. An address added here gets a PM visit schedule of its own on this same
              contract; removing it removes its visit history with it.
            </p>
            {(editForm.extraSites || []).map((row, k) => (
              <div className="filter-grid" key={k} style={{ marginBottom: 8 }}>
                <label className="filter-field">Address *
                  <input
                    value={row.name}
                    placeholder="e.g. Nana Peth"
                    onChange={(e) => setEditForm((f) => {
                      const list = [...f.extraSites];
                      list[k] = { ...list[k], name: e.target.value };
                      return { ...f, extraSites: list };
                    })}
                  />
                </label>
                <label className="filter-field">Capacity
                  <input
                    value={row.capacity}
                    onChange={(e) => setEditForm((f) => {
                      const list = [...f.extraSites];
                      list[k] = { ...list[k], capacity: e.target.value };
                      return { ...f, extraSites: list };
                    })}
                  />
                </label>
                <label className="filter-field">Make
                  <input
                    value={row.make}
                    placeholder="e.g. Daikin"
                    onChange={(e) => setEditForm((f) => {
                      const list = [...f.extraSites];
                      list[k] = { ...list[k], make: e.target.value };
                      return { ...f, extraSites: list };
                    })}
                  />
                </label>
                <label className="filter-field">Model
                  <input
                    value={row.equipmentModel}
                    onChange={(e) => setEditForm((f) => {
                      const list = [...f.extraSites];
                      list[k] = { ...list[k], equipmentModel: e.target.value };
                      return { ...f, extraSites: list };
                    })}
                  />
                </label>
                <label className="filter-field">Type
                  <input
                    value={row.equipmentType}
                    placeholder="e.g. Cassette, VRF"
                    onChange={(e) => setEditForm((f) => {
                      const list = [...f.extraSites];
                      list[k] = { ...list[k], equipmentType: e.target.value };
                      return { ...f, extraSites: list };
                    })}
                  />
                </label>
                <div className="filter-field" style={{ alignSelf: 'end' }}>
                  <button
                    type="button"
                    className="btn danger sm"
                    onClick={() => setEditForm((f) => ({
                      ...f, extraSites: f.extraSites.filter((_, j) => j !== k),
                    }))}
                  >
                    Remove this address
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn sec sm"
              onClick={() => setEditForm((f) => ({
                ...f,
                extraSites: [...(f.extraSites || []), { name: '', capacity: '', make: '', equipmentModel: '', equipmentType: '' }],
              }))}
            >
              + Add another address
            </button>
          </fieldset>

          <ContactsField
            value={editForm.contacts}
            onChange={(contacts) => setEditForm((f) => ({ ...f, contacts }))}
          />

          <div className="detail-actions">
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn sec" onClick={() => setShowEdit(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* ---- Totals ---- */}
      <div className="panel">
        <h3>Service summary</h3>
        <div className="stat-grid">
          <Stat label="Services given" value={stats.completedCalls} sub={stats.openCalls ? `${stats.openCalls} open` : 'none open'} />
          <Stat label="AMC visits done" value={`${stats.amcVisitsDone} / ${stats.amcVisitsScheduled}`} sub="all periods" />
          <Stat label="Complaints" value={stats.complaints} />
          <Stat label="After AMC expired" value={stats.afterExpiry} sub="still kept here" />
          <Stat label="Parts repaired" value={stats.partsRepaired} />
          <Stat label="Parts replaced" value={stats.partsReplaced} />
          <Stat label="Gas filled" value={`${stats.gasFills}×`} sub={stats.gasKg ? `${stats.gasKg} kg in all` : ''} />
          <Stat label="Charged" value={money(stats.chargedAmount)} sub="chargeable services" />
        </div>
      </div>

      {/* ---- AMC letter ---- */}
      <div className="panel">
        <h3>AMC letter</h3>
        {!paid ? (
          <p className="muted" style={{ margin: 0 }}>The AMC letter can be sent once the AMC is marked paid.</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Paid {money(c.payment.amountPaid)} on {fmtDate(c.payment.paidOn)}
              {c.payment.mode ? ` by ${c.payment.mode}` : ''}{c.payment.reference ? ` (ref ${c.payment.reference})` : ''}.
            </p>
            <div className="detail-actions" style={{ flexWrap: 'wrap' }}>
              {letterUrl
                ? <a className="btn sec sm" href={letterUrl} target="_blank" rel="noopener noreferrer">Open AMC letter (PDF)</a>
                : <button className="btn sec sm" disabled>Preparing letter…</button>}
              {sender && waLink && (
                <a className="btn pri sm" href={waLink} target="_blank" rel="noopener noreferrer">
                  Send AMC letter on WhatsApp{companyWa ? ` (from ${displayNumber(companyWa)})` : ''}
                </a>
              )}
            </div>
            {sender && !c.phone && <p className="muted">Add the client&apos;s phone number to send it on WhatsApp.</p>}
            {sender && companyWa && (
              <p className="muted" style={{ fontSize: 13 }}>
                WhatsApp sends from the number logged in on this phone or laptop — use the device with {displayNumber(companyWa)}.
              </p>
            )}
            {!sender && <p className="muted" style={{ fontSize: 13 }}>The service manager sends the letter from the company WhatsApp number.</p>}
          </>
        )}
      </div>

      {/* ---- Customer & cover ---- */}
      <div className="panel">
        <h3>Customer &amp; cover</h3>
        <div className="detail-grid">
          {/* Owner's wording (23 Nov 2026): Customer Name is the person,
              Site is the firm. */}
          <div><strong>Customer Name</strong><br />{c.customer || '—'}</div>
          <div><strong>Phone</strong><br />{c.phone || '—'}</div>
          <div><strong>Email</strong><br />{c.email || '—'}</div>
          <div><strong>Site</strong><br />{c.site || '—'}</div>
          <div><strong>Address</strong><br />{c.address || '—'}</div>
          <div><strong>Capacity</strong><br />{c.capacity || '—'}</div>
          <div><strong>Make</strong><br />{c.make || '—'}</div>
          <div><strong>Model</strong><br />{c.equipmentModel || '—'}</div>
          <div><strong>Type</strong><br />{c.equipmentType || '—'}</div>
          <div><strong>Division</strong><br />{c.division || '—'}</div>
          <div><strong>Cover</strong><br />{c.category} · {c.amcType}</div>
          <div><strong>Period</strong><br />{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</div>
          <div><strong>Amount</strong><br />{money(c.amount)}</div>
        </div>
        {(c.contacts || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong>Contacts at this client</strong>
            <ContactsList contacts={c.contacts} />
          </div>
        )}
        {c.originatingProjectId && (
          <button className="btn sec sm" style={{ marginTop: 8 }} onClick={() => navigate(`/projects/${c.originatingProjectId}`)}>View project</button>
        )}
      </div>

      {/* ---- History ---- */}
      <div className="panel">
        <h3>Service history ({historyRows.length})</h3>
        {historyRows.length === 0 ? (
          <p className="muted">Nothing recorded for this client yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Call</th><th>Date</th><th>Type</th><th>Cover</th><th>Engineer</th><th>Status</th><th>Parts</th><th>Gas</th><th />
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (row.kind === 'call' ? (
                  <tr key={row.key}>
                    <td><Link to={`/service-calls/${row.r.id}`}>PSC-{row.r.complaintNumber}</Link></td>
                    <td>{fmtDate(row.r.appointmentDate || row.r.registeredDate)}</td>
                    <td>{row.r.type === 'PM' ? 'AMC visit' : 'Complaint'}</td>
                    <td><span className={`status-badge ${coverageClass(row.r.coverage)}`}>{row.r.coverage}</span></td>
                    <td>{row.r.engineer || '—'}</td>
                    <td><span className={`status-badge ${callStatusClass(row.r.status)}`}>{row.r.status}</span></td>
                    <td>{row.r.parts.length ? row.r.parts.map((x) => `${x.part} (${x.action})`).join(', ') : '—'}</td>
                    <td>{row.r.gasFilled ? `${row.r.gasType || 'Yes'}${row.r.gasQtyKg ? ` · ${row.r.gasQtyKg} kg` : ''}` : '—'}</td>
                    <td />
                  </tr>
                ) : (
                  /* A completed AMC visit from the contract's own schedule —
                     the service tracker's history. It has no call number,
                     engineer or parts, so those columns stay blank rather than
                     being filled with something invented. */
                  <tr key={row.key}>
                    <td className="muted">PM {row.v.i + 1}</td>
                    <td><strong>{fmtDate(row.v.completedDate)}</strong></td>
                    {/* Which site it was, when the AMC covers several. */}
                    <td>AMC PM visit{manySites && row.v.siteName ? ` \u2014 ${row.v.siteName}` : ''}</td>
                    <td><span className={`status-badge ${coverageClass(c.category)}`}>{c.category}</span></td>
                    <td>—</td>
                    <td><span className="status-badge status-won">Completed</span></td>
                    <td>—</td>
                    <td>—</td>
                    <td>
                      {row.v.current && MANAGE_ROLES.includes(role) ? (() => {
                        const vk = visitKey(row.v.siteIndex, row.v.i);
                        return (
                          <span className="visit-edit">
                            <input
                              type="date"
                              aria-label={`Completed date for visit ${row.v.i + 1}${manySites && row.v.siteName ? ` at ${row.v.siteName}` : ''}`}
                              value={visitDraft[vk] !== undefined ? visitDraft[vk] : fmtDate(row.v.completedDate)}
                              onChange={(ev) => setVisitDraft((pv) => ({ ...pv, [vk]: ev.target.value }))}
                            />
                            <button type="button" className="btn sm sec" disabled={busyVisit === vk}
                              onClick={() => saveVisit(row.v.siteIndex, row.v.i)}>{busyVisit === vk ? '…' : 'Save'}</button>
                            <button type="button" className="btn sm ghost" disabled={busyVisit === vk}
                              onClick={() => saveVisit(row.v.siteIndex, row.v.i, '')}>Clear</button>
                          </span>
                        );
                      })() : null}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Upcoming / pending PM schedule ----
           Deliberately separate from the completed list below: a visit that
           has been done is history, and must never read as something still
           owed to the client. */}
      {/* Owner decision (31 Oct 2026): the client's own link to the portal
          lives on their record, so it can be sent again at any time. */}
      <PortalInvitePanel contractId={c.id} customerName={c.customer} />

      <div className="panel">
        <h3>Upcoming PM visits</h3>
        {pendingVisits.length === 0 ? (
          <p className="muted">
            {(c.scheduledVisits || []).length === 0
              ? 'No visit schedule on this contract.'
              : 'Every scheduled visit for this period has been completed.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th>{manySites && <th>Address</th>}<th>Scheduled month</th><th>Status</th><th>Record completion</th></tr></thead>
              <tbody>
                {pendingVisits.map((v) => {
                  const due = v.month <= tm;
                  const overdue = v.month < tm;
                  const label = overdue ? 'Overdue' : due ? 'Due' : 'Upcoming';
                  const cls = overdue ? 'status-lost' : due ? 'status-pending' : 'status-open';
                  const key = visitKey(v.siteIndex, v.i);
                  return (
                    <tr key={key}>
                      <td>{v.i + 1}</td>
                      {manySites && <td><strong>{v.siteName}</strong></td>}
                      <td>{v.month}</td>
                      <td><span className={`status-badge ${cls}`}>{label}</span></td>
                      <td>
                        {MANAGE_ROLES.includes(role) ? (
                          <span className="visit-edit">
                            <input
                              type="date"
                              aria-label={`Completed date for visit ${v.i + 1}${manySites ? ` at ${v.siteName}` : ''}`}
                              value={visitDraft[key] !== undefined ? visitDraft[key] : ''}
                              onChange={(ev) => setVisitDraft((p) => ({ ...p, [key]: ev.target.value }))}
                            />
                            <button type="button" className="btn sm sec" disabled={busyVisit === key}
                              onClick={() => saveVisit(v.siteIndex, v.i)}>{busyVisit === key ? '\u2026' : 'Save'}</button>
                          </span>
                        ) : '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Earlier periods ---- */}
      {Array.isArray(c.renewals) && c.renewals.length > 0 && (
        <div className="panel">
          <h3>Earlier periods</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Period</th><th>Visits</th><th>Done</th><th>Amount</th><th>Payment</th></tr></thead>
              <tbody>
                {c.renewals.slice().reverse().map((r, i) => (
                  <tr key={i}>
                    <td>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</td>
                    <td>{r.amcType}</td>
                    <td>{(r.visits || []).filter((v) => v.completedDate).length} / {(r.visits || []).length}</td>
                    <td>{money(r.amount)}</td>
                    <td>{r.payment && r.payment.status === 'Paid' ? `Paid ${fmtDate(r.payment.paidOn)}` : 'Not recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
