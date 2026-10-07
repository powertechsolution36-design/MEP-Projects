import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate, today } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Project Detail — PWA `vProject(x)` exact reproduction.
 *
 * PWA FACT (§15/§22/§30 item 1): NO division or role restriction beyond
 * company membership — ANY authenticated same-company user may view any
 * project's full detail.
 *
 * Sub-sections:
 *   - Identity (name, division, customer, siteType, capacity, vendor)
 *   - SO link
 *   - Stage (separate from status, per-division dropdown, completion gates)
 *   - Status (Ongoing/Completed/In Service — independent of stage)
 *   - Engineers (company-wide pool, full-replace assignment)
 *   - Timeline (set/edit target dates, partial-date handling, timelineReady)
 *   - Checklist (tick/remark/photo/approve/PM-sign, blocked when timeline not ready)
 *   - Execution Updates (append-only)
 *   - Delivery Challans (create/edit/delete/return)
 *
 * Role gates:
 *   isPM (admin or matching-div PM): stage/vendor/engineers/timeline/checklist-mgmt
 *   isPmOrAssignedEngineer: tick/remark/photo/update/DC
 */

/* PWA FACT (STAGES, §5) */
const STAGES_BY_DIVISION = {
  HVAC: ['Planning', 'Piping', 'Installation', 'Testing', 'Finishing', 'Completed'],
  Solar: ['Planning', 'Fabrication', 'Installation', 'Wiring', 'Net Metering', 'Completed'],
  MEP: ['Concept', 'Design In Progress', 'Internal Review', 'Client Review', 'Delivered'],
};

/* PWA FACT (SIGN_ROLES, §9) — reachable sign-responsibility values */
const SIGN_RESPONSIBILITIES = ['ENGINEER', 'CLIENT', 'SALES', 'SERVICE'];

