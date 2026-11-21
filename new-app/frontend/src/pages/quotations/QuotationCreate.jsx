import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { money, today } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import { quotationProblem } from './quotationValidation';
import LineItemsEditor, { EMPTY_LINE } from './LineItemsEditor';
import { GstSelect } from '../../components/AmountInput';
import DraftBar, { useDrafts } from '../../components/DraftBar';
import ClientSelect from '../../components/ClientSelect';
import ContactPick from '../../components/ContactPick';
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
  // Owner decision (14 Nov 2026): a quotation is normally raised from a
  // lead. Arriving with ?enquiryId=… fills the form from it and keeps the
  // link, so the sales order made from this quotation can mark that lead
  // Won. Opened without one, it is a quotation with no lead behind it.
  const [searchParams] = useSearchParams();
  const enquiryId = searchParams.get('enquiryId');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [form, setForm] = useState({
    division: '', offerType: '', customerName: '', customerAddress: '', customerPhone: '',
    customerEmail: '', customerGst: '', subject: '', system: '', capacity: '',
    siteDescription: '', summaryText: '', technicalDescription: '', designApproval: '',
    benefitsOfSystem: '', designBy: '', systemApprovedBy: '',
    gstPercent: 18, offerValidity: '', delivery: '', notes: '', date: today(),
    clientId: null,
    // Owner request (17 Nov 2026): which person at the client this offer is
    // for. Picked from their record, printed as "Kind Attn:".
    contactName: '', contactDesignation: '',
  });
  // The client whose people the picker offers. Held only while the form is
  // open — what is SAVED is the person's name, designation and number.
  const [pickedClient, setPickedClient] = useState(null);
  const [equipmentItems, setEquipmentItems] = useState([{ ...EMPTY_LINE }]);
  const [accessoriesItems, setAccessoriesItems] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [excludedWorks, setExcludedWorks] = useState(['']);

  /* Save as Draft (owner request, 14 Nov 2026). The draft is this whole
     screen, put away. Nothing is numbered until Create Quotation is pressed,
     so an abandoned draft leaves no gap in the QTN numbering. */
  const drafts = useDrafts(
    'quotation',
    () => ({ form, equipmentItems, accessoriesItems, paymentTerms, excludedWorks, selectedTemplate }),
    form.customerName || form.subject || 'Untitled quotation'
  );
  function resumeDraft(p) {
    if (p.form) setForm((f) => ({ ...f, ...p.form }));
    if (Array.isArray(p.equipmentItems)) setEquipmentItems(p.equipmentItems);
    if (Array.isArray(p.accessoriesItems)) setAccessoriesItems(p.accessoriesItems);
    if (Array.isArray(p.paymentTerms)) setPaymentTerms(p.paymentTerms);
    if (Array.isArray(p.excludedWorks)) setExcludedWorks(p.excludedWorks);
    if (p.selectedTemplate !== undefined) setSelectedTemplate(p.selectedTemplate);
    setSaveError('');
  }

  /* Prefill from the lead this is being quoted for. Only the fields a lead
     actually knows — the rest is the quotation's own work. */
  useEffect(() => {
    if (!enquiryId) return;
    let alive = true;
    api.get(`/api/enquiries/${enquiryId}`)
      .then((d) => {
        const e = d.enquiry;
        if (!alive || !e) return;
        setForm((f) => ({
          ...f,
          // A lead's segment may be AMC, which is not a quotable division;
          // HVAC is where those jobs go, exactly as the old conversion did.
          division: e.segment === 'AMC' ? 'HVAC' : (e.segment || ''),
          customerName: e.name || '',
          customerPhone: e.phone || '',
          subject: e.name || '',
          capacity: e.capacity || '',
        }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enquiryId]);

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
  // "Type my own" on the System picker — see the field below.
  const [systemTyped, setSystemTyped] = useState(false);
  const [appliedPreset, setAppliedPreset] = useState('');
  /*
   * Owner request (21 Nov 2026): "can select which AMC Client we are giving
   * this quote to or new client." An AMC offer is nearly always for a site
   * already under contract with us, so the AMC/PM list itself is the
   * picker; leaving it on "new client" types the details as before.
   */
  const [amcClients, setAmcClients] = useState([]);
  const [amcPick, setAmcPick] = useState('');

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
      setAmcPick('');
      return;
    }
    const p = presets.find((x) => x.code === code);
    if (!p) return;
    // The AMC/PM list, fetched the first time an AMC offer is chosen.
    if (code.startsWith('amc') && amcClients.length === 0) {
      api.get('/api/contracts')
        .then((data) => setAmcClients(data.contracts || []))
        .catch(() => { /* optional: the details can still be typed */ });
    }
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
  // The system wordings the built-in offer types carry, offered as a list;
  // anything else was typed, so the box is open from the start.
  const systemOptions = [...new Set(presets.map((p) => p.system).filter(Boolean))];
  const systemIsOwn = systemTyped
    || Boolean(form.system && systemOptions.length > 0 && !systemOptions.includes(form.system));

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
        enquiryId: enquiryId || undefined,
      };
      const data = await api.post('/api/quotations', payload);
      // The quotation exists now, so the draft of it has done its job.
      await drafts.discard();
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

      {/* Owner request (21 Nov 2026): which AMC client this quote is for —
          or none of them, and the details are typed below as usual. */}
      {appliedPreset.startsWith('amc') && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <label className="filter-field" style={{ margin: 0 }}>
            Which AMC client is this quote for?
            <select
              value={amcPick}
              onChange={(e) => {
                const id = e.target.value;
                setAmcPick(id);
                const c = amcClients.find((x) => String(x.id) === id);
                if (!c) return;
                setForm((f) => ({
                  ...f,
                  clientId: c.clientId || f.clientId,
                  customerName: c.customer || f.customerName,
                  customerPhone: c.phone || f.customerPhone,
                  customerEmail: c.email || f.customerEmail,
                  customerAddress: f.customerAddress || c.site || '',
                  capacity: c.capacity || f.capacity,
                }));
              }}
            >
              <option value="">— New client, I will type the details —</option>
              {amcClients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {[c.customer, c.site, c.capacity].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </label>
          <div style={{ color: '#5b6b7c', fontSize: 13, marginTop: 6 }}>
            {amcClients.length === 0
              ? 'No AMC or PM contracts on file yet — type the client details below.'
              : 'Picking one fills in their name, number and site. Anything can be changed below.'}
          </div>
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
            {/* Owner request (16 Nov 2026): pick a client we already have
                and their number, GST and address come with them. */}
            <ClientSelect
              label="Customer Name"
              required
              value={form.customerName}
              onType={(v) => setField('customerName', v)}
              onPick={(c) => {
                setPickedClient(c);
                setForm((f) => ({
                  ...f,
                  // Owner request (17 Nov 2026): record WHICH client, so their
                  // history is exact rather than matched on a typed name.
                  clientId: c.id,
                  customerName: c.companyName || c.clientName || f.customerName,
                  customerPhone: f.customerPhone || c.phone || '',
                  customerEmail: f.customerEmail || c.email || '',
                  customerAddress: f.customerAddress || c.address || '',
                  customerGst: f.customerGst || c.gst || '',
                }));
              }}
            />
            {/* Owner request (17 Nov 2026): and WHO at that client. Their
                number fills the phone field the team already dials. */}
            <ContactPick
              client={pickedClient}
              picked={form.contactName ? { name: form.contactName, phone: form.customerPhone } : null}
              onPick={(person) => setForm((f) => ({
                ...f,
                contactName: person ? person.name : '',
                contactDesignation: person ? person.designation : '',
                customerPhone: person ? (person.phone || f.customerPhone) : f.customerPhone,
              }))}
              label="Kind Attn — who at the client?"
            />
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
            {/* Owner request (19 Nov 2026): "System coming directly Samsung.
                Required option to select or manual type." */}
            <label className="filter-field">
              System
              <select
                value={systemIsOwn ? '__own' : (form.system || '')}
                onChange={(e) => {
                  if (e.target.value === '__own') { setSystemTyped(true); return; }
                  setSystemTyped(false);
                  setField('system', e.target.value);
                }}
              >
                <option value="">— none —</option>
                {systemOptions.map((sys) => <option key={sys} value={sys}>{sys}</option>)}
                <option value="__own">Type my own…</option>
              </select>
              {systemIsOwn && (
                <input
                  style={{ marginTop: 6 }}
                  placeholder="e.g. DAIKIN VRV System."
                  value={form.system}
                  onChange={e => setField('system', e.target.value)}
                />
              )}
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
              <GstSelect value={form.gstPercent} onChange={v => setField('gstPercent', v)}
                style={{ width: 110 }} ariaLabel="GST %" title="GST % on the subtotal — No GST charges nothing" />
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
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? 'Creating…' : 'Create Quotation'}
          </button>
          <DraftBar drafts={drafts} onResume={resumeDraft} />
          <button type="button" className="btn sec" onClick={() => navigate('/quotations')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
