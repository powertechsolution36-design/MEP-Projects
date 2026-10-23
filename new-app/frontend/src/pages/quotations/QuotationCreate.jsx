import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { money, today } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import { quotationProblem } from './quotationValidation';
import LineItemsEditor, { EMPTY_LINE } from './LineItemsEditor';
import { quotationTotals } from './quotationTotals';

/**
 * Create / Edit Quotation — Equipment + Accessories line items.
 *
 * Uses "Equipment" / "Accessories" NOT "High Side" / "Low Side".
 * Item name autocomplete from /api/item-names/autocomplete.
 *
 * API: POST /api/quotations (create)
 *      PATCH /api/quotations/:id (update — via QuotationDetail edit mode)
 */

export default function QuotationCreate() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [form, setForm] = useState({
    division: '', offerType: '', customerName: '', customerAddress: '', customerPhone: '',
    customerEmail: '', customerGst: '', subject: '', system: '', capacity: '',
    siteDescription: '', summaryText: '', technicalDescription: '', designApproval: '',
    benefitsOfSystem: '', designBy: '', systemApprovedBy: '',
    gstPercent: 18, offerValidity: '', delivery: '', notes: '', date: today(),
  });
  const [equipmentItems, setEquipmentItems] = useState([{ ...EMPTY_LINE }]);
  const [accessoriesItems, setAccessoriesItems] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [excludedWorks, setExcludedWorks] = useState(['']);

  // Payment term templates
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');

  // Ready-made starting points (Split, Ductable, VRF, Solar …) — owner
  // request, 22 Oct 2026. Applying one copies its wording into this form;
  // nothing stays linked afterwards.
  const [startingPoints, setStartingPoints] = useState([]);
  const [appliedStart, setAppliedStart] = useState('');

  // Built-in starting points, one per kind of offer — Split, Ducted, VRF,
  // Solar (owner request, 23 Oct 2026). The server filters these to the
  // divisions this company has bought.
  const [presets, setPresets] = useState([]);
  const [appliedPreset, setAppliedPreset] = useState('');

  useEffect(() => {
    api.get('/api/payment-term-templates?documentType=quotation')
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
    api.get('/api/quotation-templates')
      .then((data) => {
        const list = data.templates || [];
        setStartingPoints(list);
        // The list usually arrives before a division is picked; if it does
        // not, apply the automatic one as soon as it lands.
        setPendingAuto(list.filter(t => t.isDefault));
      })
      .catch(() => { /* optional: the form works without any */ });
    api.get('/api/quotation-templates/presets')
      .then((data) => setPresets(data.presets || []))
      .catch(() => { /* optional: the form works without any */ });
  }, []);

  const [pendingAuto, setPendingAuto] = useState([]);
  useEffect(() => {
    if (!pendingAuto.length || appliedStart || appliedPreset || !form.division) return;
    const auto = pendingAuto.find(t => t.division === form.division);
    if (auto && formIsUntouched()) applyStartingPoint(auto.id, form.division);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuto, form.division]);

  /**
   * Choosing a division applies that division's automatic starting point —
   * the one saved with "use this automatically" (owner request, 22 Oct 2026).
   * It only does so while the form is still untouched, so switching division
   * halfway through never wipes work already typed in.
   */
  function formIsUntouched() {
    const typed = ['customerName', 'subject', 'system', 'capacity', 'summaryText', 'technicalDescription']
      .some(k => String(form[k] || '').trim());
    const items = [...equipmentItems, ...accessoriesItems].some(i => String(i.description || '').trim());
    return !typed && !items;
  }

  function chooseDivision(division) {
    setField('division', division);
    if (!division) return;
    const auto = startingPoints.find(t => t.division === division && t.isDefault);
    if (auto && formIsUntouched()) applyStartingPoint(auto.id, division);
  }

  /**
   * Pick the kind of offer (owner request, 23 Oct 2026). The preset carries
   * its own division and the wording that is the same on every offer of that
   * kind, so the table opens with its descriptions in place and only prices
   * have to be typed. Rates all arrive at 0 — a price is never inherited.
   */
  function applyPreset(code) {
    setAppliedPreset(code);
    setAppliedStart('');
    if (!code) {
      // Back to a blank quotation: clear what a preset had filled in, but
      // keep the division and anything the user typed about the customer.
      setForm(prev => ({
        ...prev, offerType: '', subject: '', system: '', siteDescription: '',
        benefitsOfSystem: '', gstPercent: 18, offerValidity: '', delivery: '', notes: '',
      }));
      setEquipmentItems([{ ...EMPTY_LINE }]);
      setAccessoriesItems([]);
      setPaymentTerms([]);
      setExcludedWorks(['']);
      return;
    }
    const p = presets.find((x) => x.code === code);
    if (!p) return;
    setForm(prev => ({
      ...prev,
      division: p.division || prev.division,
      offerType: p.code,
      subject: p.subject || '',
      system: p.system || '',
      siteDescription: p.siteDescription || '',
      benefitsOfSystem: p.benefitsOfSystem || '',
      gstPercent: p.gstPercent != null ? p.gstPercent : 18,
      offerValidity: p.offerValidity || '',
      delivery: p.delivery || '',
      notes: p.notes || '',
    }));
    setEquipmentItems((p.equipmentItems || []).length ? p.equipmentItems.map(i => ({ ...EMPTY_LINE, ...i })) : [{ ...EMPTY_LINE }]);
    setAccessoriesItems((p.accessoriesItems || []).map(i => ({ ...EMPTY_LINE, ...i })));
    setPaymentTerms((p.paymentTerms || []).map((r, i) => ({ ...r, sequence: r.sequence || i + 1 })));
    setExcludedWorks((p.excludedWorks || []).length ? [...p.excludedWorks] : ['']);
  }

  function applyStartingPoint(id, divisionOverride) {
    setAppliedPreset('');
    setAppliedStart(id);
    if (!id) return;
    const t = startingPoints.find(x => x.id === id);
    if (!t) return;
    setForm(prev => ({
      ...prev,
      division: divisionOverride || t.division || prev.division,
      subject: t.subject || '',
      system: t.system || '',
      capacity: t.capacity || '',
      siteDescription: t.siteDescription || '',
      summaryText: t.summaryText || '',
      technicalDescription: t.technicalDescription || '',
      designApproval: t.designApproval || '',
      benefitsOfSystem: t.benefitsOfSystem || '',
      designBy: t.designBy || '',
      systemApprovedBy: t.systemApprovedBy || '',
      gstPercent: t.gstPercent != null ? t.gstPercent : 18,
      offerValidity: t.offerValidity || '',
      delivery: t.delivery || '',
      notes: t.notes || '',
    }));
    setEquipmentItems((t.equipmentItems || []).length ? t.equipmentItems.map(i => ({ ...i })) : [{ ...EMPTY_LINE }]);
    setAccessoriesItems((t.accessoriesItems || []).map(i => ({ ...i })));
    setPaymentTerms((t.paymentTerms || []).map((r, i) => ({ ...r, sequence: r.sequence || i + 1 })));
    setExcludedWorks((t.excludedWorks || []).length ? [...t.excludedWorks] : ['']);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  // Autocomplete handler — takes division from current form state
  const handleAutocomplete = useCallback(async (query) => {
    if (!form.division) return [];
    const data = await api.get(`/api/item-names/autocomplete?division=${form.division}&q=${encodeURIComponent(query)}&limit=8`);
    return data.items || [];
  }, [form.division]);

  // Calculate totals
  function calcTotals() {
    return quotationTotals(equipmentItems, accessoriesItems, form.gstPercent, form.division);
  }

  // Apply payment term template
  function applyTemplate(templateId) {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const tmpl = templates.find(t => t.id === templateId);
    if (tmpl && tmpl.rows) {
      setPaymentTerms(tmpl.rows.map((r, i) => ({
        sequence: r.sequence || i + 1,
        section: r.section || '',
        label: r.label || '',
        percentage: r.percentage || 0,
        triggerEvent: r.triggerEvent || '',
        wording: r.wording || '',
      })));
    }
  }

  // Payment term rows
  function addPaymentTerm() {
    setPaymentTerms(prev => [...prev, { sequence: prev.length + 1, section: '', label: '', percentage: 0, triggerEvent: '', wording: '' }]);
  }
  function setTermField(idx, key, value) {
    setPaymentTerms(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }
  function removePaymentTerm(idx) {
    setPaymentTerms(prev => prev.filter((_, i) => i !== idx));
  }

  // Excluded works
  function setExcludedWork(idx, value) {
    setExcludedWorks(prev => { const copy = [...prev]; copy[idx] = value; return copy; });
  }
  function addExcludedWork() {
    setExcludedWorks(prev => [...prev, '']);
  }
  function removeExcludedWork(idx) {
    setExcludedWorks(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Checked here rather than by the browser: a browser-blocked submit is
    // silent (nothing happens, no message), which is indistinguishable from
    // the app being broken.
    const problem = quotationProblem(form);
    if (problem) { setSaveError(problem); return; }
    setSaveError('');
    setBusy(true);
    try {
      const payload = {
        ...form,
        gstPercent: form.gstPercent === '' || form.gstPercent == null ? 18 : Number(form.gstPercent), // 0% allowed
        equipmentItems: equipmentItems.filter(i => i.description),
        accessoriesItems: accessoriesItems.filter(i => i.description),
        paymentTerms: paymentTerms.filter(t => t.label || t.wording),
        paymentTermTemplateId: selectedTemplate || undefined,
        excludedWorks: excludedWorks.filter(Boolean),
      };
      const data = await api.post('/api/quotations', payload);
      navigate(`/quotations/${data.quotation.id}`);
    } catch (err) {
      setSaveError(err.message || 'Could not create the quotation.');
    } finally {
      setBusy(false);
    }
  }

  const totals = calcTotals();

  return (
    <div className="enq-page">
      <h2>New Quotation</h2>

      {/* What kind of offer? (owner request, 23 Oct 2026) — picking one fills
          in that offer's own descriptions, so only prices have to be typed. */}
      {presets.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>What kind of offer is this?</h3>
          <div className="offer-types">
            {presets.map(p => (
              <button
                key={p.code}
                type="button"
                aria-pressed={appliedPreset === p.code}
                className={`offer-type${appliedPreset === p.code ? ' on' : ''}`}
                onClick={() => applyPreset(p.code)}
              >
                <span className="offer-type-name">{p.name}</span>
                <span className="offer-type-note">{p.description}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={!appliedPreset}
              className={`offer-type${!appliedPreset ? ' on' : ''}`}
              onClick={() => applyPreset('')}
            >
              <span className="offer-type-name">Start from blank</span>
              <span className="offer-type-note">Type every line yourself.</span>
            </button>
          </div>
          {appliedPreset && (
            <div style={{ color: '#5b6b7c', fontSize: 13, marginTop: 8 }}>
              The descriptions below come from your own offer sheet. Fill in the capacities,
              quantities and prices — every rate starts at 0, nothing is carried over from
              another quotation. Change or remove any line you do not need.
            </div>
          )}
        </div>
      )}

      {startingPoints.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <label className="filter-field" style={{ margin: 0 }}>
            Start from
            <select value={appliedStart} onChange={e => applyStartingPoint(e.target.value)}>
              <option value="">Blank quotation</option>
              {startingPoints.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.division ? ` — ${t.division}` : ''}{t.isDefault ? ' (used automatically)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div style={{ color: '#5b6b7c', fontSize: 13, marginTop: 6 }}>
            {appliedStart && startingPoints.find(t => t.id === appliedStart && t.isDefault)
              ? 'Filled in automatically for this division. Change anything you like, or switch to a blank quotation.'
              : 'Fills in the usual wording for that kind of offer. You can change anything afterwards.'}
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>

        {/* ── Customer & General Details ── */}
        <div className="panel">
          <h3>Quotation Details</h3>
          <div className="form-grid">
            <label className="filter-field">
              Division *
              <DivisionSelector value={form.division} onChange={chooseDivision} required />
            </label>
            <label className="filter-field">
              Date
              <input type="date" value={form.date} onChange={e => setField('date', e.target.value)} />
            </label>
            <label className="filter-field">
              Customer Name *
              <input value={form.customerName} onChange={e => setField('customerName', e.target.value)} required />
            </label>
            <label className="filter-field">
              Customer Address
              <input value={form.customerAddress} onChange={e => setField('customerAddress', e.target.value)} />
            </label>
            <label className="filter-field">
              Customer Phone
              <input value={form.customerPhone} onChange={e => setField('customerPhone', e.target.value)} />
            </label>
            <label className="filter-field">
              Customer Email
              <input type="email" value={form.customerEmail} onChange={e => setField('customerEmail', e.target.value)} />
            </label>
            <label className="filter-field">
              Customer GST
              <input value={form.customerGst} onChange={e => setField('customerGst', e.target.value)} />
            </label>
            <label className="filter-field">
              Subject
              <input value={form.subject} onChange={e => setField('subject', e.target.value)} />
            </label>
            <label className="filter-field">
              System
              <input value={form.system} onChange={e => setField('system', e.target.value)} />
            </label>
            <label className="filter-field">
              Capacity
              <input value={form.capacity} onChange={e => setField('capacity', e.target.value)} />
            </label>
          </div>
        </div>

        {/* ── Technical Description ── */}
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Technical Details</h3>
          <div className="form-grid">
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Site Description
              <textarea rows={2} value={form.siteDescription} onChange={e => setField('siteDescription', e.target.value)} />
            </label>
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Summary Text
              <textarea rows={2} value={form.summaryText} onChange={e => setField('summaryText', e.target.value)} />
            </label>
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Technical Description
              <textarea rows={3} value={form.technicalDescription} onChange={e => setField('technicalDescription', e.target.value)} />
            </label>
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Design Approval
              <textarea rows={2} value={form.designApproval} onChange={e => setField('designApproval', e.target.value)} />
            </label>
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Benefits of System
              <textarea rows={2} value={form.benefitsOfSystem} onChange={e => setField('benefitsOfSystem', e.target.value)} />
            </label>
            <label className="filter-field">
              Design By
              <input value={form.designBy} onChange={e => setField('designBy', e.target.value)} />
            </label>
            <label className="filter-field">
              System Approved By
              <input value={form.systemApprovedBy} onChange={e => setField('systemApprovedBy', e.target.value)} />
            </label>
          </div>
        </div>

        {/* ── Equipment Items (Solar: single flat section, no Accessories) ── */}
        <LineItemsEditor items={equipmentItems} setItems={setEquipmentItems} label={form.division === 'Solar' ? 'Solar Equipment' : 'Equipment'} onAutocomplete={handleAutocomplete} isSolar={form.division === 'Solar'} />

        {/* ── Accessories Items (hidden for Solar — Solar uses flat table) ── */}
        {form.division !== 'Solar' && (
          <LineItemsEditor items={accessoriesItems} setItems={setAccessoriesItems} label="Accessories" onAutocomplete={handleAutocomplete} isSolar={false} />
        )}

        {/* ── Totals ── */}
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Totals</h3>
          <div className="detail-grid">
            <div><strong>Equipment Total</strong><br/>{money(totals.eqTotal)}</div>
            <div><strong>Accessories Total</strong><br/>{money(totals.accTotal)}</div>
            <div><strong>Subtotal</strong><br/>{money(totals.subtotal)}</div>
            <div>
              <strong>GST %</strong><br/>
              <input type="number" value={form.gstPercent} onChange={e => setField('gstPercent', e.target.value)}
                style={{ width: 60 }} min={0} max={100} />
            </div>
            <div><strong>GST Amount</strong><br/>{money(totals.gstAmount)}</div>
            <div><strong>Grand Total</strong><br/><span style={{ fontSize: 18, fontWeight: 'bold' }}>{money(totals.grandTotal)}</span></div>
          </div>
        </div>

        {/* ── Payment Terms ── */}
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Payment Terms</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {templates.length > 0 && (
                <select value={selectedTemplate} onChange={e => applyTemplate(e.target.value)} style={{ maxWidth: 200 }}>
                  <option value="">— Apply Template —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button type="button" className="btn sec sm" onClick={addPaymentTerm}>+ Add Term</button>
            </div>
          </div>
          {paymentTerms.length > 0 && (
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Label</th>
                  <th style={{ width: 70 }}>%</th>
                  <th>Wording</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {paymentTerms.map((t, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td><input value={t.label} onChange={e => setTermField(idx, 'label', e.target.value)} style={{ width: '100%' }} /></td>
                    <td><input type="number" value={t.percentage} onChange={e => setTermField(idx, 'percentage', Number(e.target.value))} style={{ width: 60 }} min={0} max={100} /></td>
                    <td><input value={t.wording} onChange={e => setTermField(idx, 'wording', e.target.value)} style={{ width: '100%' }} /></td>
                    <td><button type="button" className="btn danger sm" onClick={() => removePaymentTerm(idx)}>&times;</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Commercial Terms ── */}
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Commercial Terms</h3>
          <div className="form-grid">
            <label className="filter-field">
              Offer Validity
              <input value={form.offerValidity} onChange={e => setField('offerValidity', e.target.value)} placeholder="e.g. 15 days" />
            </label>
            <label className="filter-field">
              Delivery
              <input value={form.delivery} onChange={e => setField('delivery', e.target.value)} placeholder="e.g. 4-6 weeks" />
            </label>
            <label className="filter-field" style={{ gridColumn: '1 / -1' }}>
              Notes
              <textarea rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Excluded Works</strong>
              <button type="button" className="btn sec sm" onClick={addExcludedWork}>+ Add</button>
            </div>
            {excludedWorks.map((w, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input value={w} onChange={e => setExcludedWork(idx, e.target.value)} style={{ flex: 1 }} placeholder="Excluded work item" />
                <button type="button" className="btn danger sm" onClick={() => removeExcludedWork(idx)}>&times;</button>
              </div>
            ))}
          </div>
        </div>

        {saveError && (
          <div className="panel" style={{ marginTop: 16, borderLeft: '4px solid #d92b2b' }}>
            <strong style={{ color: '#d92b2b' }}>Not saved</strong>
            <div style={{ marginTop: 4 }}>{saveError}</div>
          </div>
        )}

        {/* ── Submit ── */}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? 'Creating…' : 'Create Quotation'}
          </button>
          <button type="button" className="btn sec" onClick={() => navigate('/quotations')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
