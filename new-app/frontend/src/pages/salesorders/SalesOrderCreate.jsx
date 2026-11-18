import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { today } from '../../utils/format';
import useMyDivisions from '../../hooks/useMyDivisions';
import TeamSelect, { useTeamCandidates } from '../../components/TeamSelect';
import DraftBar, { useDrafts } from '../../components/DraftBar';
import ClientSelect from '../../components/ClientSelect';
import ContactPick from '../../components/ContactPick';
import MilestonePointSelect, { useChecklistPoints } from '../../components/MilestonePoints';

/**
 * Standalone SalesOrder Create — PWA `mSO()` with no enquiry, exact reproduction.
 *
 * PWA FACT: mSO() with no args means e=null, no pre-fill from enquiry.
 * PWA FACT: "+ New SO" button shown only for sales/admin.
 * Same form fields as QuotationConvert but no source quotation — the
 * walk-in path, for an order with no lead and no quotation behind it.
 */

const DEFAULT_TERMS = '1) Fabrication not in our scope. 2) Civil and interior work not in our scope. 3) Mathadi not in our scope.';

/** What every sales order's first payment is called. */
export const ADVANCE_LABEL = 'Advance Payment 100%';

export default function SalesOrderCreate() {
  const DIVISIONS = useMyDivisions(); // company's purchased divisions (PWA myDivs())
  const { candidates } = useTeamCandidates();

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
    /*
     * Owner request (18 Nov 2026): "first milestone is same for every Sales
     * Order that is Advance Payment 100%". It is filled in, not locked —
     * the wording and the figure are still sales's to change, and an order
     * with genuinely no advance can have the row removed.
     */
    paymentMilestones: [{ description: ADVANCE_LABEL, amount: '', checklistPointIndex: null }],
    // Owner request (17 Nov 2026): which client in the directory this order
    // is for, when one was picked. Null on an order typed from scratch.
    clientId: null,
  });
  // Whose people the picker offers. Held only while the form is open.
  const [pickedClient, setPickedClient] = useState(null);
  // The checklist a project of this division will get. The milestones after
  // the advance are taken at one of these points.
  const { points: checklistPoints, templateName: checklistName } = useChecklistPoints(form.division);

  /**
   * Owner request (17 Nov 2026): pick the client and their people instead of
   * retyping both. A person goes into the first contact slot that is empty —
   * a sales order has exactly two (PWA FACT) — and never overwrites a name
   * already typed there.
   */
  function useContact(person) {
    if (!person) return;
    setForm(prev => {
      const contacts = [...prev.contacts];
      const already = contacts.some((c) => (c.name || '') === person.name && (c.phone || '') === person.phone);
      if (already) return prev;
      const slot = contacts.findIndex((c) => !c.name && !c.phone);
      if (slot === -1) return prev;
      contacts[slot] = {
        ...contacts[slot],
        name: person.name,
        designation: person.designation,
        phone: person.phone,
      };
      return { ...prev, contacts };
    });
  }

  /* Save as Draft (owner request, 14 Nov 2026). Nothing is created while the
     form sits here -- no SO number, no project, no payment records and no
     notifications. All of that is Create Sales Order's job, unchanged. */
  const drafts = useDrafts(
    'salesOrder',
    () => ({ form }),
    form.projectName || form.siteAddress || 'Untitled sales order'
  );
  function resumeDraft(p) {
    if (p && p.form) setForm((f) => ({ ...f, ...p.form }));
  }

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
    setForm(prev => ({
      ...prev,
      paymentMilestones: [...prev.paymentMilestones, { description: '', amount: '', checklistPointIndex: null }],
    }));
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
          // Owner request (18 Nov 2026): and which checklist point it is
          // taken at. The advance is taken against the order, not a point.
          .map(m => ({
            description: m.description,
            amount: Number(m.amount),
            checklistPointIndex: m.checklistPointIndex ?? null,
          })),
      };
      const result = await api.post('/api/sales-orders', payload);
      // The order exists now, so the draft of it has done its job.
      await drafts.discard();
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
            {/* Owner request (17 Nov 2026): pick a client we already have and
                their address comes with them. A name that is not on the list
                is simply typed, exactly as before. */}
            <ClientSelect
              label="Project Name"
              required
              value={form.projectName}
              onType={(v) => { setPickedClient(null); setForm(f => ({ ...f, projectName: v, clientId: null })); }}
              onPick={(c) => {
                setPickedClient(c);
                setForm(f => ({
                  ...f,
                  clientId: c.id,
                  projectName: c.companyName || c.clientName || f.projectName,
                  siteAddress: f.siteAddress || c.address || '',
                }));
              }}
            />
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
          {/* And who at them. Each one picked drops into the first empty slot
              below; both can still be typed over afterwards. */}
          <ContactPick client={pickedClient} picked={null} onPick={useContact} label="Add a person from the client" />
          {[0, 1].map(ci => (
            <div key={ci} className="form-grid">
              <div className="filter-field"><label>Name {ci + 1}</label><input value={form.contacts[ci].name} onChange={e => setContact(ci, 'name', e.target.value)} /></div>
              <div className="filter-field"><label>Designation</label><input value={form.contacts[ci].designation} onChange={e => setContact(ci, 'designation', e.target.value)} /></div>
              <div className="filter-field"><label>Phone</label><input value={form.contacts[ci].phone} onChange={e => setContact(ci, 'phone', e.target.value)} /></div>
              <div className="filter-field"><label>Email</label><input value={form.contacts[ci].email} onChange={e => setContact(ci, 'email', e.target.value)} /></div>
            </div>
          ))}

          <div className="form-grid">
            <TeamSelect label="Sales Team" value={form.salesTeam} options={candidates.sales} onChange={v => setField('salesTeam', v)} />
            <TeamSelect label="Project Team" value={form.projectTeam} options={candidates.project} onChange={v => setField('projectTeam', v)} />
          </div>
          <div className="filter-field full-width">
            <label>Crucial Points</label>
            <textarea value={form.crucialPoints} onChange={e => setField('crucialPoints', e.target.value)} rows={2} />
          </div>

          <h3>Costing</h3>
          <div className="form-grid">
            <div className="filter-field"><label>Total Cost</label><input type="number" value={form.totalCost} onChange={e => setField('totalCost', e.target.value)} /></div>
            <div className="filter-field"><label>Equipment Selling</label><input type="number" value={form.highSideSelling} onChange={e => setField('highSideSelling', e.target.value)} /></div>
            <div className="filter-field"><label>Equipment Purchase</label><input type="number" value={form.highSidePurchase} onChange={e => setField('highSidePurchase', e.target.value)} /></div>
            <div className="filter-field"><label>Accessories Cost</label><input type="number" value={form.lowSideCost} onChange={e => setField('lowSideCost', e.target.value)} /></div>
            <div className="filter-field"><label>Accessories Target Exp.</label><input type="number" value={form.lowSideTargetExpense} onChange={e => setField('lowSideTargetExpense', e.target.value)} /></div>
            <div className="filter-field"><label>Accessories Actual Exp.</label><input type="number" value={form.lowSideActualExpense} onChange={e => setField('lowSideActualExpense', e.target.value)} /></div>
          </div>

          <div className="filter-field full-width">
            <label>Terms & Conditions</label>
            <textarea value={form.termsAndConditions} onChange={e => setField('termsAndConditions', e.target.value)} rows={3} />
          </div>

          <h3>Payment Milestones (max 5)</h3>
          {/* Owner request (18 Nov 2026): the first payment is the advance,
              taken against the order itself. Every one after it says which
              checklist point earns it — tick and sign that point off on the
              project and the money goes to Finance by itself. */}
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            {form.division
              ? `The first payment is the advance. Each one after it is taken at a checklist point${checklistName ? ` (${checklistName})` : ''} — ${checklistPoints.length} to choose from.`
              : 'Choose a division and the checklist points appear here.'}
          </p>
          {form.paymentMilestones.map((m, i) => (
            <div key={i} className="milestone-row">
              <span className="milestone-num">{i + 1}.</span>
              <input placeholder="Description" value={m.description} onChange={e => setMilestone(i, 'description', e.target.value)} />
              <input type="number" placeholder="Amount" value={m.amount} onChange={e => setMilestone(i, 'amount', e.target.value)} />
              {i === 0 ? (
                <span className="muted" style={{ fontSize: 12 }}>taken on order</span>
              ) : (
                <MilestonePointSelect
                  points={checklistPoints}
                  value={m.checklistPointIndex}
                  onChange={(v) => setMilestone(i, 'checklistPointIndex', v)}
                />
              )}
              {form.paymentMilestones.length > 1 && (
                <button type="button" className="btn danger sm" onClick={() => removeMilestone(i)}>×</button>
              )}
            </div>
          ))}
          {form.paymentMilestones.length < 5 && (
            <button type="button" className="btn sec sm" onClick={addMilestone}>+ Add Milestone</button>
          )}

          <div className="modal-actions" style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <button type="button" className="btn sec sm" onClick={() => navigate('/sales-orders')}>Cancel</button>
            <DraftBar drafts={drafts} onResume={resumeDraft} />
            <button type="submit" className="btn pri sm" disabled={busy}>Create Sales Order</button>
          </div>
        </form>
      </div>
    </div>
  );
}
