import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { money, fmtDate } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import { quotationProblem } from './quotationValidation';
import LineItemsEditor from './LineItemsEditor';
import { quotationTotals } from './quotationTotals';
import { whatsappUrl, displayNumber } from '../../utils/whatsapp';

/**
 * Quotation Detail — view, edit, duplicate, delete, print/PDF.
 *
 * Uses "Equipment" / "Accessories" NOT "High Side" / "Low Side".
 *
 * API: GET    /api/quotations/:id
 *      PATCH  /api/quotations/:id
 *      POST   /api/quotations/:id/duplicate
 *      DELETE /api/quotations/:id
 *      GET    /api/companies/my-profile (for PDF header)
 */

const STATUS_OPTIONS = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Revised', 'Cancelled'];

/**
 * A heading or specification line carries no price, so it is shown as one
 * wide row rather than a line of zeros (see LineItemsEditor for the kinds).
 */
function textRow(item, i, span, style) {
  const t = item.rowType || 'item';
  if (t !== 'heading' && t !== 'spec') return null;
  return (
    <tr key={i} style={t === 'heading' ? { background: '#f4f6fa' } : undefined}>
      <td colSpan={span} style={{ ...(style || {}), fontWeight: t === 'heading' ? 700 : 400, whiteSpace: 'pre-wrap' }}>
        {item.description}
      </td>
    </tr>
  );
}

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Mirrors quotationRoutes.js: create/edit/duplicate = admin, sales, finance; delete = admin, sales.
  const canEdit = ['admin', 'sales', 'finance'].includes(user?.role);
  const canDelete = ['admin', 'sales'].includes(user?.role);

  const [quotation, setQuotation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The customer-facing PDF link (owner decision, 22 Oct 2026). The old
  // "Print / Save as PDF" button opened a pop-up window, which the Android
  // app's web view blocks, so nothing happened at all; the PDF is now built
  // on the server and simply opened.
  //
  // Owner decision (24 Oct 2026): this PDF is now the ONLY rendering of a
  // quotation. The page used to carry two more — an on-screen preview built
  // in React, and a "Print this page" button that restyled that preview's
  // markup with its own stylesheet before printing. The three disagreed with
  // each other, so what was previewed, what came out of the printer and what
  // the customer received all looked different. Both have been removed:
  // preview, print and download now come from this one document.
  const [pdfToken, setPdfToken] = useState('');
  // Owner decision (22 Oct 2026): client messages go from the company WhatsApp.
  const [companyWa, setCompanyWa] = useState('');
  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    api.get('/api/companies/my-profile')
      .then((d) => {
        const co = d.company || {};
        setCompanyWa(co.whatsappNumber || '');
        setCompanyName(co.displayName || co.name || '');
      })
      .catch(() => {});
  }, []);
  const [saveError, setSaveError] = useState('');

  // Edit form state
  const [form, setForm] = useState({});
  const [equipItems, setEquipItems] = useState([]);
  const [accItems, setAccItems] = useState([]);
  const [payTerms, setPayTerms] = useState([]);
  const [exclWorks, setExclWorks] = useState([]);
  const [payTermTemplates, setPayTermTemplates] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/quotations/${id}`);
      const q = data.quotation;
      setQuotation(q);
      populateForm(q);
      api.get(`/api/quotations/${id}/pdf-link`)
        .then((d) => { if (d && d.pdfToken) setPdfToken(d.pdfToken); })
        .catch(() => { /* the PDF link is optional; the page still works */ });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function populateForm(q) {
    setForm({
      division: q.division || '', status: q.status || 'Draft',
      customerName: q.customerName || '', customerAddress: q.customerAddress || '',
      customerPhone: q.customerPhone || '', customerEmail: q.customerEmail || '',
      customerGst: q.customerGst || '', subject: q.subject || '',
      system: q.system || '', capacity: q.capacity || '',
      siteDescription: q.siteDescription || '', summaryText: q.summaryText || '',
      technicalDescription: q.technicalDescription || '', designApproval: q.designApproval || '',
      benefitsOfSystem: q.benefitsOfSystem || '', designBy: q.designBy || '',
      systemApprovedBy: q.systemApprovedBy || '',
      gstPercent: q.gstPercent != null ? q.gstPercent : 18,
      offerValidity: q.offerValidity || '', delivery: q.delivery || '',
      notes: q.notes || '', date: q.date ? fmtDate(q.date) : '',
      revision: q.revision || 0,
    });
    setEquipItems((q.equipmentItems || []).map(i => ({ ...i })));
    setAccItems((q.accessoriesItems || []).map(i => ({ ...i })));
    setPayTerms((Array.isArray(q.paymentTerms) ? q.paymentTerms : []).map(t => ({ ...t })));
    setExclWorks((Array.isArray(q.excludedWorks) && q.excludedWorks.length > 0) ? [...q.excludedWorks] : ['']);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  // Autocomplete
  const handleAutocomplete = useCallback(async (query) => {
    if (!form.division) return [];
    const data = await api.get(`/api/item-names/autocomplete?division=${form.division}&q=${encodeURIComponent(query)}&limit=8`);
    return data.items || [];
  }, [form.division]);

  // Line item helpers
  function setItemField(list, setList, idx, key, value) {
    setList(prev => { const c = [...prev]; c[idx] = { ...c[idx], [key]: value }; return c; });
  }

  function calcTotals(eqList, accList, gst, division) {
    return quotationTotals(eqList, accList, gst, division);
  }

  // Save
  async function handleSave(e) {
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
        equipmentItems: equipItems.filter(i => i.description),
        accessoriesItems: accItems.filter(i => i.description),
        paymentTerms: payTerms.filter(t => t.label || t.wording),
        excludedWorks: exclWorks.filter(Boolean),
      };
      const data = await api.patch(`/api/quotations/${id}`, payload);
      setQuotation(data.quotation);
      populateForm(data.quotation);
      setEditing(false);
    } catch (err) { setSaveError(err.message || 'Could not save the quotation.'); }
    finally { setBusy(false); }
  }

  // Save this quotation's wording as a ready-made starting point, so the
  // next offer of the same kind does not have to be retyped.
  function templateLine(i) {
    return {
      rowType: i.rowType || 'item',
      description: i.description,
      unit: i.unit,
      qty: i.qty,
      supplyRate: 0,
      installationRate: 0,
      gstPercent: i.gstPercent,
    };
  }

  async function handleSaveAsStartingPoint() {
    const name = window.prompt('Name this starting point (e.g. "Ductable AC offer")', q.system || q.subject || '');
    if (!name || !name.trim()) return;
    const isDefault = window.confirm(
      `Use this automatically for every new ${q.division} quotation?\n\n`
      + 'OK — it fills in on its own when you choose that division.\n'
      + 'Cancel — it stays in the "Start from" list and you pick it when you want it.'
    );
    try {
      await api.post('/api/quotation-templates', {
        name: name.trim(),
        division: q.division,
        isDefault,
        subject: q.subject, system: q.system, capacity: q.capacity,
        siteDescription: q.siteDescription, summaryText: q.summaryText,
        technicalDescription: q.technicalDescription, designApproval: q.designApproval,
        benefitsOfSystem: q.benefitsOfSystem, designBy: q.designBy,
        systemApprovedBy: q.systemApprovedBy, gstPercent: q.gstPercent,
        offerValidity: q.offerValidity, delivery: q.delivery, notes: q.notes,
        excludedWorks: q.excludedWorks || [],
        paymentTerms: q.paymentTerms || [],
        // Descriptions, units, quantities and the GST % carry over; the
        // rates are left blank on purpose, so a new offer is always priced
        // at today's rates rather than quietly repeating an old quotation's.
        equipmentItems: (q.equipmentItems || []).map(templateLine),
        accessoriesItems: (q.accessoriesItems || []).map(templateLine),
      });
      window.alert(
        isDefault
          ? `Saved. Every new ${q.division} quotation will now start from "${name.trim()}".\n\n`
            + 'Descriptions, units, quantities and GST % are kept. Rates are left blank, '
            + 'so every new offer is priced at the day\'s rates.'
          : `Saved. "${name.trim()}" will now appear under "Start from" on a new quotation.\n\n`
            + 'Descriptions, units, quantities and GST % are kept. Rates are left blank, '
            + 'so every new offer is priced at the day\'s rates.'
      );
    } catch (err) {
      window.alert(err.message || 'Could not save the starting point.');
    }
  }

  // Duplicate
  async function handleDuplicate() {
    if (!window.confirm('Duplicate this quotation as a new Draft?')) return;
    try {
      const data = await api.post(`/api/quotations/${id}/duplicate`);
      navigate(`/quotations/${data.quotation.id}`);
    } catch (err) { alert(err.message); }
  }

  // Delete
  async function handleDelete() {
    if (!window.confirm('Delete this quotation? Only Draft/Cancelled quotations can be deleted.')) return;
    try {
      await api.delete(`/api/quotations/${id}`);
      navigate('/quotations');
    } catch (err) { alert(err.message); }
  }

  function statusClass(status) {
    switch (status) {
      case 'Draft': return 'status-pending';
      case 'Sent': return 'status-open';
      case 'Accepted': return 'status-won';
      case 'Rejected': case 'Cancelled': return 'status-lost';
      default: return 'status-pending';
    }
  }

  if (loading) return <div className="enq-page"><p>Loading…</p></div>;
  if (error) return <div className="enq-page"><p className="error">{error}</p><button className="btn sec" onClick={() => navigate('/quotations')}>Back</button></div>;
  if (!quotation) return <div className="enq-page"><p>Quotation not found.</p></div>;

  const q = quotation;
  const pdfUrl = pdfToken && typeof window !== 'undefined'
    ? `${window.location.origin}/api/public/quotations/${pdfToken}`
    : '';
  const totals = calcTotals(q.equipmentItems || [], q.accessoriesItems || [], q.gstPercent, q.division);


  /* ── EDIT MODE ── */
  if (editing) {
    const editTotals = calcTotals(equipItems, accItems, form.gstPercent, form.division || q.division);
    return (
      <div className="enq-page">
        <h2>Edit Quotation — {q.quotationNumber}</h2>
        <form onSubmit={handleSave} noValidate>
          <div className="panel">
            <h3>Details</h3>
            <div className="form-grid">
              <label className="filter-field">Division * <DivisionSelector value={form.division} onChange={v => setField('division', v)} required /></label>
              <label className="filter-field">Status <select value={form.status} onChange={e => setField('status', e.target.value)}>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></label>
              <label className="filter-field">Date <input type="date" value={form.date} onChange={e => setField('date', e.target.value)} /></label>
              <label className="filter-field">Revision <input type="number" value={form.revision} onChange={e => setField('revision', Number(e.target.value))} min={0} /></label>
              <label className="filter-field">Customer Name * <input value={form.customerName} onChange={e => setField('customerName', e.target.value)} required /></label>
              <label className="filter-field">Customer Address <input value={form.customerAddress} onChange={e => setField('customerAddress', e.target.value)} /></label>
              <label className="filter-field">Customer Phone <input value={form.customerPhone} onChange={e => setField('customerPhone', e.target.value)} /></label>
              <label className="filter-field">Customer Email <input type="email" value={form.customerEmail} onChange={e => setField('customerEmail', e.target.value)} /></label>
              <label className="filter-field">Customer GST <input value={form.customerGst} onChange={e => setField('customerGst', e.target.value)} /></label>
              <label className="filter-field">Subject <input value={form.subject} onChange={e => setField('subject', e.target.value)} /></label>
              <label className="filter-field">System <input value={form.system} onChange={e => setField('system', e.target.value)} /></label>
              <label className="filter-field">Capacity <input value={form.capacity} onChange={e => setField('capacity', e.target.value)} /></label>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Site Description <textarea rows={2} value={form.siteDescription} onChange={e => setField('siteDescription', e.target.value)} /></label>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Summary Text <textarea rows={2} value={form.summaryText} onChange={e => setField('summaryText', e.target.value)} /></label>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Technical Description <textarea rows={3} value={form.technicalDescription} onChange={e => setField('technicalDescription', e.target.value)} /></label>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Design Approval <textarea rows={2} value={form.designApproval} onChange={e => setField('designApproval', e.target.value)} /></label>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Benefits of System <textarea rows={2} value={form.benefitsOfSystem} onChange={e => setField('benefitsOfSystem', e.target.value)} /></label>
              <label className="filter-field">Design By <input value={form.designBy} onChange={e => setField('designBy', e.target.value)} /></label>
              <label className="filter-field">System Approved By <input value={form.systemApprovedBy} onChange={e => setField('systemApprovedBy', e.target.value)} /></label>
            </div>
          </div>

          {/* Equipment (Solar: single flat section) */}
          <LineItemsEditor items={equipItems} setItems={setEquipItems} label={form.division === 'Solar' ? 'Solar Equipment' : 'Equipment'} onAutocomplete={handleAutocomplete} isSolar={form.division === 'Solar'} />
          {/* Accessories (hidden for Solar — Solar uses flat table) */}
          {form.division !== 'Solar' && (
            <LineItemsEditor items={accItems} setItems={setAccItems} label="Accessories" onAutocomplete={handleAutocomplete} isSolar={false} />
          )}

          {/* Totals */}
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Totals</h3>
            <div className="detail-grid">
              <div><strong>Equipment Total</strong><br/>{money(editTotals.eqTotal)}</div>
              <div><strong>Accessories Total</strong><br/>{money(editTotals.accTotal)}</div>
              <div><strong>Subtotal</strong><br/>{money(editTotals.subtotal)}</div>
              <div><strong>GST %</strong><br/><input type="number" value={form.gstPercent} onChange={e => setField('gstPercent', e.target.value)} style={{ width: 60 }} /></div>
              <div><strong>GST Amount</strong><br/>{money(editTotals.gstAmount)}</div>
              <div><strong>Grand Total</strong><br/><strong style={{ fontSize: 18 }}>{money(editTotals.grandTotal)}</strong></div>
            </div>
          </div>

          {/* Payment Terms */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Payment Terms</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {payTermTemplates.length > 0 && (
                  <select onChange={e => { const tpl = payTermTemplates.find(t => String(t.id || t._id) === e.target.value); if (tpl) setPayTerms(tpl.rows.map((r, i) => ({ ...r, sequence: i + 1 }))); e.target.value = ''; }} defaultValue="">
                    <option value="" disabled>Apply Template...</option>
                    {payTermTemplates.map(t => <option key={t.id || t._id} value={t.id || t._id}>{t.name}</option>)}
                  </select>
                )}
                <button type="button" className="btn sec sm" onClick={() => setPayTerms(prev => [...prev, { sequence: prev.length + 1, label: '', percentage: 0, wording: '' }])}>+ Add Term</button>
              </div>
            </div>
            {payTerms.length > 0 && (
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead><tr><th style={{ width: 40 }}>#</th><th>Label</th><th style={{ width: 70 }}>%</th><th>Wording</th><th style={{ width: 40 }}></th></tr></thead>
                <tbody>
                  {payTerms.map((t, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td><input value={t.label || ''} onChange={e => { const c = [...payTerms]; c[idx] = { ...c[idx], label: e.target.value }; setPayTerms(c); }} style={{ width: '100%' }} /></td>
                      <td><input type="number" value={t.percentage || 0} onChange={e => { const c = [...payTerms]; c[idx] = { ...c[idx], percentage: Number(e.target.value) }; setPayTerms(c); }} style={{ width: 60 }} /></td>
                      <td><input value={t.wording || ''} onChange={e => { const c = [...payTerms]; c[idx] = { ...c[idx], wording: e.target.value }; setPayTerms(c); }} style={{ width: '100%' }} /></td>
                      <td><button type="button" className="btn danger sm" onClick={() => setPayTerms(prev => prev.filter((_, i) => i !== idx))}>&times;</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Commercial */}
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Commercial Terms</h3>
            <div className="form-grid">
              <label className="filter-field">Offer Validity <input value={form.offerValidity} onChange={e => setField('offerValidity', e.target.value)} /></label>
              <label className="filter-field">Delivery <input value={form.delivery} onChange={e => setField('delivery', e.target.value)} /></label>
              <label className="filter-field" style={{ gridColumn: '1 / -1' }}>Notes <textarea rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} /></label>
            </div>
            <div style={{ marginTop: 8 }}>
              <strong>Excluded Works</strong>
              {exclWorks.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <input value={w} onChange={e => { const c = [...exclWorks]; c[i] = e.target.value; setExclWorks(c); }} style={{ flex: 1 }} />
                  <button type="button" className="btn danger sm" onClick={() => setExclWorks(prev => prev.filter((_, j) => j !== i))}>&times;</button>
                </div>
              ))}
              <button type="button" className="btn sec sm" style={{ marginTop: 4 }} onClick={() => setExclWorks(prev => [...prev, ''])}>+ Add</button>
            </div>
          </div>

          {saveError && (
            <div className="panel" style={{ marginTop: 16, borderLeft: '4px solid #d92b2b' }}>
              <strong style={{ color: '#d92b2b' }}>Not saved</strong>
              <div style={{ marginTop: 4 }}>{saveError}</div>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
            <button type="button" className="btn sec" onClick={() => { setEditing(false); populateForm(q); }}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  /* ── READ-ONLY VIEW ── */
  return (
    <div className="enq-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Quotation {q.quotationNumber}</h2>
          <span className={`status-badge ${statusClass(q.status)}`}>{q.status}</span>
          {q.revision > 0 && <span style={{ marginLeft: 8, color: '#888' }}>Rev {q.revision}</span>}
        </div>
        {/* Wraps on a phone — without this the last actions run off the edge. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pdfUrl
            ? <a className="btn pri sm" href={pdfUrl} target="_blank" rel="noopener noreferrer">Preview / Print</a>
            : <button className="btn pri sm" disabled>Preparing…</button>}
          {pdfUrl && whatsappUrl(q.customerPhone, 'x') && (
            <a
              className="btn sec sm"
              href={whatsappUrl(
                q.customerPhone,
                `Dear ${q.customerName || 'Sir/Madam'},\n\nPlease find our quotation ${q.quotationNumber}`
                + `${q.subject ? ` for ${q.subject}` : ''}:\n${pdfUrl}`
                + `${companyName ? `\n\nRegards,\n${companyName}` : ''}`
              )}
              target="_blank"
              rel="noopener noreferrer"
              title={companyWa ? `Use the phone or laptop that has ${displayNumber(companyWa)} on WhatsApp` : undefined}
            >
              WhatsApp{companyWa ? ` (from ${displayNumber(companyWa)})` : ''}
            </a>
          )}
          {canEdit && <button className="btn pri sm" onClick={() => { setEditing(true); api.get('/api/payment-term-templates?documentType=quotation').then(d => setPayTermTemplates(d.templates || [])).catch(() => {}); }}>Edit</button>}
          {canEdit && <button className="btn sec sm" onClick={handleDuplicate}>Duplicate</button>}
          {canEdit && <button className="btn sec sm" onClick={handleSaveAsStartingPoint}>Save as starting point</button>}
          {canDelete && (q.status === 'Draft' || q.status === 'Cancelled') && (
            <button className="btn danger sm" onClick={handleDelete}>Delete</button>
          )}
          <button className="btn sec sm" onClick={() => navigate('/quotations')}>Back</button>
        </div>
      </div>

      {/* Customer info */}
      <div className="panel">
        <h3>Customer & Project Details</h3>
        <div className="detail-grid">
          <div><strong>Division</strong><br/>{q.division}</div>
          <div><strong>Date</strong><br/>{fmtDate(q.date)}</div>
          <div><strong>Customer</strong><br/>{q.customerName}</div>
          <div><strong>Address</strong><br/>{q.customerAddress || '—'}</div>
          <div><strong>Phone</strong><br/>{q.customerPhone || '—'}</div>
          <div><strong>Email</strong><br/>{q.customerEmail || '—'}</div>
          <div><strong>GST</strong><br/>{q.customerGst || '—'}</div>
          <div><strong>Subject</strong><br/>{q.subject || '—'}</div>
          <div><strong>System</strong><br/>{q.system || '—'}</div>
          <div><strong>Capacity</strong><br/>{q.capacity || '—'}</div>
        </div>
      </div>

      {/* Technical */}
      {(q.siteDescription || q.summaryText || q.technicalDescription || q.designApproval) && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Technical Details</h3>
          {q.siteDescription && <div style={{ marginBottom: 8 }}><strong>Site Description:</strong><br/>{q.siteDescription}</div>}
          {q.summaryText && <div style={{ marginBottom: 8 }}><strong>Summary:</strong><br/>{q.summaryText}</div>}
          {q.technicalDescription && <div style={{ marginBottom: 8 }}><strong>Technical Description:</strong><br/><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{q.technicalDescription}</pre></div>}
          {q.designApproval && <div><strong>Design Approval:</strong><br/>{q.designApproval}</div>}
          {q.benefitsOfSystem && <div style={{ marginBottom: 8 }}><strong>Benefits of System:</strong><br/>{q.benefitsOfSystem}</div>}
          {(q.designBy || q.systemApprovedBy) && (
            <div style={{ display: 'flex', gap: 24 }}>
              {q.designBy && <div><strong>Design By:</strong> {q.designBy}</div>}
              {q.systemApprovedBy && <div><strong>System Approved By:</strong> {q.systemApprovedBy}</div>}
            </div>
          )}
        </div>
      )}

      {/* Equipment Items */}
      {(q.equipmentItems || []).length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>{q.division === 'Solar' ? 'Solar Equipment Items' : 'Equipment Items'}</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Description</th><th>Unit</th><th>Qty</th>
                <th style={{ textAlign: 'right' }}>Supply</th>
                {q.division !== 'Solar' && <th style={{ textAlign: 'right' }}>Installation</th>}
                {q.division === 'Solar' && <th style={{ textAlign: 'right' }}>GST %</th>}
                <th style={{ textAlign: 'right' }}>{q.division === 'Solar' ? 'Basic Amt' : 'Total'}</th>
                {q.division === 'Solar' && <th style={{ textAlign: 'right' }}>Amt with GST</th>}
              </tr>
            </thead>
            <tbody>
              {q.equipmentItems.map((item, i) => textRow(item, i, q.division === 'Solar' ? 8 : 7) || (
                <tr key={i}>
                  <td>{item.sNo || ''}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.qty}</td>
                  <td style={{ textAlign: 'right' }}>{money(item.supplyAmount)}</td>
                  {q.division !== 'Solar' && <td style={{ textAlign: 'right' }}>{money(item.installationAmount)}</td>}
                  {q.division === 'Solar' && <td style={{ textAlign: 'right' }}>{item.gstPercent != null ? `${item.gstPercent}%` : '—'}</td>}
                  <td style={{ textAlign: 'right' }}>{money(q.division === 'Solar' ? item.supplyAmount : item.totalAmount)}</td>
                  {q.division === 'Solar' && <td style={{ textAlign: 'right' }}>{money(item.amountWithGst)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessories Items (not shown for Solar — Solar uses flat table) */}
      {q.division !== 'Solar' && (q.accessoriesItems || []).length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Accessories Items</h3>
          <table className="data-table">
            <thead><tr><th>#</th><th>Description</th><th>Unit</th><th>Qty</th><th style={{ textAlign: 'right' }}>Supply</th><th style={{ textAlign: 'right' }}>Installation</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {q.accessoriesItems.map((item, i) => textRow(item, i, 7) || (
                <tr key={i}><td>{item.sNo || ''}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.qty}</td>
                  <td style={{ textAlign: 'right' }}>{money(item.supplyAmount)}</td><td style={{ textAlign: 'right' }}>{money(item.installationAmount)}</td><td style={{ textAlign: 'right' }}>{money(item.totalAmount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Totals</h3>
        <div className="detail-grid">
          <div><strong>Equipment Total</strong><br/>{money(q.equipmentTotal)}</div>
          <div><strong>Accessories Total</strong><br/>{money(q.accessoriesTotal)}</div>
          <div><strong>Subtotal</strong><br/>{money(q.subtotal)}</div>
          <div><strong>GST ({q.division === 'Solar' ? 'per item' : `${q.gstPercent ?? 18}%`})</strong><br/>{money(q.gstAmount)}</div>
          <div><strong>Grand Total</strong><br/><span style={{ fontSize: 18, fontWeight: 'bold' }}>{money(q.grandTotal)}</span></div>
        </div>
      </div>

      {/* Payment Terms */}
      {Array.isArray(q.paymentTerms) && q.paymentTerms.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Payment Terms</h3>
          <table className="data-table">
            <thead><tr><th>#</th><th>Term</th><th>%</th><th>Details</th></tr></thead>
            <tbody>
              {q.paymentTerms.map((t, i) => (
                <tr key={i}><td>{t.sequence || i + 1}</td><td>{t.label}</td><td>{t.percentage}%</td><td>{t.wording}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Commercial Terms */}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Commercial Terms</h3>
        <div className="detail-grid">
          <div><strong>Offer Validity</strong><br/>{q.offerValidity || '—'}</div>
          <div><strong>Delivery</strong><br/>{q.delivery || '—'}</div>
        </div>
        {(q.excludedWorks || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <strong>Excluded Works:</strong>
            <ul>{q.excludedWorks.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {q.notes && <div style={{ marginTop: 8 }}><strong>Notes:</strong><br/><p style={{ whiteSpace: 'pre-wrap' }}>{q.notes}</p></div>}
      </div>
    </div>
  );
}
