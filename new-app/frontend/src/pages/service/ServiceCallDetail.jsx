import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

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
const SERVICE_TYPES = ['Installation', 'Warranty', 'AMC', 'Chargeable'];
const CHECKLIST_OPTIONS = ['OK', 'Not OK', 'N/A'];

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
  });
  const [reportSaving, setReportSaving] = useState(false);

  /* Completion */
  const [signatureImage, setSignatureImage] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');

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
        serviceType: r.serviceType || '',
        amount: r.amount != null ? String(r.amount) : '',
        engineerRemark: r.engineerRemark || '',
        customerRemark: r.customerRemark || '',
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
  async function handleSaveReport(e) {
    e.preventDefault();
    setReportSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/service-calls/${id}/report`, {
        method: 'PUT',
        body: {
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
        },
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
        /* report fields are rebuilt server-side from saved draft */
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
      });
      setCompletionMessage(data.customerMessage || '');
      setShowComplete(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  }

  /* ---- WhatsApp deep-link ---- */
  function whatsappLink() {
    if (!sc?.phone || !completionMessage) return null;
    const phone = sc.phone.replace(/\D/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(completionMessage)}`;
  }

  function copyMessage() {
    navigator.clipboard.writeText(completionMessage).then(
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
        </div>
      </div>

      {/* ---- Contract Link (PM calls) ---- */}
      {sc.contractId && (
        <div className="panel">
          <h3>Contract Reference</h3>
          <Link to={`/contracts/${sc.contractId}`} className="btn sec sm">
            View Originating Contract
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
                    <option value="">— Select —</option>
                    {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Amount (₹)</label>
                  <input type="number" value={reportForm.amount} onChange={e => setReportForm(prev => ({ ...prev, amount: e.target.value }))} />
                </div>
              </div>

              <div className="filter-field full-width" style={{ marginTop: 8 }}>
                <label>Service Description</label>
                <textarea rows={3} value={reportForm.serviceDescription} onChange={e => setReportForm(prev => ({ ...prev, serviceDescription: e.target.value }))} />
              </div>

              {/* Checklist */}
              <div style={{ marginTop: 12 }}>
                <strong>Checklist:</strong>
                <div style={{ marginTop: 8 }}>
                  {CHECKLIST_KEYS.map(key => (
                    <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ minWidth: 140, fontSize: 13 }}>{key}</span>
                      <select
                        value={reportForm.checklistResults[key] || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setReportForm(prev => ({
                            ...prev,
                            checklistResults: { ...prev.checklistResults, [key]: val },
                          }));
                        }}
                        style={{ padding: '4px 8px', fontSize: 13, borderRadius: 6, border: '1px solid var(--color-border)' }}
                      >
                        <option value="">—</option>
                        {CHECKLIST_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
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
            <div><strong>Customer Remark:</strong> {sc.report.customerRemark || '—'}</div>
          </div>
          {/* Checklist results */}
          {sc.report.checklistResults && (
            <div style={{ marginTop: 8 }}>
              <strong>Checklist:</strong>
              <div style={{ marginTop: 4 }}>
                {CHECKLIST_KEYS.map(key => (
                  <div key={key} style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 2 }}>
                    <span style={{ minWidth: 140 }}>{key}:</span>
                    <span>{sc.report.checklistResults[key] || '—'}</span>
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
          {showComplete && (
            <div style={{ marginTop: 8 }}>
              <div className="filter-field">
                <label>Client Signature (base64 image or text) *</label>
                <textarea
                  rows={3}
                  value={signatureImage}
                  onChange={e => setSignatureImage(e.target.value)}
                  placeholder="Paste base64 data URI or signature text..."
                />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button
                  className="btn pri"
                  onClick={handleComplete}
                  disabled={completing || !signatureImage}
                >
                  {completing ? 'Completing...' : 'Complete & Generate Report'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Customer Message (post-completion) ---- */}
      {completionMessage && (
        <div className="panel">
          <h3>Customer Message</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f6f8', padding: 12, borderRadius: 6, fontSize: 13 }}>
            {completionMessage}
          </pre>
          <div className="detail-actions">
            <button className="btn sec sm" onClick={copyMessage}>Copy Message</button>
            {whatsappLink() && (
              <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="btn pri sm">
                Send via WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      {/* ---- Payment Link (Chargeable completion creates payment) ---- */}
      {isCompleted && sc.report?.serviceType === 'Chargeable' && sc.report?.amount > 0 && sc.paymentId && (
        <div className="panel">
          <h3>Payment Created</h3>
          <Link to={`/payments`} className="btn sec sm">
            View Payment Ledger
          </Link>
        </div>
      )}
    </div>
  );
}
