import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * SalesOrder Detail — PWA `vSO(x)` exact reproduction.
 *
 * Shows: project info, contacts, costing section (hidden from engineer/service_eng),
 * payment terms table (#/Description/Amount/Received), link to Project.
 * Edit button for sales/admin.
 * Raise to Finance per milestone (for PM roles + admin).
 *
 * PWA FACT: costing hidden from engineer/service_eng via `showCost = U.role!=="engineer"&&U.role!=="service_eng"`.
 */

const COST_HIDDEN_ROLES = ['engineer', 'service_eng'];

export default function SalesOrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [so, setSo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);

  // Raise modal
  const [raiseIdx, setRaiseIdx] = useState(null);
  const [raiseNote, setRaiseNote] = useState('');
  const [raiseDueBy, setRaiseDueBy] = useState('');
  const [raisePriority, setRaisePriority] = useState('Normal');

  const showCost = !COST_HIDDEN_ROLES.includes(user?.role);
  const canEdit = ['sales', 'admin'].includes(user?.role);
  const canRaise = ['hvac_pm', 'solar_pm', 'mep_pm', 'admin'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/sales-orders/${id}`);
      setSo(data.salesOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function openEdit() {
    setEditForm({
      division: so.division || '',
      projectName: so.projectName || '',
      startDate: fmtDate(so.startDate),
      endDate: fmtDate(so.endDate),
      siteAddress: so.siteAddress || '',
      contacts: (so.contacts || [{ name:'',designation:'',phone:'',email:'' },{ name:'',designation:'',phone:'',email:'' }]).map(c => ({ ...c })),
      salesTeam: so.salesTeam || '',
      projectTeam: so.projectTeam || '',
      crucialPoints: so.crucialPoints || '',
      totalCost: so.totalCost || 0,
      highSideSelling: so.highSideSelling || 0,
      highSidePurchase: so.highSidePurchase || 0,
      lowSideCost: so.lowSideCost || 0,
      lowSideTargetExpense: so.lowSideTargetExpense || 0,
      lowSideActualExpense: so.lowSideActualExpense || 0,
      termsAndConditions: so.termsAndConditions || '',
      paymentMilestones: (so.paymentMilestones || []).map(m => ({ description: m.description, amount: m.amount })),
    });
    setShowEdit(true);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editForm.projectName) { alert('Project name is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        ...editForm,
        totalCost: Number(editForm.totalCost) || 0,
        highSideSelling: Number(editForm.highSideSelling) || 0,
        highSidePurchase: Number(editForm.highSidePurchase) || 0,
        lowSideCost: Number(editForm.lowSideCost) || 0,
        lowSideTargetExpense: Number(editForm.lowSideTargetExpense) || 0,
        lowSideActualExpense: Number(editForm.lowSideActualExpense) || 0,
        paymentMilestones: editForm.paymentMilestones
          .filter(m => m.description && m.amount)
          .map(m => ({ description: m.description, amount: Number(m.amount) })),
      };
      const data = await api.patch(`/api/sales-orders/${id}`, payload);
      setSo(data.salesOrder);
      setShowEdit(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRaise() {
    setBusy(true);
    try {
      await api.post(`/api/sales-orders/${id}/milestones/${raiseIdx}/raise`, {
        note: raiseNote,
        dueByDate: raiseDueBy || undefined,
        priority: raisePriority,
      });
      setRaiseIdx(null);
      setRaiseNote(''); setRaiseDueBy(''); setRaisePriority('Normal');
      load(); // refresh to show updated data
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!so) return <p className="muted">Sales order not found.</p>;

  const milestones = so.paymentMilestones || [];

  return (
    <div className="so-page">
      <button className="btn sec sm" onClick={() => navigate(-1)}>&larr; Back</button>

      <div className="panel" style={{ maxWidth: 800 }}>
        <div className="detail-head">
          <h2>SO-{so.orderNumber}: {so.projectName}</h2>
        </div>

        <div className="detail-grid">
          <div><strong>Division:</strong> {so.division}</div>
          <div><strong>Start:</strong> {fmtDate(so.startDate)}</div>
          <div><strong>End:</strong> {fmtDate(so.endDate)}</div>
          <div><strong>Site Address:</strong> {so.siteAddress}</div>
          <div><strong>Sales Team:</strong> {so.salesTeam}</div>
          <div><strong>Project Team:</strong> {so.projectTeam}</div>
        </div>

        {/* Contacts */}
        <h3>Contacts</h3>
        {(so.contacts || []).map((c, i) => (
          c.name || c.phone ? (
            <div key={i} className="detail-grid" style={{ marginBottom: 4 }}>
              <div><strong>Contact {i + 1}:</strong> {c.name} ({c.designation})</div>
              <div><strong>Phone:</strong> {c.phone} {c.email ? `| ${c.email}` : ''}</div>
            </div>
          ) : null
        ))}

        {so.crucialPoints && <p><strong>Crucial Points:</strong> {so.crucialPoints}</p>}

        {/* Costing — hidden from engineer/service_eng (PWA FACT) */}
        {showCost && (
          <>
            <h3>Costing</h3>
            <div className="detail-grid">
              <div><strong>Total Cost:</strong> {money(so.totalCost)}</div>
              <div><strong>HS Selling:</strong> {money(so.highSideSelling)}</div>
              <div><strong>HS Purchase:</strong> {money(so.highSidePurchase)}</div>
              <div><strong>LS Cost:</strong> {money(so.lowSideCost)}</div>
              <div><strong>LS Target Exp:</strong> {money(so.lowSideTargetExpense)}</div>
              <div><strong>LS Actual Exp:</strong> {money(so.lowSideActualExpense)}</div>
            </div>
          </>
        )}

        {/* Payment Terms Table */}
        <h3>Payment Terms</h3>
        {milestones.length === 0 ? (
          <p className="muted">No payment milestones.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Received</th>
                  {canRaise && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {milestones.map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{m.description}</td>
                    <td>{money(m.amount)}</td>
                    <td>{m.received ? '✅ Yes' : '—'}</td>
                    {canRaise && (
                      <td>
                        {!m.received && (
                          <button className="btn sec sm" onClick={() => setRaiseIdx(i)}>Raise to Finance</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {so.termsAndConditions && <p style={{ marginTop: 12, fontSize: 13 }}><strong>Terms:</strong> {so.termsAndConditions}</p>}

        {/* Link to project */}
        {so.projectId && (
          <p><button className="btn sec sm" onClick={() => navigate(`/projects/${so.projectId}`)}>🏗️ View Project</button></p>
        )}

        {canEdit && (
          <div className="detail-actions">
            <button className="btn sec sm" onClick={openEdit}>✏️ Edit Sales Order</button>
          </div>
        )}
      </div>

      {/* Raise to Finance Modal */}
      {raiseIdx !== null && (
        <div className="modal-overlay" onClick={() => setRaiseIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Raise Milestone {raiseIdx + 1} to Finance</h3>
            <p className="muted">{milestones[raiseIdx]?.description} — {money(milestones[raiseIdx]?.amount)}</p>
            <div className="filter-field">
              <label>Note</label>
              <textarea value={raiseNote} onChange={e => setRaiseNote(e.target.value)} rows={2} />
            </div>
            <div className="filter-field">
              <label>Collect By</label>
              <input type="date" value={raiseDueBy} onChange={e => setRaiseDueBy(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Priority</label>
              <select value={raisePriority} onChange={e => setRaisePriority(e.target.value)}>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn sec sm" onClick={() => setRaiseIdx(null)}>Cancel</button>
              <button className="btn pri sm" onClick={handleRaise} disabled={busy}>Raise</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && editForm && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h3>Edit Sales Order</h3>
            <form onSubmit={handleEditSubmit}>
              <div className="form-grid">
                <div className="filter-field">
                  <label>Division</label>
                  <select value={editForm.division} onChange={e => setEditForm(f => ({ ...f, division: e.target.value }))}>
                    {['HVAC', 'Solar', 'MEP'].map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Project Name *</label>
                  <input value={editForm.projectName} onChange={e => setEditForm(f => ({ ...f, projectName: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>Start Date</label>
                  <input type="date" value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="filter-field">
                  <label>End Date</label>
                  <input type="date" value={editForm.endDate} onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
                <div className="filter-field full-width">
                  <label>Site Address</label>
                  <input value={editForm.siteAddress} onChange={e => setEditForm(f => ({ ...f, siteAddress: e.target.value }))} />
                </div>
              </div>

              <h4>Contacts</h4>
              {[0, 1].map(ci => (
                <div key={ci} className="form-grid">
                  <div className="filter-field"><label>Name {ci+1}</label><input value={(editForm.contacts[ci]||{}).name||''} onChange={e => { const c=[...editForm.contacts]; c[ci]={...c[ci],name:e.target.value}; setEditForm(f=>({...f,contacts:c})); }} /></div>
                  <div className="filter-field"><label>Designation</label><input value={(editForm.contacts[ci]||{}).designation||''} onChange={e => { const c=[...editForm.contacts]; c[ci]={...c[ci],designation:e.target.value}; setEditForm(f=>({...f,contacts:c})); }} /></div>
                  <div className="filter-field"><label>Phone</label><input value={(editForm.contacts[ci]||{}).phone||''} onChange={e => { const c=[...editForm.contacts]; c[ci]={...c[ci],phone:e.target.value}; setEditForm(f=>({...f,contacts:c})); }} /></div>
                </div>
              ))}

              <div className="form-grid">
                <div className="filter-field"><label>Sales Team</label><input value={editForm.salesTeam} onChange={e => setEditForm(f => ({ ...f, salesTeam: e.target.value }))} /></div>
                <div className="filter-field"><label>Project Team</label><input value={editForm.projectTeam} onChange={e => setEditForm(f => ({ ...f, projectTeam: e.target.value }))} /></div>
              </div>
              <div className="filter-field full-width">
                <label>Crucial Points</label>
                <textarea value={editForm.crucialPoints} onChange={e => setEditForm(f => ({ ...f, crucialPoints: e.target.value }))} rows={2} />
              </div>

              {showCost && (
                <>
                  <h4>Costing</h4>
                  <div className="form-grid">
                    <div className="filter-field"><label>Total Cost</label><input type="number" value={editForm.totalCost} onChange={e => setEditForm(f => ({ ...f, totalCost: e.target.value }))} /></div>
                    <div className="filter-field"><label>HS Selling</label><input type="number" value={editForm.highSideSelling} onChange={e => setEditForm(f => ({ ...f, highSideSelling: e.target.value }))} /></div>
                    <div className="filter-field"><label>HS Purchase</label><input type="number" value={editForm.highSidePurchase} onChange={e => setEditForm(f => ({ ...f, highSidePurchase: e.target.value }))} /></div>
                    <div className="filter-field"><label>LS Cost</label><input type="number" value={editForm.lowSideCost} onChange={e => setEditForm(f => ({ ...f, lowSideCost: e.target.value }))} /></div>
                    <div className="filter-field"><label>LS Target Exp</label><input type="number" value={editForm.lowSideTargetExpense} onChange={e => setEditForm(f => ({ ...f, lowSideTargetExpense: e.target.value }))} /></div>
                    <div className="filter-field"><label>LS Actual Exp</label><input type="number" value={editForm.lowSideActualExpense} onChange={e => setEditForm(f => ({ ...f, lowSideActualExpense: e.target.value }))} /></div>
                  </div>
                </>
              )}

              <div className="filter-field full-width">
                <label>Terms & Conditions</label>
                <textarea value={editForm.termsAndConditions} onChange={e => setEditForm(f => ({ ...f, termsAndConditions: e.target.value }))} rows={3} />
              </div>

              <h4>Payment Milestones</h4>
              {editForm.paymentMilestones.map((m, i) => (
                <div key={i} className="milestone-row">
                  <span className="milestone-num">{i + 1}.</span>
                  <input placeholder="Description" value={m.description} onChange={e => { const ms=[...editForm.paymentMilestones]; ms[i]={...ms[i],description:e.target.value}; setEditForm(f=>({...f,paymentMilestones:ms})); }} />
                  <input type="number" placeholder="Amount" value={m.amount} onChange={e => { const ms=[...editForm.paymentMilestones]; ms[i]={...ms[i],amount:e.target.value}; setEditForm(f=>({...f,paymentMilestones:ms})); }} />
                  {editForm.paymentMilestones.length > 0 && (
                    <button type="button" className="btn danger sm" onClick={() => { const ms=editForm.paymentMilestones.filter((_,j)=>j!==i); setEditForm(f=>({...f,paymentMilestones:ms})); }}>×</button>
                  )}
                </div>
              ))}
              {editForm.paymentMilestones.length < 5 && (
                <button type="button" className="btn sec sm" onClick={() => setEditForm(f => ({ ...f, paymentMilestones: [...f.paymentMilestones, { description: '', amount: '' }] }))}>+ Add Milestone</button>
              )}

              <div className="modal-actions">
                <button type="button" className="btn sec sm" onClick={() => setShowEdit(false)}>Cancel</button>
                <button type="submit" className="btn pri sm" disabled={busy}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
