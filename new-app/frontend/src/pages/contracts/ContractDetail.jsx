import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate, today } from '../../utils/format';
import { whatsappUrl, displayNumber, canSendToClients } from '../../utils/whatsapp';

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

const MANAGE_ROLES = ['admin', 'service_mgr'];
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

      {/* ---- Client & cover ---- */}
      <div className="panel">
        <h3>Client</h3>
        <div className="detail-grid">
          <div><strong>Customer</strong><br />{c.customer || '—'}</div>
          <div><strong>Phone</strong><br />{c.phone || '—'}</div>
          <div><strong>Email</strong><br />{c.email || '—'}</div>
          <div><strong>Site</strong><br />{c.site || '—'}</div>
          <div><strong>Capacity</strong><br />{c.capacity || '—'}</div>
          <div><strong>Cover</strong><br />{c.category} · {c.amcType}</div>
          <div><strong>Period</strong><br />{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</div>
          <div><strong>Amount</strong><br />{money(c.amount)}</div>
        </div>
        {c.originatingProjectId && (
          <button className="btn sec sm" style={{ marginTop: 8 }} onClick={() => navigate(`/projects/${c.originatingProjectId}`)}>View project</button>
        )}
      </div>

      {/* ---- History ---- */}
      <div className="panel">
        <h3>Service history ({calls.length})</h3>
        {calls.length === 0 ? (
          <p className="muted">No service calls yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Call</th><th>Date</th><th>Type</th><th>Cover</th><th>Engineer</th><th>Status</th><th>Parts</th><th>Gas</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/service-calls/${r.id}`}>PSC-{r.complaintNumber}</Link></td>
                    <td>{fmtDate(r.appointmentDate || r.registeredDate)}</td>
                    <td>{r.type === 'PM' ? 'AMC visit' : 'Complaint'}</td>
                    <td><span className={`status-badge ${coverageClass(r.coverage)}`}>{r.coverage}</span></td>
                    <td>{r.engineer || '—'}</td>
                    <td><span className={`status-badge ${callStatusClass(r.status)}`}>{r.status}</span></td>
                    <td>{r.parts.length ? r.parts.map((p) => `${p.part} (${p.action})`).join(', ') : '—'}</td>
                    <td>{r.gasFilled ? `${r.gasType || 'Yes'}${r.gasQtyKg ? ` · ${r.gasQtyKg} kg` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- This period's scheduled visits ---- */}
      <div className="panel">
        <h3>Scheduled AMC visits — this period</h3>
        {(!c.scheduledVisits || c.scheduledVisits.length === 0) ? (
          <p className="muted">No scheduled visits.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Month</th><th>Status</th><th>Completed</th></tr></thead>
              <tbody>
                {c.scheduledVisits.map((v, i) => {
                  const done = !!v.completedDate;
                  const due = !done && v.month <= tm;
                  const overdue = due && v.month < tm;
                  const label = done ? 'Completed' : overdue ? 'Overdue' : due ? 'Due' : 'Upcoming';
                  const cls = done ? 'status-won' : overdue ? 'status-lost' : due ? 'status-pending' : 'status-open';
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{v.month}</td>
                      <td><span className={`status-badge ${cls}`}>{label}</span></td>
                      <td>{v.completedDate ? fmtDate(v.completedDate) : '—'}</td>
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
