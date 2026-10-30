import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getStoredToken } from '../../api/client';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate } from '../../utils/format';
import { addDaysKey, todayKey, spreadTimelineDates } from '../../utils/timeline';
import DeliveryChallanPanel from './DeliveryChallanPanel';
import SignaturePad from '../../components/SignaturePad';

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


/* ---- Project photographs (owner decision, 30 Oct 2026) ---------------- */

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_MAX_PER_UPDATE = 6;

/**
 * The bytes sit behind an authenticated route, so a photograph cannot be a
 * plain <img src>. Fetched with the token and handed to the browser as a
 * blob URL, which is revoked when the thumbnail goes away.
 */
function AuthedImage({ src, alt, style, onClick }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = '';
    (async () => {
      try {
        const resp = await fetch(src, { headers: { Authorization: `Bearer ${getStoredToken()}` } });
        if (!resp.ok) throw new Error(String(resp.status));
        made = URL.createObjectURL(await resp.blob());
        if (alive) setUrl(made); else URL.revokeObjectURL(made);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [src]);
  if (failed) return <span className="muted" style={style}>could not load</span>;
  if (!url) return <span className="muted" style={style} />;
  return <img src={url} alt={alt} style={style} onClick={onClick} />;
}

/** Read chosen files into data URIs, refusing anything too big here too. */
function readPhotoFiles(files) {
  return Promise.all([...files].map((f) => new Promise((resolve, reject) => {
    if (f.size > PHOTO_MAX_BYTES) {
      reject(new Error(`${f.name} is over 3 MB. Please choose a smaller photograph.`));
      return;
    }
    const r = new FileReader();
    r.onerror = () => reject(new Error(`${f.name} could not be read.`));
    r.onload = () => resolve({ data: String(r.result), caption: '', name: f.name });
    r.readAsDataURL(f);
  })));
}

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

/** PWA FACT (itemStatus, index.html:2229-2240), on UTC day keys. */
function dayKey(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }
function daysBetweenKeys(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

function itemStatus(c) {
  const plan = dayKey(c.targetDate);
  const t = new Date().toISOString().slice(0, 10);
  if (c.done) {
    const done = dayKey(c.completedDate);
    if (!plan) return { text: `Completed ${done}`, color: 'green' };
    const v = daysBetweenKeys(plan, done || t);
    if (v > 0) return { text: `Completed ${done} · ${v}d late`, color: '#b26a00' };
    return { text: `Completed ${done}${v < 0 ? ` · ${-v}d early` : ' · on time'}`, color: 'green' };
  }
  if (!plan) return { text: 'No target date', color: '#888' };
  const od = daysBetweenKeys(plan, t);
  if (od > 0) return { text: `Overdue by ${od} day${od > 1 ? 's' : ''}`, color: '#c62828' };
  return { text: `Scheduled ${plan}`, color: '#1565c0' };
}

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
  const isEng = proj && (proj.assignedEngineerIds || []).some(eid => String(eid) === String(user?.id));
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
  const [timelineEnd, setTimelineEnd] = useState('');
  const [timelineNote, setTimelineNote] = useState('');

  const [showAddPoint, setShowAddPoint] = useState(false);
  const [newPointText, setNewPointText] = useState('');
  const [newPointSign, setNewPointSign] = useState('ENGINEER');

  const [editPointIdx, setEditPointIdx] = useState(null);
  const [editPointText, setEditPointText] = useState('');
  const [editPointSign, setEditPointSign] = useState('');

  const [remarkIdx, setRemarkIdx] = useState(null);
  const [remarkText, setRemarkText] = useState('');

  const [approveIdx, setApproveIdx] = useState(null);
  const [dateIdx, setDateIdx] = useState(null);
  const [dateForm, setDateForm] = useState({ targetDate: '', completedDate: '' });
  const [showApplyChk, setShowApplyChk] = useState(false);
  const [chkTemplates, setChkTemplates] = useState([]);
  const [applyTplId, setApplyTplId] = useState('');
  const [photoView, setPhotoView] = useState(null);
  const [approveForm, setApproveForm] = useState({ approverName: '', approvalRemark: '', signatureImage: '' });

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateForm, setUpdateForm] = useState({ actionDone: '', nextAction: '', nextActionDate: '', shareWithCustomer: false, customerNote: '' });
  const [updatePhotos, setUpdatePhotos] = useState([]);
  const [lightbox, setLightbox] = useState('');
  const [photos, setPhotos] = useState([]);




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
    setTimelineStart(fmtDate(proj.startDate) || todayKey());
    // PWA FACT (mTimeline, index.html:2584): the spread target defaults to the
    // project's current end date, or 60 days out when it has none.
    setTimelineEnd(fmtDate(proj.endDate) || addDaysKey(todayKey(), 60));
    setTimelineConfirmPartial(false);
    setTimelineNote('');
    setShowTimelineModal(true);
  }

  /**
   * PWA FACT (autoFillTimeline, index.html:2592-2602): spread every checklist
   * point evenly between the project start and the chosen end date —
   *   point i (0-based) = start + round(span * (i + 1) / n)
   * so the last point lands exactly on the end date and the first lands one
   * interval in. A span of less than a day falls back to one day per point.
   *
   * This only fills the inputs; nothing is saved until Save Timeline, which
   * is also where validation, the partial-date confirmation and the
   * optimistic-lock retry live. Matching the PWA, it overwrites every row,
   * including ones just edited by hand — hence the explicit button and the
   * note telling the user to adjust rows afterwards.
   */
  function autoFillTimeline() {
    if (checklist.length === 0) return;
    setTimelineDates(spreadTimelineDates(timelineStart, timelineEnd, checklist.length));
    setTimelineNote('Dates spread evenly — adjust any row as needed.');
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
          // PWA FACT (addPhoto, index.html:2648-2660): scale to max 480px
          // wide, JPEG quality 0.6, before saving.
          const photo = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const sc = Math.min(1, 480 / img.width);
              const cv = document.createElement('canvas');
              cv.width = img.width * sc;
              cv.height = img.height * sc;
              cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
              resolve(cv.toDataURL('image/jpeg', 0.6));
            };
            img.onerror = () => reject(new Error('Could not read the image.'));
            img.src = reader.result;
          });
          const data = await api.post(`/api/projects/${id}/checklist/${idx}/photos`, { photo });
          setProj(data.project);
        } catch (err) { alert(err.message); }
        finally { setBusy(false); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /* ---------- Checklist: point dates (PWA mItemDate/saveItemDate) ---------- */
  function openItemDate(idx) {
    const c = (proj.checklist || [])[idx];
    setDateIdx(idx);
    setDateForm({ targetDate: c?.targetDate ? fmtDate(c.targetDate) : '', completedDate: c?.completedDate ? fmtDate(c.completedDate) : '' });
  }
  async function handleItemDateSubmit() {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/checklist/${dateIdx}/target-date`, {
        targetDate: dateForm.targetDate || null,
        completedDate: dateForm.completedDate || undefined,
      });
      setProj(data.project);
      setDateIdx(null);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Checklist: choose from library (PWA mApplyChkList) ---------- */
  async function openApplyChecklist() {
    try {
      const data = await api.get(`/api/checklist-templates?division=${encodeURIComponent(proj.division)}`);
      const list = data.templates || [];
      setChkTemplates(list);
      setApplyTplId(list[0]?.id || '');
      setShowApplyChk(true);
    } catch (err) { alert(err.message); }
  }
  async function handleApplyChecklist(mode) {
    if (!applyTplId) { alert('Select a checklist'); return; }
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/checklist/apply`, { templateId: applyTplId, mode });
      setProj(data.project);
      setShowApplyChk(false);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Project report (PWA dlProjectReport / printProjectReport) ---------- */
  async function handleReportCsv() {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/projects/${id}/report/export.csv`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-report-${(proj.name || 'project').replace(/[^a-z0-9]+/gi, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
  }

  /* ---------- Checklist: Approve ---------- */
  function openApprove(idx) {
    setApproveIdx(idx);
    setApproveForm({ approverName: '', approvalRemark: (checklist[idx]?.approval?.approvalRemark) || '', signatureImage: '' });
  }
  const setApproveSignature = useCallback((sig) => setApproveForm(f => ({ ...f, signatureImage: sig })), []);

  async function handleApproveSubmit() {
    // PWA FACT (doApprove, index.html:2318-2320)
    if (checklist[approveIdx]?.signResponsibility === 'CLIENT') {
      if (!approveForm.approverName.trim()) { alert('Enter client name'); return; }
      if (!approveForm.signatureImage) { alert('Client signature required'); return; }
    }
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

  /* ---------- Project photographs ---------- */
  const loadPhotos = useCallback(async () => {
    try {
      const d = await api.get(`/api/projects/${id}/photos`);
      setPhotos(d.photos || []);
    } catch { /* the page is still usable without them */ }
  }, [id]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  async function handleRemovePhoto(photoId) {
    setBusy(true);
    try {
      await api.del(`/api/projects/${id}/photos/${photoId}`);
      await loadPhotos();
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Execution Update ---------- */
  async function handleUpdateSubmit() {
    setBusy(true);
    try {
      const data = await api.post(`/api/projects/${id}/updates`, updateForm);
      setProj(data.project);
      // The update just appended is the last one, so that is where its
      // photographs belong.
      const idx = (data.project.executionUpdates || []).length - 1;
      if (updatePhotos.length && idx >= 0) {
        try {
          await api.post(`/api/projects/${id}/updates/${idx}/photos`, {
            photos: updatePhotos.map((p) => ({ data: p.data, caption: p.caption })),
          });
          await loadPhotos();
        } catch (err) {
          // The words are saved; say plainly that the pictures are not.
          alert(`The update was saved, but the photographs were not: ${err.message}`);
        }
      }
      setShowUpdateModal(false);
      setUpdateForm({ actionDone: '', nextAction: '', nextActionDate: '', shareWithCustomer: false, customerNote: '' });
      setUpdatePhotos([]);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /**
   * Show this update to the client in their portal, or take it back (owner
   * decision, 30 Oct 2026).
   *
   * `idx` is the real position in `executionUpdates`. The list below is
   * rendered newest-first, so its loop index is NOT this number — passing
   * the wrong one would publish somebody else's line.
   */
  async function handleShareUpdate(idx, shared) {
    setBusy(true);
    try {
      const data = await api.patch(`/api/projects/${id}/updates/${idx}/share`, { shared });
      setProj(data.project);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }

  /* ---------- Render ---------- */
  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!proj) return <p className="muted">Project not found.</p>;

  const checklist = proj.checklist || [];
  const updates = proj.executionUpdates || [];
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
            <button className="btn sec sm" onClick={openApplyChecklist}>✅ Choose Checklist</button>
          </div>
        )}
        <div className="detail-actions" style={{ marginTop: 8 }}>
          <button className="btn sec sm" onClick={handleReportCsv}>⬇ Project Report (CSV)</button>
          <button className="btn sec sm" onClick={() => window.print()}>🖨 Print / PDF</button>
        </div>

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
            {(proj.engineerNames && proj.engineerNames.length)
              ? proj.engineerNames.join(', ')
              : `${(proj.assignedEngineerIds || []).length} engineer(s) assigned`}
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
                  <th>Dates / Status</th>
                  <th>Approved</th>
                  <th>PM</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((c, i) => {
                  // PWA FACT (vProject, index.html:2199): Approve hidden once approved.
                  const canApproveThis = c.done && !c.approval?.approverName && SIGN_ROLES[c.signResponsibility]?.includes(user?.role);
                  const st = itemStatus(c);
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
                        {(c.photos || []).length > 0 && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                            {c.photos.map((ph, k) => (
                              <img key={k} src={ph} alt={`photo ${k + 1}`} onClick={() => setPhotoView(ph)}
                                style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{c.signResponsibility}</td>
                      <td>
                        <div style={{ fontSize: 11 }}>Scheduled: {c.targetDate ? fmtDate(c.targetDate) : '—'}</div>
                        <div style={{ fontSize: 11 }}>Completed: {c.done && c.completedDate ? fmtDate(c.completedDate) : '—'}</div>
                        <span style={{ fontSize: 11, color: st.color }}>{st.text}</span>
                      </td>
                      <td>
                        {c.approval?.approverName ? (
                          <div title={c.approval.approvalRemark || ''}>
                            <span className="status-badge status-won">✅ {c.approval.approverName}</span>
                            <div className="muted" style={{ fontSize: 11 }}>{c.approval.approvedByRole} · {fmtDate(c.approval.approvedDate)}</div>
                            {c.approval.signatureImage && <img src={c.approval.signatureImage} alt="signature" style={{ height: 28, display: 'block' }} />}
                          </div>
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
                        {isPM && (
                          <>
                            {/* PWA FACT (index.html:2203): PM can edit and re-date any point; remove only while not done. */}
                            <button className="btn sec sm" onClick={() => openItemDate(i)} title="Dates" style={{ padding: '2px 6px', fontSize: 11 }}>📅</button>
                            <button className="btn sec sm" onClick={() => openEditPoint(i)} title="Edit" style={{ padding: '2px 6px', fontSize: 11 }}>✏️</button>
                            {!c.done && <button className="btn danger sm" onClick={() => handleRemovePoint(i)} title="Remove" style={{ padding: '2px 6px', fontSize: 11 }}>×</button>}
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
            {[...updates].reverse().map((u, i) => {
              // Newest-first render over an append-only array.
              const idx = updates.length - 1 - i;
              return (
                <li key={idx}>
                  <span className="log-date">{fmtDate(u.date)}</span>
                  <span className="log-text">
                    <strong>Done:</strong> {u.actionDone}
                    {u.nextAction && <> | <strong>Next:</strong> {u.nextAction}</>}
                    {u.nextActionDate && <> ({fmtDate(u.nextActionDate)})</>}
                    {u.sharedWithCustomer && (
                      <>
                        {' '}<span className="status-badge status-won">Client can see this</span>
                        {u.customerNote && <div className="muted">Client reads: “{u.customerNote}”</div>}
                      </>
                    )}
                    {canAct && (
                      <>
                        {' '}
                        <button
                          className="btn sec sm"
                          disabled={busy}
                          onClick={() => handleShareUpdate(idx, !u.sharedWithCustomer)}
                        >
                          {u.sharedWithCustomer ? 'Hide from client' : 'Show to client'}
                        </button>
                      </>
                    )}
                    {photos.filter((ph) => ph.updateIndex === idx).length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        {photos.filter((ph) => ph.updateIndex === idx).map((ph) => (
                          <figure key={ph.id} style={{ margin: 0, width: 110 }}>
                            <AuthedImage
                              src={`${API_BASE_URL}/api/projects/${id}/photos/${ph.id}`}
                              alt={ph.caption || 'Project photograph'}
                              style={{ width: 110, height: 82, objectFit: 'cover', borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
                              onClick={() => setLightbox(`${API_BASE_URL}/api/projects/${id}/photos/${ph.id}`)}
                            />
                            {ph.caption && <figcaption className="muted" style={{ fontSize: 11 }}>{ph.caption}</figcaption>}
                            {canAct && (
                              <button className="btn sec sm" style={{ marginTop: 2 }} disabled={busy}
                                onClick={() => handleRemovePhoto(ph.id)}>Remove</button>
                            )}
                          </figure>
                        ))}
                      </div>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ======== Delivery Challans ======== */}
      {/* PWA `challanPanel(p,isPM,isEng)` (index.html:2154, 2336-2370):
          grouped by DC number, each group printable as its own challan. */}
      <DeliveryChallanPanel
        project={proj}
        projectId={id}
        canAct={canAct}
        notInService={notInService}
        onProjectUpdated={setProj}
      />

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
            <div className="filter-grid">
              <div className="filter-field">
                <label>Project Start Date</label>
                <input type="date" value={timelineStart} onChange={e => setTimelineStart(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Auto-fill: spread all points evenly up to</label>
                <div className="filter-pair">
                  <input type="date" value={timelineEnd} onChange={e => setTimelineEnd(e.target.value)} />
                  <button
                    type="button"
                    className="btn sec sm"
                    onClick={autoFillTimeline}
                    disabled={checklist.length === 0}
                  >
                    Auto-fill
                  </button>
                </div>
              </div>
            </div>
            {timelineNote && <p className="muted" style={{ marginBottom: 12 }}>{timelineNote}</p>}
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

      {/* Point Dates Modal (PWA mItemDate) */}
      {dateIdx !== null && (
        <div className="modal-overlay" onClick={() => setDateIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Checklist Point Dates</h3>
            <p className="muted">{checklist[dateIdx]?.text}</p>
            <div className="form-grid">
              <div className="filter-field"><label>Scheduled / Target Date</label>
                <input type="date" value={dateForm.targetDate} onChange={e => setDateForm(f => ({ ...f, targetDate: e.target.value }))} />
              </div>
              <div className="filter-field"><label>Completed Date</label>
                <input type="date" value={dateForm.completedDate} disabled={!checklist[dateIdx]?.done}
                  onChange={e => setDateForm(f => ({ ...f, completedDate: e.target.value }))} />
              </div>
            </div>
            {!checklist[dateIdx]?.done && <p className="muted">Completed date is filled automatically when the point is ticked.</p>}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setDateIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleItemDateSubmit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Choose Checklist Modal (PWA mApplyChkList) */}
      {showApplyChk && (
        <div className="modal-overlay" onClick={() => setShowApplyChk(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Choose Checklist — {proj.name}</h3>
            {checklist.some(c => c.done) ? (
              <p style={{ color: '#c62828' }}>⚠ {checklist.filter(c => c.done).length} point(s) already completed. Replacing will lose their ticks, dates and approvals. Use <b>Append</b> to keep them.</p>
            ) : (
              <p className="muted">Pick a {proj.division} checklist from the library. You can still add or edit points afterwards.</p>
            )}
            {chkTemplates.length === 0 ? <p className="muted">No {proj.division} checklists in the library.</p> : (
              <div className="filter-field"><label>Checklist</label>
                <select value={applyTplId} onChange={e => setApplyTplId(e.target.value)}>
                  {chkTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.items || []).length} points){t.isDefault ? ' — default' : ''}</option>)}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setShowApplyChk(false)}>Cancel</button>
              <button className="btn sec sm" onClick={() => handleApplyChecklist('append')} disabled={busy || !applyTplId}>Append points</button>
              <button className="btn pri sm" onClick={() => handleApplyChecklist('replace')} disabled={busy || !applyTplId}>Replace checklist</button>
            </div>
          </div>
        </div>
      )}

      {photoView && (
        <div className="modal-overlay" onClick={() => setPhotoView(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <img src={photoView} alt="checklist photo" style={{ maxWidth: '100%' }} />
            <div className="modal-actions"><button className="btn sec sm" onClick={() => setPhotoView(null)}>Close</button></div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approveIdx !== null && (
        <div className="modal-overlay" onClick={() => setApproveIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Approve Point #{approveIdx + 1}</h3>
            <p className="muted">Sign Responsibility: {checklist[approveIdx]?.signResponsibility}</p>
            {checklist[approveIdx]?.signResponsibility === 'CLIENT' ? (
              <>
                <div className="filter-field">
                  <label>Client Name</label>
                  <input value={approveForm.approverName} placeholder="name of person approving on site"
                    onChange={e => setApproveForm(f => ({ ...f, approverName: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Client Signature (sign on phone)</label>
                  <SignaturePad onChange={setApproveSignature} />
                </div>
              </>
            ) : (
              <p className="muted">Approving as <b>{user?.name}</b> for <b>{checklist[approveIdx]?.signResponsibility}</b> sign-off.</p>
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
      {lightbox && (
        <div className="modal-overlay" onClick={() => setLightbox('')}>
          <AuthedImage src={lightbox} alt="Project photograph"
            style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}

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

            {/* Owner decision (30 Oct 2026): an update is internal unless
                somebody says otherwise here. "Next Action" is never sent to
                a client whatever is ticked. */}
            <div className="filter-field">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={updateForm.shareWithCustomer}
                  onChange={e => setUpdateForm(f => ({ ...f, shareWithCustomer: e.target.checked }))}
                />
                Show this to the client in their portal
              </label>
            </div>
            {/* Photographs of the work, attached to THIS update (owner
                decision, 30 Oct 2026). They follow the tick-box above:
                shared update, visible pictures. */}
            <div className="filter-field" style={{ marginTop: 12 }}>
              <label>Photographs of the work (optional, up to {PHOTO_MAX_PER_UPDATE})</label>
              <input
                type="file"
                accept={PHOTO_ACCEPT}
                multiple
                onChange={async (e) => {
                  const picked = e.target.files;
                  if (!picked || !picked.length) return;
                  try {
                    const read = await readPhotoFiles(picked);
                    setUpdatePhotos((prev) => {
                      const next = [...prev, ...read].slice(0, PHOTO_MAX_PER_UPDATE);
                      if (prev.length + read.length > PHOTO_MAX_PER_UPDATE) {
                        alert(`Only ${PHOTO_MAX_PER_UPDATE} photographs can go on one update.`);
                      }
                      return next;
                    });
                  } catch (err) { alert(err.message); }
                  e.target.value = '';
                }}
              />
              {updatePhotos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {updatePhotos.map((ph, n) => (
                    <figure key={`${ph.name}-${n}`} style={{ margin: 0, width: 120 }}>
                      <img src={ph.data} alt="" style={{ width: 120, height: 88, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                      <input
                        type="text"
                        placeholder="What it shows"
                        value={ph.caption}
                        maxLength={200}
                        style={{ width: '100%', marginTop: 4, fontSize: 12 }}
                        onChange={(e) => setUpdatePhotos((prev) => prev.map((x, j) => (j === n ? { ...x, caption: e.target.value } : x)))}
                      />
                      <button className="btn sec sm" style={{ marginTop: 2 }}
                        onClick={() => setUpdatePhotos((prev) => prev.filter((_, j) => j !== n))}>Remove</button>
                    </figure>
                  ))}
                </div>
              )}
              {updateForm.shareWithCustomer && updatePhotos.length > 0 && (
                <small className="muted">These {updatePhotos.length === 1 ? 'photograph goes' : 'photographs go'} to the client with this update.</small>
              )}
            </div>

            {updateForm.shareWithCustomer && (
              <div className="filter-field">
                <label>What the client reads (optional)</label>
                <textarea
                  value={updateForm.customerNote}
                  onChange={e => setUpdateForm(f => ({ ...f, customerNote: e.target.value }))}
                  rows={2}
                  placeholder="Leave blank to show the Action Done text as it is"
                />
                <small className="muted">Only this line and the date reach the client. Next Action stays internal.</small>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => { setShowUpdateModal(false); setUpdatePhotos([]); }}>Cancel</button>
              <button className="btn pri sm" onClick={handleUpdateSubmit} disabled={busy || !updateForm.actionDone}>Add</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
