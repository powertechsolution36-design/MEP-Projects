import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { api, apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import SignaturePad from '../../components/SignaturePad';
import { whatsappUrl, displayNumber, canSendToClients } from '../../utils/whatsapp';

/**
 * Service Call Detail — PWA `viewServiceCall(x)` exact reproduction.
 *
 * Sections:
 *   1. Customer info (customer, phone, site)
 *   2. Call info (complaintNumber, type, status, registeredDate, appointmentDate/Time)
 *   3. Contract link (for PM calls — link to originating contract)
 *   4. Complaint description
 *   5. Assign engineer (MANAGE_ROLES: engineer select + date/time)
 *   6. Report (make/model/capacity/type/materialUsed/serviceDescription/
 *      checklistResults/serviceType/amount/engineerRemark/customerRemark)
 *   7. Complete button (signature-only gate)
 *   8. Customer message (WhatsApp deep-link + clipboard)
 *   9. Payment link (if Chargeable + completed with amount > 0)
 *
 * PWA FACT: any authenticated company member can view detail.
 * PWA FACT: assign/report/complete gated to MANAGE_ROLES + assigned engineer.
 * PWA FACT: no delete/cancel/reopen.
 */

const MANAGE_ROLES = ['admin', 'service_mgr'];
const CHECKLIST_KEYS = ['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'];
// OWNER DECISION (21 Oct 2026): each checklist item is a tick (Done) or a
// cross (Not done), and the call can only be completed once the report is
// filled -- Service Description written and every item answered. The server
// enforces the same rule (REPORT_INCOMPLETE).
const CHECK_DONE = 'Done';
const CHECK_NOT_DONE = 'Not done';

function missingReportParts(form) {
  const missing = [];
  if (!String(form.serviceDescription || '').trim()) missing.push('Service Description');
  CHECKLIST_KEYS.forEach((key) => {
    const v = form.checklistResults ? form.checklistResults[key] : '';
    if (v !== CHECK_DONE && v !== CHECK_NOT_DONE) missing.push(key);
  });
  // A listed part must say whether it was repaired or replaced.
  (form.partsWork || []).forEach((p) => {
    if (String(p.part || '').trim() && p.action !== 'Repaired' && p.action !== 'Replaced') {
      missing.push(`Repaired or Replaced for "${String(p.part).trim()}"`);
    }
  });
  return missing;
}
const SERVICE_TYPES = ['Installation', 'Warranty', 'AMC', 'Chargeable'];

/** Same rule as the server (serviceCallService.defaultServiceType). */
function defaultServiceType(call) {
  if (call.type === 'PM') return 'AMC';
  if (call.coverage === 'AMC') return 'AMC';
  if (call.coverage === 'Warranty') return 'Warranty';
  return 'Chargeable';
}

function statusClass(status) {
  if (status === 'Registered') return 'status-pending';
  if (status === 'Assigned') return 'status-open';
  if (status === 'Scheduled') return 'status-won';
  if (status === 'Completed') return 'status-received';
  return '';
}

export default function ServiceCallDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [sc, setSc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Engineer candidates for assignment */
  const [engineers, setEngineers] = useState([]);

  /* Assignment form */
  const [assignForm, setAssignForm] = useState({
    engineerId: '',
    appointmentDate: '',
    appointmentTime: '',
  });
  const [assignSaving, setAssignSaving] = useState(false);

  /* Report form */
  const [reportForm, setReportForm] = useState({
    make: '',
    model: '',
    capacity: '',
    type: '',
    materialUsed: '',
    serviceDescription: '',
    checklistResults: {},
    serviceType: '',
    amount: '',
    engineerRemark: '',
    customerRemark: '',
    partsWork: [],
    gasFilled: false,
    gasType: '',
    gasQtyKg: '',
  });
  const [reportSaving, setReportSaving] = useState(false);

  /* Completion */
  const [signatureImage, setSignatureImage] = useState('');
  const [completing, setCompleting] = useState(false);
  // Also carries the registration confirmation message handed over by
  // ServiceCallCreate (PWA FACT: saveCall() shows it right after saving).
  const location = useLocation();
  const [completionMessage, setCompletionMessage] = useState(location.state?.customerMessage || '');
  // Owner decision (21 Oct 2026): the completed report goes to the client as
  // a PDF link inside the WhatsApp message.
  const [reportToken, setReportToken] = useState('');

  /* Show/hide sections */
  const [showAssign, setShowAssign] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showComplete, setShowComplete] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/service-calls/${id}`);
      const call = data.serviceCall || data;
      setSc(call);

      /* Pre-fill assignment form from existing data */
      setAssignForm({
        engineerId: call.engineerId || '',
        appointmentDate: call.appointmentDate ? fmtDate(call.appointmentDate) : '',
        appointmentTime: call.appointmentTime || '',
      });

      /* Pre-fill report form from existing data */
      const r = call.report || {};
      const cl = {};
      CHECKLIST_KEYS.forEach(k => { cl[k] = r.checklistResults?.[k] || ''; });
      setReportForm({
        make: r.make || '',
        model: r.model || '',
        capacity: r.capacity || '',
        type: r.type || '',
        materialUsed: r.materialUsed || '',
        serviceDescription: r.serviceDescription || '',
        checklistResults: cl,
        // PWA FACT (index.html:3571): PM calls default to AMC. Since 22 Oct
        // 2026 a complaint follows its coverage: a covered AMC / Warranty
        // client defaults to that, everything else to Chargeable.
        serviceType: r.serviceType || defaultServiceType(call),
        amount: r.amount != null ? String(r.amount) : '',
        engineerRemark: r.engineerRemark || '',
        customerRemark: r.customerRemark || '',
        partsWork: Array.isArray(r.partsWork) ? r.partsWork.map(p => ({ ...p })) : [],
        gasFilled: !!r.gasFilled,
        gasType: r.gasType || '',
        gasQtyKg: r.gasQtyKg ? String(r.gasQtyKg) : '',
      });

      setSignatureImage(call.clientSignatureImage || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  /* Load engineer candidates */
  useEffect(() => {
    api.get('/api/service-calls/engineer-candidates')
      .then(data => setEngineers(data.candidates || []))
      .catch(() => { /* ignore — list simply won't show */ });
  }, []);

  /* Resolve engineer name from candidates list */
  function engineerName(engineerId) {
    if (!engineerId) return '';
    const eng = engineers.find(e => e.id === engineerId);
    return eng ? eng.name : '';
  }

  useEffect(() => { reload(); }, [reload]);

  const canManage = MANAGE_ROLES.includes(user?.role);
  const isAssignedEngineer = sc?.engineerId === user?.id;
  const canEdit = canManage || isAssignedEngineer;
  const isCompleted = sc?.status === 'Completed';

  useEffect(() => {
    if (!isCompleted || reportToken) return undefined;
    let cancelled = false;
    api.get(`/api/service-calls/${id}/report-link`)
      .then((d) => { if (!cancelled && d && d.reportToken) setReportToken(d.reportToken); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, isCompleted, reportToken]);

  // Owner decision (22 Oct 2026): client messages go out from the company
  // WhatsApp number, which lives on the service manager's / admin's device.
  const [companyWa, setCompanyWa] = useState('');
  useEffect(() => {
    api.get('/api/companies/my-profile')
      .then((d) => setCompanyWa((d.company && d.company.whatsappNumber) || ''))
      .catch(() => {});
  }, []);
  const sender = canSendToClients(user?.role);
  const fromLabel = companyWa ? ` (from ${displayNumber(companyWa)})` : '';

  async function markSent() {
    try {
      await api.post(`/api/service-calls/${id}/report-sent`, {});
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  const reportUrl = reportToken && typeof window !== 'undefined'
    ? `${window.location.origin}/api/public/service-reports/${reportToken}`
    : '';
  const messageWithReport = completionMessage && reportUrl
    ? `${completionMessage}\n\nYour service report (PDF): ${reportUrl}`
    : completionMessage;
  const reportOnlyMessage = sc && reportUrl
    ? `Dear ${sc.customer || 'Customer'},\n\nPlease find the service report for your service call PSC-${sc.complaintNumber}:\n${reportUrl}\n\nThank you.`
    : '';
  const reportMissing = missingReportParts(reportForm);

  /* ---- Assignment ---- */
  async function handleAssign(e) {
    e.preventDefault();
    setAssignSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/service-calls/${id}/assign`, {
        method: 'PUT',
        body: {
          engineerId: assignForm.engineerId || undefined,
          appointmentDate: assignForm.appointmentDate || undefined,
          appointmentTime: assignForm.appointmentTime || undefined,
        },
      });
      setShowAssign(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssignSaving(false);
    }
  }

  /* ---- Report Draft Save ---- */
  /** The report as the server expects it — shared by Save and Complete. */
  function reportPayload() {
    return {
      make: reportForm.make,
      model: reportForm.model,
      capacity: reportForm.capacity,
      type: reportForm.type,
      materialUsed: reportForm.materialUsed,
      serviceDescription: reportForm.serviceDescription,
      checklistResults: reportForm.checklistResults,
      serviceType: reportForm.serviceType,
      amount: reportForm.amount !== '' ? Number(reportForm.amount) : 0,
      engineerRemark: reportForm.engineerRemark,
      customerRemark: reportForm.customerRemark,
      partsWork: (reportForm.partsWork || []).filter(p => String(p.part || '').trim()),
      gasFilled: !!reportForm.gasFilled,
      gasType: reportForm.gasFilled ? reportForm.gasType : '',
      gasQtyKg: reportForm.gasFilled && reportForm.gasQtyKg !== '' ? Number(reportForm.gasQtyKg) : 0,
    };
  }

  function setPart(idx, key, value) {
    setReportForm(prev => {
      const list = [...(prev.partsWork || [])];
      list[idx] = { ...list[idx], [key]: value };
      return { ...prev, partsWork: list };
    });
  }

  async function handleSaveReport(e) {
    e.preventDefault();
    setReportSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/service-calls/${id}/report`, {
        method: 'PUT',
        body: reportPayload(),
      });
      setShowReport(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setReportSaving(false);
    }
  }

  /* ---- Complete ---- */
  async function handleComplete() {
    if (missingReportParts(reportForm).length) return;
    if (!signatureImage) {
      alert('Client signature is required to complete.');
      return;
    }
    if (!window.confirm('Complete this service call? This cannot be undone.')) return;
    setCompleting(true);
    setError(null);
    try {
      const data = await api.post(`/api/service-calls/${id}/complete`, {
        clientSignatureImage: signatureImage,
        ...reportPayload(),
      });
      setCompletionMessage(data.customerMessage || '');
      if (data.reportToken) setReportToken(data.reportToken);
      setShowComplete(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  }

  /* ---- WhatsApp deep-link ---- */
  function whatsappLink(text = messageWithReport) {
    if (!sc?.phone || !text) return null;
    return whatsappUrl(sc.phone, text);
  }

  function copyMessage() {
    navigator.clipboard.writeText(messageWithReport).then(
      () => alert('Message copied to clipboard!'),
      () => alert('Failed to copy.')
    );
  }

  if (loading) return <div className="enq-page"><p className="muted">Loading...</p></div>;
  if (error && !sc) return <div className="enq-page"><p style={{ color: 'red' }}>{error}</p></div>;
  if (!sc) return <div className="enq-page"><p className="muted">Service call not found.</p></div>;

  return (
    <div className="enq-page">
      <div className="enq-header">
        <h2>Service Call {sc.complaintNumber || ''}</h2>
        <div className="enq-actions">
          <button className="btn sec" onClick={() => navigate('/service-calls')}>
            Back to List
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* ---- Customer Info ---- */}
      <div className="panel">
        <h3>Customer Information</h3>
        <div className="detail-grid">
          <div><strong>Customer:</strong> {sc.customer || '—'}</div>
          <div><strong>Phone:</strong> {sc.phone || '—'}</div>
          <div><strong>Site:</strong> {sc.site || '—'}</div>
        </div>
      </div>

      {/* ---- Call Info ---- */}
      <div className="panel">
        <h3>Call Information</h3>
        <div className="detail-grid">
          <div><strong>Complaint #:</strong> {sc.complaintNumber || '—'}</div>
          <div><strong>Type:</strong> {sc.type || '—'}</div>
          <div><strong>Status:</strong> <span className={`status-badge ${statusClass(sc.status)}`}>{sc.status}</span></div>
          <div><strong>Registered:</strong> {fmtDate(sc.registeredDate)}</div>
          <div><strong>Appointment Date:</strong> {fmtDate(sc.appointmentDate) || '—'}</div>
          <div><strong>Appointment Time:</strong> {sc.appointmentTime || '—'}</div>
          <div><strong>Coverage:</strong> {sc.coverage || 'Chargeable'}</div>
        </div>
      </div>

      {/* ---- Contract Link (PM calls) ---- */}
      {sc.contractId && (
        <div className="panel">
          <h3>AMC / Warranty Client</h3>
          <Link to={`/contracts/${sc.contractId}`} className="btn sec sm">
            Open client history
          </Link>
        </div>
      )}

      {/* ---- Description ---- */}
      {sc.complaintDescription && (
        <div className="panel">
          <h3>Description</h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{sc.complaintDescription}</p>
        </div>
      )}

      {/* ---- Engineer Assignment ---- */}
      {canManage && !isCompleted && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Engineer Assignment</h3>
            <button className="btn sec sm" onClick={() => setShowAssign(!showAssign)}>
              {showAssign ? 'Cancel' : (sc.engineerId ? 'Reassign' : 'Assign Engineer')}
            </button>
          </div>
          {sc.engineerId && !showAssign && (
            <p><strong>Assigned:</strong> {engineerName(sc.engineerId) || sc.engineerId}</p>
          )}
          {showAssign && (
            <form onSubmit={handleAssign} style={{ marginTop: 8 }}>
              <div className="form-grid">
                <div className="filter-field">
                  <label>Engineer</label>
                  <select
                    value={assignForm.engineerId}
                    onChange={e => setAssignForm(prev => ({ ...prev, engineerId: e.target.value }))}
                  >
                    <option value="">— Select —</option>
                    {engineers.map(eng => (
                      <option key={eng.id} value={eng.id}>{eng.name} ({eng.role})</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Appointment Date</label>
                  <input
                    type="date"
                    value={assignForm.appointmentDate}
                    onChange={e => setAssignForm(prev => ({ ...prev, appointmentDate: e.target.value }))}
                  />
                </div>
                <div className="filter-field">
                  <label>Appointment Time</label>
                  <input
                    type="time"
                    value={assignForm.appointmentTime}
                    onChange={e => setAssignForm(prev => ({ ...prev, appointmentTime: e.target.value }))}
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="submit" className="btn pri sm" disabled={assignSaving}>
                  {assignSaving ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {!canManage && sc.engineerId && (
        <div className="panel">
          <h3>Assigned Engineer</h3>
          <p>{engineerName(sc.engineerId) || sc.engineerId}</p>
        </div>
      )}

      {/* ---- Report Section ---- */}
      {canEdit && !isCompleted && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Service Report</h3>
            <button className="btn sec sm" onClick={() => setShowReport(!showReport)}>
              {showReport ? 'Cancel' : 'Edit Report'}
            </button>
          </div>
          {showReport && (
            <form onSubmit={handleSaveReport} style={{ marginTop: 8 }}>
              <div className="form-grid">
                <div className="filter-field">
                  <label>Make</label>
                  <input type="text" value={reportForm.make} onChange={e => setReportForm(prev => ({ ...prev, make: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Model</label>
                  <input type="text" value={reportForm.model} onChange={e => setReportForm(prev => ({ ...prev, model: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Capacity</label>
                  <input type="text" value={reportForm.capacity} onChange={e => setReportForm(prev => ({ ...prev, capacity: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Type</label>
                  <input type="text" value={reportForm.type} onChange={e => setReportForm(prev => ({ ...prev, type: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Material Used</label>
                  <input type="text" value={reportForm.materialUsed} onChange={e => setReportForm(prev => ({ ...prev, materialUsed: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Service Type</label>
                  <select value={reportForm.serviceType} onChange={e => setReportForm(prev => ({ ...prev, serviceType: e.target.value }))}>
                    {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Amount (₹)</label>
                  <input type="number" value={reportForm.amount} onChange={e => setReportForm(prev => ({ ...prev, amount: e.target.value }))} />
                </div>
              </div>

              <div className="filter-field full-width" style={{ marginTop: 8 }}>
                <label>Service Description *</label>
                <textarea rows={3} value={reportForm.serviceDescription} onChange={e => setReportForm(prev => ({ ...prev, serviceDescription: e.target.value }))} />
              </div>

              {/* Checklist */}
              <div style={{ marginTop: 12 }}>
                <strong>Checklist *</strong> <span className="muted" style={{ fontSize: 12 }}>tick if done, cross if not</span>
                <div style={{ marginTop: 8 }}>
                  {CHECKLIST_KEYS.map(key => (
                    <div key={key} className="check-row">
                      <span className="check-row-label">{key}</span>
                      <div className="check-toggle" role="group" aria-label={key}>
                        {[[CHECK_DONE, '✓', 'Done'], [CHECK_NOT_DONE, '✗', 'Not done']].map(([val, mark, text]) => {
                          const on = reportForm.checklistResults[key] === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              aria-pressed={on}
                              aria-label={`${key}: ${text}`}
                              className={`check-toggle-btn ${val === CHECK_DONE ? 'is-done' : 'is-not'}${on ? ' on' : ''}`}
                              onClick={() => setReportForm(prev => ({
                                ...prev,
                                checklistResults: { ...prev.checklistResults, [key]: on ? '' : val },
                              }))}
                            >
                              <span aria-hidden="true">{mark}</span> {text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parts repaired / replaced (owner request, 22 Oct 2026) */}
              <div className="filter-field" style={{ marginTop: 12 }}>
                <label>Parts repaired / replaced</label>
                {(reportForm.partsWork || []).length === 0 && (
                  <div style={{ color: '#5b6b7c', fontSize: 13, margin: '2px 0 6px' }}>None — add a part if one was repaired or replaced.</div>
                )}
                {(reportForm.partsWork || []).map((p, idx) => (
                  <div key={idx} className="part-row">
                    <input
                      value={p.part || ''}
                      onChange={e => setPart(idx, 'part', e.target.value)}
                      placeholder="Part (e.g. Run capacitor 45µF)"
                    />
                    <div className="check-toggle" role="group" aria-label={`Was ${p.part || 'this part'} repaired or replaced?`}>
                      {['Repaired', 'Replaced'].map(a => (
                        <button
                          key={a}
                          type="button"
                          className={`check-toggle-btn ${a === 'Repaired' ? 'is-done' : 'is-not'}${p.action === a ? ' on' : ''}`}
                          aria-pressed={p.action === a}
                          onClick={() => setPart(idx, 'action', a)}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <input
                      value={p.remark || ''}
                      onChange={e => setPart(idx, 'remark', e.target.value)}
                      placeholder="Remark (optional)"
                    />
                    <button
                      type="button"
                      className="btn danger sm"
                      title="Remove this part"
                      onClick={() => setReportForm(prev => ({ ...prev, partsWork: prev.partsWork.filter((_, i) => i !== idx) }))}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="btn sec sm"
                    onClick={() => setReportForm(prev => ({ ...prev, partsWork: [...(prev.partsWork || []), { part: '', action: '', remark: '' }] }))}
                  >
                    + Add part
                  </button>
                </div>
              </div>

              {/* Gas filling (owner request, 22 Oct 2026) */}
              <div className="filter-field" style={{ marginTop: 12 }}>
                <label>Gas filled?</label>
                <div className="check-toggle" role="group" aria-label="Gas filled?">
                  {[['Yes', true], ['No', false]].map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      className={`check-toggle-btn ${val ? 'is-done' : 'is-not'}${!!reportForm.gasFilled === val ? ' on' : ''}`}
                      aria-pressed={!!reportForm.gasFilled === val}
                      onClick={() => setReportForm(prev => ({ ...prev, gasFilled: val }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {reportForm.gasFilled && (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <div className="filter-field">
                      <label>Gas type</label>
                      <select value={reportForm.gasType} onChange={e => setReportForm(prev => ({ ...prev, gasType: e.target.value }))}>
                        <option value="">— Select —</option>
                        {['R22', 'R32', 'R410A', 'R407C', 'R134a', 'R290', 'Other'].map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div className="filter-field">
                      <label>Quantity (kg)</label>
                      <input
                        type="number" min={0} step="0.1"
                        value={reportForm.gasQtyKg}
                        onChange={e => setReportForm(prev => ({ ...prev, gasQtyKg: e.target.value }))}
                        placeholder="e.g. 0.8"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="form-grid" style={{ marginTop: 8 }}>
                <div className="filter-field">
                  <label>Engineer Remark</label>
                  <textarea rows={2} value={reportForm.engineerRemark} onChange={e => setReportForm(prev => ({ ...prev, engineerRemark: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Customer Remark</label>
                  <textarea rows={2} value={reportForm.customerRemark} onChange={e => setReportForm(prev => ({ ...prev, customerRemark: e.target.value }))} />
                </div>
              </div>

              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="submit" className="btn pri sm" disabled={reportSaving}>
                  {reportSaving ? 'Saving...' : 'Save Report Draft'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---- Read-only report for completed calls ---- */}
      {isCompleted && sc.report && (
        <div className="panel">
          <h3>Service Report</h3>
          <div className="detail-grid">
            <div><strong>Make:</strong> {sc.report.make || '—'}</div>
            <div><strong>Model:</strong> {sc.report.model || '—'}</div>
            <div><strong>Capacity:</strong> {sc.report.capacity || '—'}</div>
            <div><strong>Type:</strong> {sc.report.type || '—'}</div>
            <div><strong>Material Used:</strong> {sc.report.materialUsed || '—'}</div>
            <div><strong>Service Type:</strong> {sc.report.serviceType || '—'}</div>
            <div><strong>Amount:</strong> {money(sc.report.amount)}</div>
            <div><strong>Service Desc:</strong> {sc.report.serviceDescription || '—'}</div>
            <div><strong>Engineer Remark:</strong> {sc.report.engineerRemark || '—'}</div>
            <div>
              <strong>Parts:</strong>{' '}
              {Array.isArray(sc.report.partsWork) && sc.report.partsWork.length
                ? sc.report.partsWork.map(p => `${p.part} (${p.action})`).join(', ')
                : 'None'}
            </div>
            <div>
              <strong>Gas filled:</strong>{' '}
              {sc.report.gasFilled
                ? `Yes — ${sc.report.gasType || 'type not given'}${Number(sc.report.gasQtyKg) > 0 ? `, ${sc.report.gasQtyKg} kg` : ''}`
                : 'No'}
            </div>
            <div><strong>Customer Remark:</strong> {sc.report.customerRemark || '—'}</div>
          </div>
          {/* Checklist results */}
          {sc.report.checklistResults && (
            <div style={{ marginTop: 8 }}>
              <strong>Checklist:</strong>
              <div style={{ marginTop: 4 }}>
                {CHECKLIST_KEYS.map(key => (
                  <div key={key} style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 4, alignItems: 'center' }}>
                    <span style={{ minWidth: 140 }}>{key}:</span>
                    {sc.report.checklistResults[key] === CHECK_DONE ? (
                      <span className="status-badge b-grn">✓ Done</span>
                    ) : sc.report.checklistResults[key] === CHECK_NOT_DONE ? (
                      <span className="status-badge b-red">✗ Not done</span>
                    ) : (
                      <span>{sc.report.checklistResults[key] || '—'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Client Signature (completed) ---- */}
      {isCompleted && sc.clientSignatureImage && (
        <div className="panel">
          <h3>Client Signature</h3>
          {sc.clientSignatureImage.startsWith('data:') ? (
            <img src={sc.clientSignatureImage} alt="Client Signature" style={{ maxWidth: 300, border: '1px solid var(--color-border)', borderRadius: 6 }} />
          ) : (
            <p className="muted">Signature recorded (text format)</p>
          )}
        </div>
      )}

      {/* ---- Complete Button ---- */}
      {canEdit && !isCompleted && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Complete Service Call</h3>
            <button className="btn sec sm" onClick={() => setShowComplete(!showComplete)}>
              {showComplete ? 'Cancel' : 'Complete'}
            </button>
          </div>
          {showComplete && reportMissing.length > 0 && (
            <div className="report-missing" role="status">
              <p style={{ margin: 0 }}><strong>Fill the service report before completing.</strong></p>
              <p style={{ margin: '4px 0 8px' }}>Still needed: {reportMissing.join(', ')}.</p>
              <button type="button" className="btn sec sm" onClick={() => setShowReport(true)}>Fill Service Report</button>
            </div>
          )}
          {showComplete && reportMissing.length === 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="filter-field">
                <label>Client Signature (sign on phone) *</label>
                <SignaturePad onChange={setSignatureImage} />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button
                  className="btn pri"
                  onClick={handleComplete}
                  disabled={completing || !signatureImage || reportMissing.length > 0}
                >
                  {completing ? 'Completing...' : 'Complete & Generate Report'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Customer Message (registration / completion) ---- */}
      {completionMessage && (
        <div className="panel">
          <h3>Customer Message</h3>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f4f6f8', padding: 12, borderRadius: 6, fontSize: 13 }}>
            {messageWithReport}
          </pre>
          {isCompleted && !reportUrl && <p className="muted" style={{ fontSize: 12 }}>Preparing the service report link…</p>}
          {sender ? (
            <div className="detail-actions">
              <button className="btn sec sm" onClick={copyMessage}>Copy Message</button>
              {whatsappLink() && (
                <a
                  href={whatsappLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn pri sm"
                  onClick={() => { if (isCompleted) markSent(); }}
                >
                  Send via WhatsApp{fromLabel}
                </a>
              )}
            </div>
          ) : (
            <p className="send-note">
              {isCompleted
                ? 'Done. The service manager has been asked to send this report to the client from the company WhatsApp.'
                : 'The service manager sends client messages from the company WhatsApp.'}
            </p>
          )}
        </div>
      )}

      {/* ---- Service Report PDF + sending (owner decisions 21 & 22 Oct 2026) ---- */}
      {isCompleted && (
        <div className="panel">
          <h3>Service Report (PDF)</h3>
          <div style={{ marginBottom: 8 }}>
            {sc.reportSendStatus === 'Sent' ? (
              <span className="status-badge status-won">Sent to client{sc.reportSentAt ? ` · ${fmtDate(sc.reportSentAt)}` : ''}</span>
            ) : (
              <span className="status-badge status-pending">Waiting to be sent to the client</span>
            )}
          </div>
          {!reportUrl && <p className="muted" style={{ fontSize: 12 }}>Preparing the service report link…</p>}
          <div className="detail-actions" style={{ flexWrap: 'wrap' }}>
            {reportUrl && <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="btn sec sm">Open PDF</a>}
            {sender && reportUrl && whatsappLink(reportOnlyMessage) && (
              <a
                href={whatsappLink(reportOnlyMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn pri sm"
                onClick={markSent}
              >
                {sc.reportSendStatus === 'Sent' ? 'Send again on WhatsApp' : 'Send report on WhatsApp'}{fromLabel}
              </a>
            )}
            {sender && sc.reportSendStatus !== 'Sent' && (
              <button type="button" className="btn sec sm" onClick={markSent}>Mark as sent</button>
            )}
          </div>
          {sender && !sc.phone && <p className="muted" style={{ fontSize: 13 }}>Add the client&apos;s phone number to send on WhatsApp.</p>}
          {sender && companyWa && (
            <p className="muted" style={{ fontSize: 13 }}>
              WhatsApp sends from the number logged in on this phone or laptop — use the device with {displayNumber(companyWa)}.
            </p>
          )}
          {!sender && sc.reportSendStatus !== 'Sent' && (
            <p className="send-note">The service manager has been asked to send this report to the client.</p>
          )}
        </div>
      )}

      {/* PWA FACT (saveReport, Chargeable branch): the completion pushes a
          Pending payment for Finance and notifies them; the call itself keeps
          no payment reference and shows no payment panel. (A former
          "Payment Created" panel here depended on a paymentId the server
          never stores, so it could never appear; removed.) */}
    </div>
  );
}
