import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { today } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * Standalone SalesOrder Create — PWA `mSO()` with no enquiry, exact reproduction.
 *
 * PWA FACT: mSO() with no args means e=null, no pre-fill from enquiry.
 * PWA FACT: "+ New SO" button shown only for sales/admin.
 * Same form fields as EnquiryConvert but no source enquiry.
 */

const DEFAULT_TERMS = '1) Fabrication not in our scope. 2) Civil and interior work not in our scope. 3) Mathadi not in our scope.';
const DIVISIONS = ['HVAC', 'Solar', 'MEP'];

export default function SalesOrderCreate() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    division: '',
    projectName: '',
    startDate: today(),
    endDate: '',
    siteAddress: '',
    contacts: [
      { name: '', designation: '', phone: '', email: '' },
      { name: '', designation: '', phone: '', email: '' },
    ],
    salesTeam: '',
    projectTeam: '',
    crucialPoints: '',
    totalCost: 0,
    highSideSelling: 0,
    highSidePurchase: 0,
    lowSideCost: 0,
    lowSideTargetExpense: 0,
    lowSideActualExpense: 0,
    termsAndConditions: DEFAULT_TERMS,
    paymentMilestones: [{ description: '', amount: '' }],
  });

  // Pre-fill salesTeam with current user's name
  useEffect(() => {
    (async () => {
      try {
        const me = await api.get('/api/auth/me');
        setForm(f => ({ ...f, salesTeam: me.user?.name || '' }));
      } catch (_) { /* non-fatal */ }
    })();
  }, []);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }
  function setContact(idx, key, value) {
    setForm(prev => {
      const contacts = [...prev.contacts];
      contacts[idx] = { ...contacts[idx], [key]: value };
      return { ...prev, contacts };
    });
  }
  function setMilestone(idx, key, value) {
    setForm(prev => {
      const ms = [...prev.paymentMilestones];
      ms[idx] = { ...ms[idx], [key]: value };
      return { ...prev, paymentMilestones: ms };
    });
  }
  function addMilestone() {
    if (form.paymentMilestones.length >= 5) return;
    setForm(prev => ({ ...prev, paymentMilestones: [...prev.paymentMilestones, { description: '', amount: '' }] }));
  }
  function removeMilestone(idx) {
    setForm(prev => ({ ...prev, paymentMilestones: prev.paymentMilestones.filter((_, i) => i !== idx) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.projectName) { alert('Project name is required.'); return; }
    if (!form.division) { alert('Division is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        totalCost: Number(form.totalCost) || 0,
        highSideSelling: Number(form.highSideSelling) || 0,
        highSidePurchase: Number(form.highSidePurchase) || 0,
        lowSideCost: Number(form.lowSideCost) || 0,
        lowSideTargetExpense: Number(form.lowSideTargetExpense) || 0,
        lowSideActualExpense: Number(form.lowSideActualExpense) || 0,
        paymentMilestones: form.paymentMilestones
          .filter(m => m.description && m.amount)
          .map(m => ({ description: m.description, amount: Number(m.amount) })),
      };
      const result = await api.post('/api/sales-orders', payload);
      navigate(`/sales-orders/${result.salesOrder.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="so-page">
      <button className="btn sec sm" onClick={() => navigate('/sales-orders')}>&larr; Back</button>
      <div className="panel">
        <h2>New Sales Order</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="filter-field">
              <label>Division *</label>
              <select value={form.division} onChange={e => setField('division', e.target.value)}>
                <option value="">— select —</option>
                {DIVISIONS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Project Name *</label>
              <input value={form.projectName} onChange={e => setField('projectName', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>End Date</label>
              <input type="date" value={form.endDate} onChange={e => setField('endDate', e.target.value)} />
            </div>
            <div className="filter-field full-width">
              <label>Site Address</label>
              <input value={form.siteAddress} onChange={e => setField('siteAddress', e.target.value)} />
            </div>
          </div>

          <h3>Contacts</h3>
          {[0, 1].map(ci => (
            <div key={ci} className="form-grid">
              <div className="filter-field"><label>Name {ci + 1}</label><input value={form.contacts[ci].name} onChange={e => setContact(ci, 'name', e.target.value)} /></div>
              <div className="filter-field"><label>Designation</label><input value={form.contacts[ci].designation} onChange={e => setContact(ci, 'designation', e.target.value)} /></div>
              <div className="filter-field"><label>Phone</label><input value={form.contacts[ci].phone} onChange={e => setContact(ci, 'phone', e.target.value)} /></div>
              <div className="filter-field"><label>Email</label><input value={form.contacts[ci].email} onChange={e => setContact(ci, 'email', e.target.value)} /></div>
            </div>
          ))}

          <div className="form-grid">
            <div className="filter-field"><label>Sales Team</label><input value={form.salesTeam} onChange={e => setField('salesTeam', e.target.value)} /></div>
            <div className="filter-field"><label>Project Team</label><input value={form.projectTeam} onChange={e => setField('projectTeam', e.target.value)} /></div>
          </div>
          <div className="filter-field full-width">
            <label>Crucial Points</label>
            <textarea value={form.crucialPoints} onChange={e => setField('crucialPoints', e.target.value)} rows={2} />
          </div>

          <h3>Costing</h3>
          <div className="form-grid">
            <div className="filter-field"><label>Total Cost</label><input type="number" value={form.totalCost} onChange={e => setField('totalCost', e.target.value)} /></div>
            <div className="filter-field"><label>HS Selling</label><input type="number" value={form.highSideSelling} onChange={e => setField('highSideSelling', e.target.value)} /></div>
            <div className="filter-field"><label>HS Purchase</label><input type="number" value={form.highSidePurchase} onChange={e => setField('highSidePurchase', e.target.value)} /></div>
            <div className="filter-field"><label>LS Cost</label><input type="number" value={form.lowSideCost} onChange={e => setField('lowSideCost', e.target.value)} /></div>
            <div className="filter-field"><label>LS Target Exp</label><input type="number" value={form.lowSideTargetExpense} onChange={e => setField('lowSideTargetExpense', e.target.value)} /></div>
            <div className="filter-field"><label>LS Actual Exp</label><input type="number" value={form.lowSideActualExpense} onChange={e => setField('lowSideActualExpense', e.target.value)} /></div>
          </div>

          <div className="filter-field full-width">
            <label>Terms & Conditions</label>
            <textarea value={form.termsAndConditions} onChange={e => setField('termsAndConditions', e.target.value)} rows={3} />
          </div>

          <h3>Payment Milestones (max 5)</h3>
          {form.paymentMilestones.map((m, i) => (
            <div key={i} className="milestone-row">
              <span className="milestone-num">{i + 1}.</span>
              <input placeholder="Description" value={m.description} onChange={e => setMilestone(i, 'description', e.target.value)} />
              <input type="number" placeholder="Amount" value={m.amount} onChange={e => setMilestone(i, 'amount', e.target.value)} />
              {form.paymentMilestones.length > 1 && (
                <button type="button" className="btn danger sm" onClick={() => removeMilestone(i)}>×</button>
              )}
            </div>
          ))}
          {form.paymentMilestones.length < 5 && (
            <button type="button" className="btn sec sm" onClick={addMilestone}>+ Add Milestone</button>
          )}

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn sec sm" onClick={() => navigate('/sales-orders')}>Cancel</button>
            <button type="submit" className="btn pri sm" disabled={busy}>Create Sales Order</button>
          </div>
        </form>
      </div>
    </div>
  );
}
