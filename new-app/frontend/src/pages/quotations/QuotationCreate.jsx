import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { money, today } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import '../enquiries/enquiry.css';

/**
 * Create / Edit Quotation — Equipment + Accessories line items.
 *
 * Uses "Equipment" / "Accessories" NOT "High Side" / "Low Side".
 * Item name autocomplete from /api/item-names/autocomplete.
 *
 * API: POST /api/quotations (create)
 *      PATCH /api/quotations/:id (update — via QuotationDetail edit mode)
 */

const EMPTY_LINE = { description: '', unit: 'Nos', qty: 1, supplyRate: 0, installationRate: 0, gstPercent: null };

function LineItemTable({ items, setItems, label, onAutocomplete, isSolar }) {
  function setItemField(idx, key, value) {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }

  function addRow() {
    setItems(prev => [...prev, { ...EMPTY_LINE }]);
  }

  function removeRow(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function calcLine(item) {
    const supply = (item.qty || 0) * (item.supplyRate || 0);
    const install = (item.qty || 0) * (item.installationRate || 0);
    return { supply, install, total: supply + install };
  }

  const colCount = isSolar ? 8 : 8;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>{label} Items</h3>
        <button type="button" className="btn sec sm" onClick={addRow}>+ Add Row</button>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th style={{ minWidth: 200 }}>Description</th>
              <th style={{ width: 70 }}>Unit</th>
              <th style={{ width: 70 }}>Qty</th>
              <th style={{ width: 100 }}>Supply Rate</th>
              {!isSolar && <th style={{ width: 100 }}>Install Rate</th>}
              {isSolar && <th style={{ width: 80 }}>GST %</th>}
              <th style={{ width: 100, textAlign: 'right' }}>Basic Amt</th>
              {isSolar && <th style={{ width: 100, textAlign: 'right' }}>Amt with GST</th>}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={colCount + 1} style={{ textAlign: 'center', color: '#888' }}>No items. Click + Add Row.</td></tr>
            ) : items.map((item, idx) => {
              const calc = calcLine(item);
              const basicAmt = isSolar ? calc.supply : calc.total;
              const gstPct = item.gstPercent != null ? item.gstPercent : 18;
              const amtWithGst = Math.round(basicAmt * (1 + gstPct / 100));
              return (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <ItemAutocomplete
                      value={item.description}
                      onChange={val => setItemField(idx, 'description', val)}
                      onAutocomplete={onAutocomplete}
                    />
                  </td>
                  <td><input value={item.unit} onChange={e => setItemField(idx, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                  <td><input type="number" min={0} value={item.qty} onChange={e => setItemField(idx, 'qty', Number(e.target.value))} style={{ width: 60 }} /></td>
                  <td><input type="number" min={0} value={item.supplyRate} onChange={e => setItemField(idx, 'supplyRate', Number(e.target.value))} style={{ width: 90 }} /></td>
                  {!isSolar && <td><input type="number" min={0} value={item.installationRate} onChange={e => setItemField(idx, 'installationRate', Number(e.target.value))} style={{ width: 90 }} /></td>}
                  {isSolar && <td><input type="number" min={0} value={item.gstPercent != null ? item.gstPercent : ''} onChange={e => setItemField(idx, 'gstPercent', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 70 }} placeholder="18" /></td>}
                  <td style={{ textAlign: 'right' }}>{money(basicAmt)}</td>
                  {isSolar && <td style={{ textAlign: 'right' }}>{money(amtWithGst)}</td>}
                  <td><button type="button" className="btn danger sm" onClick={() => removeRow(idx)} title="Remove">&times;</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Item description input with autocomplete from the item-name library.
 */
function ItemAutocomplete({ value, onChange, onAutocomplete }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function handleInput(val) {
    onChange(val);
    if (val.length >= 2 && onAutocomplete) {
      try {
        const data = await onAutocomplete(val);
        setSuggestions(data || []);
        setShowSuggestions(true);
      } catch { setSuggestions([]); }
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  function pickSuggestion(name) {
    onChange(name);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
        placeholder="Item description"
        style={{ width: '100%' }}
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: '#fff', border: '1px solid #ccc', borderRadius: 4,
          listStyle: 'none', margin: 0, padding: 0, maxHeight: 150, overflowY: 'auto',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          {suggestions.map((s, i) => (
            <li key={i}
              onMouseDown={() => pickSuggestion(s.name)}
              style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
            >
              {s.name} {s.unit ? <span style={{ color: '#888', fontSize: 12 }}>({s.unit})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function QuotationCreate() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    division: '', customerName: '', customerAddress: '', customerPhone: '',
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

  useEffect(() => {
    api.get('/api/payment-term-templates?documentType=quotation')
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
  }, []);

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
    const eqTotal = equipmentItems.reduce((s, i) => s + (i.qty || 0) * ((i.supplyRate || 0) + (i.installationRate || 0)), 0);
    const accTotal = accessoriesItems.reduce((s, i) => s + (i.qty || 0) * ((i.supplyRate || 0) + (i.installationRate || 0)), 0);
    const subtotal = eqTotal + accTotal;
    const gst = form.gstPercent != null ? form.gstPercent : 18;
    const gstAmount = Math.round(subtotal * gst / 100);
    return { eqTotal, accTotal, subtotal, gstAmount, grandTotal: subtotal + gstAmount };
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
    if (!form.division) { alert('Division is required.'); return; }
    if (!form.customerName) { alert('Customer name is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        gstPercent: Number(form.gstPercent) || 18,
        equipmentItems: equipmentItems.filter(i => i.description),
        accessoriesItems: accessoriesItems.filter(i => i.description),
        paymentTerms: paymentTerms.filter(t => t.label || t.wording),
        paymentTermTemplateId: selectedTemplate || undefined,
        excludedWorks: excludedWorks.filter(Boolean),
      };
      const data = await api.post('/api/quotations', payload);
      navigate(`/quotations/${data.quotation.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totals = calcTotals();

  return (
    <div className="enq-page">
      <h2>New Quotation</h2>
      <form onSubmit={handleSubmit}>

        {/* ── Customer & General Details ── */}
        <div className="panel">
          <h3>Quotation Details</h3>
          <div className="form-grid">
            <label className="filter-field">
              Division *
              <DivisionSelector value={form.division} onChange={v => setField('division', v)} required />
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
        <LineItemTable items={equipmentItems} setItems={setEquipmentItems} label={form.division === 'Solar' ? 'Solar Equipment' : 'Equipment'} onAutocomplete={handleAutocomplete} isSolar={form.division === 'Solar'} />

        {/* ── Accessories Items (hidden for Solar — Solar uses flat table) ── */}
        {form.division !== 'Solar' && (
          <LineItemTable items={accessoriesItems} setItems={setAccessoriesItems} label="Accessories" onAutocomplete={handleAutocomplete} isSolar={false} />
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