/* PWA FACT: roles that can approve per sign responsibility */
const SIGN_ROLES = {
  ENGINEER: ['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'admin'],
  CLIENT: ['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_eng', 'admin'],
  SALES: ['sales', 'admin'],
  SERVICE: ['service_mgr', 'service_eng', 'admin'],
};

/* PM_DIVISION_FOR_ROLE */
const PM_DIV = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

/* Engineer-candidate roles (company-wide pool, §14) */
const ENGINEER_CANDIDATE_ROLES = ['engineer', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_eng'];

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [proj, setProj] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /* ---------- Role helpers ---------- */
  const isPM = proj && (user?.role === 'admin' || PM_DIV[user?.role] === proj.division);
  const isEng = proj && (proj.assignedEngineerIds || []).some(eid => String(eid) === String(user?.userId));
  const canAct = isPM || isEng; // isPmOrAssignedEngineer
  const notInService = proj && proj.status !== 'In Service';

  /* ---------- Modal states ---------- */
  const [showStageModal, setShowStageModal] = useState(false);
  const [stageForm, setStageForm] = useState('');
  const [stageConfirmMat, setStageConfirmMat] = useState(false);
  const [stageConfirmChk, setStageConfirmChk] = useState(false);

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendorForm, setVendorForm] = useState('');

  const [showEngModal, setShowEngModal] = useState(false);
  const [engCandidates, setEngCandidates] = useState([]);
  const [engSelected, setEngSelected] = useState([]);

  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [timelineDates, setTimelineDates] = useState([]);
  const [timelineStart, setTimelineStart] = useState('');
  const [timelineConfirmPartial, setTimelineConfirmPartial] = useState(false);

  const [showAddPoint, setShowAddPoint] = useState(false);
  const [newPointText, setNewPointText] = useState('');
  const [newPointSign, setNewPointSign] = useState('ENGINEER');

  const [editPointIdx, setEditPointIdx] = useState(null);
  const [editPointText, setEditPointText] = useState('');
  const [editPointSign, setEditPointSign] = useState('');

  const [remarkIdx, setRemarkIdx] = useState(null);
  const [remarkText, setRemarkText] = useState('');

  const [approveIdx, setApproveIdx] = useState(null);
  const [approveForm, setApproveForm] = useState({ approverName: '', approvalRemark: '', signatureImage: '' });

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateForm, setUpdateForm] = useState({ actionDone: '', nextAction: '', nextActionDate: '' });

  const [showDCModal, setShowDCModal] = useState(false);
  const [dcForm, setDcForm] = useState({ date: today(), receivedByName: '', remark: '', items: [{ materialName: '', quantity: '', unit: '', returnable: false }] });

  const [editDCIdx, setEditDCIdx] = useState(null);
  const [editDCForm, setEditDCForm] = useState(null);

  const [returnDCIdx, setReturnDCIdx] = useState(null);
  const [returnQty, setReturnQty] = useState('');

  /* ---------- Load ---------- */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/projects/${id}`);
      setProj(data.project);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ---------- timelineReady (§7) ---------- */
  function isTimelineReady(p) {
    const planned = (p.checklist || []).filter(c => !!c.targetDate).length;
    return !!p.timelineSet && planned > 0;
  }


  /* ---------- Convert to Service (Project -> Warranty Contract) ---------- */
  async function handleConvertToService() {
    if (!confirm('Convert this project to a 1-year Warranty service contract? The project status will change to "In Service".')) return;
    setBusy(true);
    try {
      await api.post(`/api/contracts/from-project/${id}`);
      await load(); // reload project (status now "In Service")
      alert('Project converted to Service — Warranty contract created.');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Stage ---------- */
  function openStageModal() {
    setStageForm(proj.stage);
    setStageConfirmMat(false);
    setStageConfirmChk(false);
    setShowStageModal(true);
  }

  async function handleStageSubmit() {
    setBusy(true);
    try {
      const body = { stage: stageForm };
      if (stageConfirmMat) body.confirmPendingMaterial = true;
      if (stageConfirmChk) body.confirmIncompleteChecklist = true;
      const data = await api.post(`/api/projects/${id}/stage`, body);
      setProj(data.project);
      setShowStageModal(false);
    } catch (err) {
      // If confirmation required, show the message but keep modal open
      if (err.code === 'PENDING_MATERIAL_CONFIRMATION_REQUIRED' || err.code === 'INCOMPLETE_CHECKLIST_CONFIRMATION_REQUIRED') {
        alert(err.message);
      } else {
        alert(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Vendor ---------- */
  function openVendorModal() {
    setVendorForm(proj.vendor || '');
    setShowVendorModal(true);
  }

  async function handleVendorSubmit() {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/vendor`, { vendor: vendorForm });
      setProj(data.project);
      setShowVendorModal(false);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Engineers ---------- */
  async function openEngModal() {
    setEngSelected((proj.assignedEngineerIds || []).map(String));
    try {
      const data = await api.get(`/api/projects/engineer-candidates`);
      setEngCandidates(data.candidates || []);
    } catch {
      setEngCandidates([]);
    }
    setShowEngModal(true);
  }

  function toggleEng(eid) {
    setEngSelected(prev =>
      prev.includes(eid) ? prev.filter(x => x !== eid) : [...prev, eid]
    );
  }

  async function handleEngSubmit() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/engineers`, { engineerIds: engSelected });
      setProj(data.project);
      setShowEngModal(false);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Timeline ---------- */
  function openTimelineModal() {
    const cl = proj.checklist || [];
    setTimelineDates(cl.map(c => fmtDate(c.targetDate)));
    setTimelineStart(fmtDate(proj.startDate));
    setTimelineConfirmPartial(false);
    setShowTimelineModal(true);
  }

  async function handleTimelineSubmit() {
    setBusy(true);
    try {
      const body = {
        targetDates: timelineDates.map(d => d || null),
        startDate: timelineStart || undefined,
      };
      if (timelineConfirmPartial) body.confirmPartialDates = true;
      const data = await api.post(`/api/projects/${id}/timeline`, body);
      setProj(data.project);
      setShowTimelineModal(false);
    } catch (err) {
      if (err.code === 'PARTIAL_DATES_CONFIRMATION_REQUIRED') {
        alert(err.message);
      } else {
        alert(err.message);
      }
    } finally { setBusy(false); }
  }

  /* ---------- Checklist: Add Point ---------- */
  async function handleAddPoint() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/checklist`, { text: newPointText, signResponsibility: newPointSign });
      setProj(data.project);
      setShowAddPoint(false);
      setNewPointText('');
      setNewPointSign('ENGINEER');
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: Edit Point ---------- */
  function openEditPoint(idx) {
    const c = proj.checklist[idx];
    setEditPointIdx(idx);
    setEditPointText(c.text);
    setEditPointSign(c.signResponsibility);
  }

  async function handleEditPoint() {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/checklist/${editPointIdx}`, { text: editPointText, signResponsibility: editPointSign });
      setProj(data.project);
      setEditPointIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: Remove Point ---------- */
  async function handleRemovePoint(idx) {
    if (!confirm('Remove this checklist point?')) return;
    setBusy(true);
    try {
      const data = await api.delete(`/api/projects/${id}/checklist/${idx}`);
      setProj(data.project);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: Tick ---------- */
  async function handleTick(idx, done) {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/checklist/${idx}/tick`, { done });
      setProj(data.project);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: Remark ---------- */
  function openRemark(idx) {
    setRemarkIdx(idx);
    setRemarkText(proj.checklist[idx].remark || '');
  }

  async function handleRemarkSubmit() {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/checklist/${remarkIdx}/remark`, { remark: remarkText });
      setProj(data.project);
      setRemarkIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: Photo ---------- */
  async function handlePhoto(idx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        setBusy(true);
        try {
          const data = await api.post(`/api/projects/${id}/checklist/${idx}/photos`, { photo: reader.result });
          setProj(data.project);
        } catch (err) { alert(err.message); }
        finally { setBusy(false); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /* ---------- Checklist: Approve ---------- */
  function openApprove(idx) {
    setApproveIdx(idx);
    setApproveForm({ approverName: '', approvalRemark: '', signatureImage: '' });
  }

  async function handleApproveSubmit() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/checklist/${approveIdx}/approve`, approveForm);
      setProj(data.project);
      setApproveIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: PM Sign ---------- */
  async function handlePMSign(idx) {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/checklist/${idx}/pm-sign`);
      setProj(data.project);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Execution Update ---------- */
  async function handleUpdateSubmit() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/updates`, updateForm);
      setProj(data.project);
      setShowUpdateModal(false);
      setUpdateForm({ actionDone: '', nextAction: '', nextActionDate: '' });
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Delivery Challan: Create ---------- */
  async function handleDCSubmit() {
    setBusy(true);
    try {
      const body = {
        date: dcForm.date,
        receivedByName: dcForm.receivedByName,
        remark: dcForm.remark,
        items: dcForm.items.filter(r => r.materialName),
      };
      const data = await api.post(`/api/projects/${id}/delivery-challans`, body);
      setProj(data.project);
      setShowDCModal(false);
      setDcForm({ date: today(), receivedByName: '', remark: '', items: [{ materialName: '', quantity: '', unit: '', returnable: false }] });
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Delivery Challan: Edit ---------- */
  function openEditDC(idx) {
    const dc = proj.deliveryChallans[idx];
    setEditDCIdx(idx);
    setEditDCForm({
      materialName: dc.materialName || '',
      quantity: dc.quantity || '',
      unit: dc.unit || '',
      returnable: !!dc.returnable,
      receivedByName: dc.receivedByName || '',
      remark: dc.remark || '',
    });
  }

  async function handleEditDCSubmit() {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/delivery-challans/${editDCIdx}`, editDCForm);
      setProj(data.project);
      setEditDCIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Delivery Challan: Delete ---------- */
  async function handleDeleteDC(idx) {
    if (!confirm('Delete this delivery challan item?')) return;
    setBusy(true);
    try {
      const data = await api.delete(`/api/projects/${id}/delivery-challans/${idx}`);
      setProj(data.project);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Delivery Challan: Return ---------- */
  function openReturnDC(idx) {
    setReturnDCIdx(idx);
    setReturnQty('');
  }

  async function handleReturnDCSubmit() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/delivery-challans/${returnDCIdx}/return`, { quantity: Number(returnQty) || 0 });
      setProj(data.project);
      setReturnDCIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- DC Export ---------- */
  async function handleDCExport() {
    try {
      const resp = await fetch(
        API_BASE_URL + `/api/projects/${id}/delivery-challans/export.csv`,
        { headers: { Authorization: `Bearer ${getStoredToken()}` } }
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'delivery-challan.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  /* ---------- Render ---------- */
  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!proj) return <p className="muted">Project not found.</p>;

  const checklist = proj.checklist || [];
  const updates = proj.executionUpdates || [];
  const dcs = proj.deliveryChallans || [];
  const stages = STAGES_BY_DIVISION[proj.division] || [];
  const tlReady = isTimelineReady(proj);

  return (
    <div className="proj-page">
      <button className="btn sec sm" onClick={() => navigate(-1)}>&larr; Back</button>

      {/* ======== Identity Panel ======== */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <div className="detail-head">
          <h2>{proj.name}</h2>
        </div>

        <div className="detail-grid">
          <div><strong>Division:</strong> {proj.division}</div>
          <div><strong>Customer:</strong> {proj.customer}</div>
          <div><strong>Site Type:</strong> {proj.siteType}</div>
          <div><strong>Capacity:</strong> {proj.capacity}</div>
          <div><strong>Start Date:</strong> {fmtDate(proj.startDate)}</div>
          <div><strong>End Date:</strong> {fmtDate(proj.endDate)}</div>
          <div><strong>Vendor:</strong> {proj.vendor || '—'}</div>
          <div><strong>Checklist Template:</strong> {proj.checklistTemplateName || '—'}</div>
        </div>

        {/* SO Link */}
        {proj.salesOrderId && (
          <p style={{ marginTop: 8 }}>
            <button className="btn sec sm" onClick={() => navigate(`/sales-orders/${proj.salesOrderId}`)}>
              🧾 View Sales Order
            </button>
          </p>
        )}

        {/* ======== Stage & Status ======== */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <div>
            <strong>Stage:</strong>{' '}
            <span className="status-badge status-open">{proj.stage}</span>
          </div>
          <div>
            <strong>Status:</strong>{' '}
            <span className={'status-badge ' + (proj.status === 'Completed' ? 'status-won' : proj.status === 'In Service' ? 'status-pending' : 'status-open')}>
              {proj.status}
            </span>
          </div>
        </div>

        {/* PM Actions: Stage, Vendor, Engineers, Timeline */}
        {isPM && (
          <div className="detail-actions">
            <button className="btn sec sm" onClick={openStageModal}>📋 Change Stage</button>
            <button className="btn sec sm" onClick={openVendorModal}>🏢 Edit Vendor</button>
            <button className="btn sec sm" onClick={openEngModal}>👷 Assign Engineers</button>
            <button className="btn sec sm" onClick={openTimelineModal}>📅 {proj.timelineSet ? 'Edit' : 'Set'} Timeline</button>
          </div>
        )}

        {/* PWA FACT (§18): Convert to Service — admin/service_mgr only,
            Completed status + non-MEP division. Sets project status to
            "In Service" and creates a 1-year Warranty contract. */}
        {['admin', 'service_mgr'].includes(user?.role) &&
         proj.status === 'Completed' && proj.division !== 'MEP' && (
          <div className="detail-actions" style={{ marginTop: 8 }}>
            <button className="btn pri sm" onClick={handleConvertToService} disabled={busy}>
              Convert to Service (Warranty)
            </button>
          </div>
        )}
      </div>

      {/* ======== Engineers ======== */}
      {(proj.assignedEngineerIds || []).length > 0 && (
        <div className="panel" style={{ maxWidth: 900 }}>
          <h3>Assigned Engineers</h3>
          <p className="muted">
            {(proj.assignedEngineerIds || []).length} engineer(s) assigned
            {/* Engineer names are resolved server-side in search; here we show IDs
                until we have a name-resolve helper. The engineer-candidates modal
                shows full names for selection. */}
          </p>
        </div>
      )}

      {/* ======== Timeline Status ======== */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <h3>Timeline</h3>
        {proj.timelineSet ? (
          <p className="muted">
            Timeline is set. {tlReady ? '✅ Ready — checklist ticking enabled.' : '⚠️ No target dates assigned yet.'}
          </p>
        ) : (
          <p className="muted">⏳ Timeline not set yet. {isPM ? 'Use "Set Timeline" to assign target dates.' : ''}</p>
        )}
      </div>

      {/* ======== Checklist ======== */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Checklist ({checklist.length} points)</h3>
          {isPM && (
            <button className="btn sec sm" onClick={() => setShowAddPoint(true)}>+ Add Point</button>
          )}
        </div>

        {checklist.length === 0 ? (
          <p className="muted">No checklist points.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Done</th>
                  <th>Text</th>
                  <th>Sign</th>
                  <th>Target</th>
                  <th>Approved</th>
                  <th>PM</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((c, i) => {
                  const canApproveThis = c.done && SIGN_ROLES[c.signResponsibility]?.includes(user?.role);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {canAct && notInService ? (
                          <input
                            type="checkbox"
                            checked={!!c.done}
                            disabled={busy || (c.done ? false : !tlReady)}
                            onChange={() => handleTick(i, !c.done)}
                            title={!c.done && !tlReady ? 'Set timeline first' : ''}
                          />
                        ) : (
                          c.done ? '✅' : '—'
                        )}
                      </td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 200 }}>
                        {c.text}
                        {c.remark && <div className="muted" style={{ fontSize: 11 }}>💬 {c.remark}</div>}
                        {(c.photos || []).length > 0 && <div className="muted" style={{ fontSize: 11 }}>📷 {c.photos.length} photo(s)</div>}
                      </td>
                      <td>{c.signResponsibility}</td>
                      <td>{fmtDate(c.targetDate)}</td>
                      <td>
                        {c.approval?.approverName ? (
                          <span className="status-badge status-won" title={`${c.approval.approvedByRole} — ${c.approval.approverName}`}>
                            ✅ {c.approval.approverName}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{c.pmSigned ? '✅' : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canAct && notInService && (
                          <>
                            <button className="btn sec sm" onClick={() => openRemark(i)} title="Remark" style={{ padding: '2px 6px', fontSize: 11 }}>💬</button>
                            <button className="btn sec sm" onClick={() => handlePhoto(i)} title="Photo" style={{ padding: '2px 6px', fontSize: 11 }}>📷</button>
                          </>
                        )}
                        {canApproveThis && (
                          <button className="btn sec sm" onClick={() => openApprove(i)} title="Approve" style={{ padding: '2px 6px', fontSize: 11 }}>✍️</button>
                        )}
                        {isPM && c.done && c.approval?.approverName && !c.pmSigned && (
                          <button className="btn sec sm" onClick={() => handlePMSign(i)} title="PM Counter-sign" style={{ padding: '2px 6px', fontSize: 11 }}>🔏</button>
                        )}
                        {isPM && !c.done && (
                          <>
                            <button className="btn sec sm" onClick={() => openEditPoint(i)} title="Edit" style={{ padding: '2px 6px', fontSize: 11 }}>✏️</button>
                            <button className="btn danger sm" onClick={() => handleRemovePoint(i)} title="Remove" style={{ padding: '2px 6px', fontSize: 11 }}>×</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======== Execution Updates ======== */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Execution Updates ({updates.length})</h3>
          {canAct && (
            <button className="btn sec sm" onClick={() => setShowUpdateModal(true)}>+ Add Update</button>
          )}
        </div>
        {updates.length === 0 ? (
          <p className="muted">No updates yet.</p>
        ) : (
          <ul className="log-list">
            {[...updates].reverse().map((u, i) => (
              <li key={i}>
                <span className="log-date">{fmtDate(u.date)}</span>
                <span className="log-text">
                  <strong>Done:</strong> {u.actionDone}
                  {u.nextAction && <> | <strong>Next:</strong> {u.nextAction}</>}
                  {u.nextActionDate && <> ({fmtDate(u.nextActionDate)})</>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ======== Delivery Challans ======== */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Delivery Challans ({dcs.length})</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {canAct && notInService && (
              <button className="btn sec sm" onClick={() => setShowDCModal(true)}>+ Add DC</button>
            )}
            <button className="btn sec sm" onClick={handleDCExport}>📥 Export CSV</button>
          </div>
        </div>
        {dcs.length === 0 ? (
          <p className="muted">No delivery challans.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>DC#</th>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Ret?</th>
                  <th>Returned</th>
                  <th>Received By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dcs.map((dc, i) => (
                  <tr key={i}>
                    <td>{dc.challanNumber}</td>
                    <td>{fmtDate(dc.date)}</td>
                    <td>{dc.materialName}</td>
                    <td>{dc.quantity}</td>
                    <td>{dc.unit}</td>
                    <td>{dc.returnable ? 'Yes' : 'No'}</td>
                    <td>{dc.returnedQuantity || 0}</td>
                    <td>{dc.receivedByName || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canAct && notInService && (
                        <>
                          <button className="btn sec sm" onClick={() => openEditDC(i)} style={{ padding: '2px 6px', fontSize: 11 }}>✏️</button>
                          <button className="btn danger sm" onClick={() => handleDeleteDC(i)} style={{ padding: '2px 6px', fontSize: 11 }}>×</button>
                          {dc.returnable && (
                            <button className="btn sec sm" onClick={() => openReturnDC(i)} style={{ padding: '2px 6px', fontSize: 11 }}>↩️</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ====================== MODALS ====================== */}

      {/* Stage Modal */}
      {showStageModal && (
        <div className="modal-overlay" onClick={() => setShowStageModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Change Stage</h3>
            <div className="filter-field">
              <label>Stage</label>
              <select value={stageForm} onChange={e => setStageForm(e.target.value)}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {stageForm === 'Completed' && proj.status !== 'In Service' && (
              <>
                <div style={{ marginTop: 8 }}>
                  <label><input type="checkbox" checked={stageConfirmMat} onChange={e => setStageConfirmMat(e.target.checked)} /> Confirm: override pending returnable material</label>
                </div>
                <div>
                  <label><input type="checkbox" checked={stageConfirmChk} onChange={e => setStageConfirmChk(e.target.checked)} /> Confirm: override incomplete/unapproved checklist</label>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowStageModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleStageSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Modal */}
      {showVendorModal && (
        <div className="modal-overlay" onClick={() => setShowVendorModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Vendor</h3>
            <div className="filter-field">
              <label>Vendor</label>
              <input value={vendorForm} onChange={e => setVendorForm(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowVendorModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleVendorSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Engineer Assignment Modal */}
      {showEngModal && (
        <div className="modal-overlay" onClick={() => setShowEngModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Assign Engineers</h3>
            <p className="muted">Select engineers to assign (full replace — deselecting removes).</p>
            {engCandidates.length === 0 ? (
              <p className="muted">No eligible candidates found.</p>
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {engCandidates.map(c => (
                  <div key={c.id} style={{ padding: '4px 0' }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={engSelected.includes(String(c.id))}
                        onChange={() => toggleEng(String(c.id))}
                      />
                      {' '}{c.name} <span className="muted">({c.role})</span>
                    </label>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowEngModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleEngSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Modal */}
      {showTimelineModal && (
        <div className="modal-overlay" onClick={() => setShowTimelineModal(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>{proj.timelineSet ? 'Edit' : 'Set'} Timeline</h3>
            <div className="filter-field" style={{ marginBottom: 12 }}>
              <label>Project Start Date</label>
              <input type="date" value={timelineStart} onChange={e => setTimelineStart(e.target.value)} />
            </div>
            {checklist.length === 0 ? (
              <p className="muted">No checklist points to set dates for.</p>
            ) : (
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {checklist.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ minWidth: 24, fontWeight: 600 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{c.text}</span>
                    <input
                      type="date"
                      value={timelineDates[i] || ''}
                      onChange={e => {
                        const nd = [...timelineDates];
                        nd[i] = e.target.value;
                        setTimelineDates(nd);
                      }}
                      style={{ width: 150 }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <label>
                <input type="checkbox" checked={timelineConfirmPartial} onChange={e => setTimelineConfirmPartial(e.target.checked)} />
                {' '}Allow partial dates (some points without a target date)
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowTimelineModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleTimelineSubmit} disabled={busy}>Save Timeline</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Checklist Point Modal */}
      {showAddPoint && (
        <div className="modal-overlay" onClick={() => setShowAddPoint(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Checklist Point</h3>
            <div className="filter-field">
              <label>Text</label>
              <input value={newPointText} onChange={e => setNewPointText(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Sign Responsibility</label>
              <select value={newPointSign} onChange={e => setNewPointSign(e.target.value)}>
                {SIGN_RESPONSIBILITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowAddPoint(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleAddPoint} disabled={busy || !newPointText}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Checklist Point Modal */}
      {editPointIdx !== null && (
        <div className="modal-overlay" onClick={() => setEditPointIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Checklist Point #{editPointIdx + 1}</h3>
            <div className="filter-field">
              <label>Text</label>
              <input value={editPointText} onChange={e => setEditPointText(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Sign Responsibility</label>
              <select value={editPointSign} onChange={e => setEditPointSign(e.target.value)}>
                {SIGN_RESPONSIBILITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setEditPointIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleEditPoint} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Remark Modal */}
      {remarkIdx !== null && (
        <div className="modal-overlay" onClick={() => setRemarkIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Remark for Point #{remarkIdx + 1}</h3>
            <div className="filter-field">
              <label>Remark</label>
              <textarea value={remarkText} onChange={e => setRemarkText(e.target.value)} rows={3} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setRemarkIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleRemarkSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approveIdx !== null && (
        <div className="modal-overlay" onClick={() => setApproveIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Approve Point #{approveIdx + 1}</h3>
            <p className="muted">Sign Responsibility: {checklist[approveIdx]?.signResponsibility}</p>
            {checklist[approveIdx]?.signResponsibility === 'CLIENT' && (
              <div className="filter-field">
                <label>Client Name (on-site)</label>
                <input value={approveForm.approverName} onChange={e => setApproveForm(f => ({ ...f, approverName: e.target.value }))} />
              </div>
            )}
            <div className="filter-field">
              <label>Remark</label>
              <textarea value={approveForm.approvalRemark} onChange={e => setApproveForm(f => ({ ...f, approvalRemark: e.target.value }))} rows={2} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setApproveIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleApproveSubmit} disabled={busy}>Approve</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Update Modal */}
      {showUpdateModal && (
        <div className="modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Execution Update</h3>
            <div className="filter-field">
              <label>Action Done *</label>
              <textarea value={updateForm.actionDone} onChange={e => setUpdateForm(f => ({ ...f, actionDone: e.target.value }))} rows={2} />
            </div>
            <div className="filter-field">
              <label>Next Action</label>
              <textarea value={updateForm.nextAction} onChange={e => setUpdateForm(f => ({ ...f, nextAction: e.target.value }))} rows={2} />
            </div>
            <div className="filter-field">
              <label>Next Action Date</label>
              <input type="date" value={updateForm.nextActionDate} onChange={e => setUpdateForm(f => ({ ...f, nextActionDate: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowUpdateModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleUpdateSubmit} disabled={busy || !updateForm.actionDone}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Delivery Challan Modal */}
      {showDCModal && (
        <div className="modal-overlay" onClick={() => setShowDCModal(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Add Delivery Challan</h3>
            <div className="form-grid">
              <div className="filter-field">
                <label>Date</label>
                <input type="date" value={dcForm.date} onChange={e => setDcForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Received By (site)</label>
                <input value={dcForm.receivedByName} onChange={e => setDcForm(f => ({ ...f, receivedByName: e.target.value }))} />
              </div>
              <div className="filter-field full-width">
                <label>Remark</label>
                <input value={dcForm.remark} onChange={e => setDcForm(f => ({ ...f, remark: e.target.value }))} />
              </div>
            </div>
            <h4>Items</h4>
            {dcForm.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input placeholder="Material Name" value={item.materialName} onChange={e => {
                  const items = [...dcForm.items]; items[i] = { ...items[i], materialName: e.target.value };
                  setDcForm(f => ({ ...f, items }));
                }} style={{ flex: 2, minWidth: 120 }} />
                <input type="number" placeholder="Qty" value={item.quantity} onChange={e => {
                  const items = [...dcForm.items]; items[i] = { ...items[i], quantity: e.target.value };
                  setDcForm(f => ({ ...f, items }));
                }} style={{ width: 70 }} />
                <input placeholder="Unit" value={item.unit} onChange={e => {
                  const items = [...dcForm.items]; items[i] = { ...items[i], unit: e.target.value };
                  setDcForm(f => ({ ...f, items }));
                }} style={{ width: 70 }} />
                <label style={{ fontSize: 12 }}>
                  <input type="checkbox" checked={item.returnable} onChange={e => {
                    const items = [...dcForm.items]; items[i] = { ...items[i], returnable: e.target.checked };
                    setDcForm(f => ({ ...f, items }));
                  }} /> Ret.
                </label>
                {dcForm.items.length > 1 && (
                  <button type="button" className="btn danger sm" onClick={() => {
                    setDcForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));
                  }} style={{ padding: '2px 6px' }}>×</button>
                )}
              </div>
            ))}
            <button type="button" className="btn sec sm" onClick={() => {
              setDcForm(f => ({ ...f, items: [...f.items, { materialName: '', quantity: '', unit: '', returnable: false }] }));
            }}>+ Add Row</button>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowDCModal(false)}>Cancel</button>
              <button className="btn pri sm" onClick={handleDCSubmit} disabled={busy}>Save DC</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit DC Modal */}
      {editDCIdx !== null && editDCForm && (
        <div className="modal-overlay" onClick={() => setEditDCIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit DC Item #{editDCIdx + 1}</h3>
            <div className="filter-field">
              <label>Material Name</label>
              <input value={editDCForm.materialName} onChange={e => setEditDCForm(f => ({ ...f, materialName: e.target.value }))} />
            </div>
            <div className="form-grid">
              <div className="filter-field">
                <label>Quantity</label>
                <input type="number" value={editDCForm.quantity} onChange={e => setEditDCForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="filter-field">
                <label>Unit</label>
                <input value={editDCForm.unit} onChange={e => setEditDCForm(f => ({ ...f, unit: e.target.value }))} />
              </div>
            </div>
            <div>
              <label><input type="checkbox" checked={editDCForm.returnable} onChange={e => setEditDCForm(f => ({ ...f, returnable: e.target.checked }))} /> Returnable</label>
            </div>
            <div className="filter-field">
              <label>Received By</label>
              <input value={editDCForm.receivedByName} onChange={e => setEditDCForm(f => ({ ...f, receivedByName: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setEditDCIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleEditDCSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Return DC Modal */}
      {returnDCIdx !== null && (
        <div className="modal-overlay" onClick={() => setReturnDCIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Record Material Return</h3>
            <p className="muted">
              DC #{dcs[returnDCIdx]?.challanNumber} — {dcs[returnDCIdx]?.materialName}
              <br />Sent: {dcs[returnDCIdx]?.quantity}, Already Returned: {dcs[returnDCIdx]?.returnedQuantity || 0}
            </p>
            <div className="filter-field">
              <label>Return Quantity</label>
              <input type="number" value={returnQty} onChange={e => setReturnQty(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setReturnDCIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleReturnDCSubmit} disabled={busy || !returnQty}>Return</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
