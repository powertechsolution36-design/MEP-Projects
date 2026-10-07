import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { money, fmtDate } from '../../utils/format';
import DivisionSelector from '../../components/DivisionSelector';
import '../enquiries/enquiry.css';

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
const EMPTY_LINE = { description: '', unit: 'Nos', qty: 1, supplyRate: 0, installationRate: 0 };

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = ['admin', 'sales'].includes(user?.role);

  const [quotation, setQuotation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [companyProfile, setCompanyProfile] = useState(null);
  const printRef = useRef(null);

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

  function calcTotals(eqList, accList, gst) {
    const eqTotal = eqList.reduce((s, i) => s + (i.qty || 0) * ((i.supplyRate || 0) + (i.installationRate || 0)), 0);
    const accTotal = accList.reduce((s, i) => s + (i.qty || 0) * ((i.supplyRate || 0) + (i.installationRate || 0)), 0);
    const subtotal = eqTotal + accTotal;
    const g = gst != null ? gst : 18;
    const gstAmount = Math.round(subtotal * g / 100);
    return { eqTotal, accTotal, subtotal, gstPercent: g, gstAmount, grandTotal: subtotal + gstAmount };
  }

  // Save
  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        gstPercent: Number(form.gstPercent) || 18,
        equipmentItems: equipItems.filter(i => i.description),
        accessoriesItems: accItems.filter(i => i.description),
        paymentTerms: payTerms.filter(t => t.label || t.wording),
        excludedWorks: exclWorks.filter(Boolean),
      };
      const data = await api.patch(`/api/quotations/${id}`, payload);
      setQuotation(data.quotation);
      populateForm(data.quotation);
      setEditing(false);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
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

  // Print / PDF
  async function openPreview() {
    try {
      const data = await api.get('/api/companies/my-profile');
      setCompanyProfile(data.company);
    } catch { /* profile optional */ }
    setShowPreview(true);
  }

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Quotation ${quotation.quotationNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        .text-right { text-align: right; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
        .company-name { font-size: 20px; font-weight: bold; color: #1a4a7a; }
        .subtitle { font-size: 12px; color: #666; }
        h2 { margin: 16px 0 8px; font-size: 15px; border-bottom: 2px solid #1a4a7a; padding-bottom: 4px; }
        .totals-table td { border: none; padding: 3px 8px; }
        .totals-table .label { font-weight: 600; text-align: right; }
        .grand-total { font-size: 16px; font-weight: bold; }
        .footer { margin-top: 30px; display: flex; justify-content: space-between; }
        .stamp-block { text-align: center; }
        .stamp-block img { max-width: 120px; max-height: 60px; }
        .page-break { page-break-before: always; break-before: page; }
        @media print { body { padding: 0; } @page { margin: 15mm; } }
      </style>
    </head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
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
  const totals = calcTotals(q.equipmentItems || [], q.accessoriesItems || [], q.gstPercent);

  /* ── PRINT PREVIEW MODAL ── */
  if (showPreview) {
    const cp = companyProfile || {};
    const isSolar = q.division === 'Solar';
    const allItems = [...(q.equipmentItems || []), ...(q.accessoriesItems || [])];
    const eqItems = q.equipmentItems || [];
    const accItems = q.accessoriesItems || [];

    // Shared header renderer
    function renderHeader() {
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            {cp.logoBase64 && <img src={cp.logoBase64} alt="Logo" style={{ maxHeight: 50, marginBottom: 4 }} />}
            <div style={{ fontSize: 12, color: '#666' }}>{cp.tagline || ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1a4a7a' }}>{cp.displayName || cp.name || 'Company Name'}</div>
            {cp.subtitle && <div style={{ fontSize: 14, fontWeight: 600, color: '#c0392b' }}>{cp.subtitle}</div>}
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {cp.address && <div>{cp.address}</div>}
              {cp.email && <div>{cp.email}</div>}
              {cp.website && <div>{cp.website}</div>}
            </div>
          </div>
        </div>
      );
    }

    // Shared footer renderer
    function renderFooter() {
      return (
        <div style={{ marginTop: 40 }}>
          <div>Yours truly,</div>
          <div style={{ fontWeight: 'bold' }}>For {cp.displayName || cp.name || 'Company'}</div>
          <div style={{ marginTop: 8 }}>
            {cp.authorizedPerson?.signatureBase64 && <div><img src={cp.authorizedPerson.signatureBase64} alt="Signature" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
            {cp.authorizedPerson?.stampBase64 && <div><img src={cp.authorizedPerson.stampBase64} alt="Stamp" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Design By - {q.designBy || ''}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>System Approved By - {q.systemApprovedBy || ''}</div>
            </div>
          </div>
        </div>
      );
    }

    const tds = { border: '1px solid #ccc', padding: '6px 8px' };
    const tdsR = { ...tds, textAlign: 'right' };
    const thS = { ...tds, background: '#f5f5f5', fontWeight: 600 };

    return (
      <div className="enq-page">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn pri" onClick={handlePrint}>Print / Save as PDF</button>
          <button className="btn sec" onClick={() => setShowPreview(false)}>Back to Detail</button>
        </div>
        <div ref={printRef} style={{ background: '#fff', padding: 24, border: '1px solid #ddd', maxWidth: 800, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>

          {/* ── PAGE 1: SUMMARY ── */}
          {renderHeader()}
          <div style={{ textAlign: 'center', background: '#e8e800', fontWeight: 'bold', padding: 4, marginBottom: 12 }}>SUMMARY</div>

          <div style={{ marginBottom: 8 }}><strong>Date:</strong> {fmtDate(q.date)}{q.quotationNumber ? ` | Ref: ${q.quotationNumber}` : ''}{q.revision > 0 ? ` | Rev ${q.revision}` : ''}</div>
          <div style={{ marginBottom: 8 }}><strong>Quote To -</strong> {q.customerName || '—'}</div>
          {q.customerAddress && <div style={{ marginBottom: 4 }}>{q.customerAddress}</div>}
          {q.customerPhone && <div style={{ marginBottom: 2 }}>Phone: {q.customerPhone}</div>}
          {q.customerEmail && <div style={{ marginBottom: 2 }}>Email: {q.customerEmail}</div>}
          {q.customerGst && <div style={{ marginBottom: 4 }}>GST: {q.customerGst}</div>}
          {q.subject && <div style={{ marginBottom: 12 }}><strong>Subject - </strong><u>{q.subject}</u></div>}

          {q.summaryText && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{q.summaryText}</div>}
          {q.siteDescription && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{q.siteDescription}</div>}

          {/* System/Capacity/Benefits — reference shows these on summary page */}
          {(q.system || q.capacity || q.benefitsOfSystem) && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <tbody>
                {q.system && <tr><td style={tds}><strong>System</strong></td><td style={tds}>{q.system}</td></tr>}
                {q.benefitsOfSystem && <tr><td style={tds}><strong>Benefits of System</strong></td><td style={tds}>{q.benefitsOfSystem}</td></tr>}
                {q.capacity && <tr><td style={tds}><strong>Capacity</strong></td><td style={tds}>{q.capacity}</td></tr>}
              </tbody>
            </table>
          )}

          {q.technicalDescription && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{q.technicalDescription}</div>}

          {renderFooter()}

          {/* ── PAGE 2: SUPPLY & INSTALLATION / PRICING ── */}
          <div className="page-break" style={{ paddingTop: 16 }}>
            {renderHeader()}

            {isSolar ? (
              <>
                {/* Solar: flat single table with per-item GST */}
                <div style={{ textAlign: 'center', background: '#e8e800', fontWeight: 'bold', padding: 4, marginBottom: 12 }}>SUPPLY &amp; INSTALLATION OF SOLAR SYSTEM</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thS}>S No</th>
                      <th style={thS}>Description</th>
                      <th style={thS}>Unit</th>
                      <th style={thS}>Qty</th>
                      <th style={{ ...thS, textAlign: 'right' }}>Supply</th>
                      <th style={{ ...thS, textAlign: 'right' }}>Basic Amount</th>
                      <th style={{ ...thS, textAlign: 'right' }}>GST %</th>
                      <th style={{ ...thS, textAlign: 'right' }}>Amount with GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allItems.map((item, i) => {
                      const basic = item.supplyAmount || 0;
                      const itemGst = item.gstPercent != null ? item.gstPercent : (q.gstPercent || 18);
                      const withGst = item.amountWithGst || Math.round(basic * (1 + itemGst / 100));
                      return (
                        <tr key={i}>
                          <td style={tds}>{item.sNo || i + 1}</td>
                          <td style={tds}>{item.description}</td>
                          <td style={tds}>{item.unit}</td>
                          <td style={tds}>{item.qty}</td>
                          <td style={tdsR}>{money(item.supplyRate)}</td>
                          <td style={tdsR}>{money(basic)}</td>
                          <td style={tdsR}>{itemGst}%</td>
                          <td style={tdsR}>{money(withGst)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: '#e8e800' }}>
                      <td colSpan={5} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>TOTAL (Basic)</td>
                      <td style={{ ...tdsR, fontWeight: 'bold' }}>{money(q.subtotal)}</td>
                      <td style={tds}></td>
                      <td style={tds}></td>
                    </tr>
                    <tr style={{ background: '#e8e800' }}>
                      <td colSpan={5} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>GRAND TOTAL WITH GST</td>
                      <td colSpan={3} style={{ ...tdsR, fontWeight: 'bold' }}>{money(q.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <>
                {/* HVAC/MEP: Equipment + Accessories sections with Supply/Installation columns */}
                <div style={{ textAlign: 'center', background: '#e8e800', fontWeight: 'bold', padding: 4, marginBottom: 12 }}>SUPPLY &amp; INSTALLATION OF {q.division === 'MEP' ? 'MEP' : 'HVAC'} SYSTEM</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thS}>S No</th>
                      <th style={thS}>Description</th>
                      <th style={thS}>Unit</th>
                      <th style={thS}>Qty</th>
                      <th colSpan={2} style={{ ...thS, textAlign: 'center' }}>Unit Rate</th>
                      <th colSpan={2} style={{ ...thS, textAlign: 'center' }}>Amount</th>
                    </tr>
                    <tr>
                      <th colSpan={4} style={thS}></th>
                      <th style={{ ...thS, fontSize: 11 }}>Supply</th>
                      <th style={{ ...thS, fontSize: 11 }}>Installation</th>
                      <th style={{ ...thS, fontSize: 11 }}>Supply</th>
                      <th style={{ ...thS, fontSize: 11 }}>Installation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Section A: Equipment */}
                    {eqItems.length > 0 && (
                      <>
                        <tr><td colSpan={8} style={{ ...tds, fontWeight: 'bold', background: '#f9f9f9' }}>Section A : Equipment</td></tr>
                        {eqItems.map((item, i) => (
                          <tr key={`eq-${i}`}>
                            <td style={tds}>{item.sNo || i + 1}</td>
                            <td style={tds}>{item.description}</td>
                            <td style={tds}>{item.unit}</td>
                            <td style={tds}>{item.qty}</td>
                            <td style={tdsR}>{money(item.supplyRate)}</td>
                            <td style={tdsR}>{money(item.installationRate)}</td>
                            <td style={tdsR}>{money(item.supplyAmount)}</td>
                            <td style={tdsR}>{money(item.installationAmount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>Sub Total</td>
                          <td style={tdsR}>{money(q.equipmentSupplyTotal)}</td>
                          <td style={tdsR}>{money(q.equipmentInstallTotal)}</td>
                        </tr>
                        <tr style={{ background: '#e8e800' }}>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>TOTAL Equipment (Basic)</td>
                          <td colSpan={2} style={{ ...tdsR, fontWeight: 'bold' }}>{money(q.equipmentTotal)}</td>
                        </tr>
                        <tr style={{ background: '#e8e800' }}>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>TOTAL Equipment (With {q.gstPercent || 18}% GST)</td>
                          <td colSpan={2} style={{ ...tdsR, fontWeight: 'bold' }}>{money(Math.round(q.equipmentTotal * (1 + (q.gstPercent || 18) / 100)))}</td>
                        </tr>
                      </>
                    )}
                    {/* Section B: Accessories */}
                    {accItems.length > 0 && (
                      <>
                        <tr><td colSpan={8} style={{ ...tds, fontWeight: 'bold', background: '#f9f9f9' }}>Section B : Accessories</td></tr>
                        {accItems.map((item, i) => (
                          <tr key={`acc-${i}`}>
                            <td style={tds}>{item.sNo || i + 1}</td>
                            <td style={tds}>{item.description}</td>
                            <td style={tds}>{item.unit}</td>
                            <td style={tds}>{item.qty}</td>
                            <td style={tdsR}>{money(item.supplyRate)}</td>
                            <td style={tdsR}>{money(item.installationRate)}</td>
                            <td style={tdsR}>{money(item.supplyAmount)}</td>
                            <td style={tdsR}>{money(item.installationAmount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>Sub Total</td>
                          <td style={tdsR}>{money(q.accessoriesSupplyTotal)}</td>
                          <td style={tdsR}>{money(q.accessoriesInstallTotal)}</td>
                        </tr>
                        <tr style={{ background: '#e8e800' }}>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>TOTAL Accessories (Basic)</td>
                          <td colSpan={2} style={{ ...tdsR, fontWeight: 'bold' }}>{money(q.accessoriesTotal)}</td>
                        </tr>
                        <tr style={{ background: '#e8e800' }}>
                          <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold' }}>TOTAL Accessories (With {q.gstPercent || 18}% GST)</td>
                          <td colSpan={2} style={{ ...tdsR, fontWeight: 'bold' }}>{money(Math.round(q.accessoriesTotal * (1 + (q.gstPercent || 18) / 100)))}</td>
                        </tr>
                      </>
                    )}
                    {/* Grand Total */}
                    <tr style={{ background: '#e8e800' }}>
                      <td colSpan={6} style={{ ...tds, textAlign: 'right', fontWeight: 'bold', fontSize: 14 }}>GRAND TOTAL WITH GST</td>
                      <td colSpan={2} style={{ ...tdsR, fontWeight: 'bold', fontSize: 14 }}>{money(q.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

          </div>

          {/* ── PAGE 3: COMMERCIAL TERMS ── */}
          <div className="page-break" style={{ paddingTop: 16 }}>
            {renderHeader()}
            <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginBottom: 12 }}>COMMERCIAL TERMS AND CONDITIONS.</div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ ...tds, width: '30%', verticalAlign: 'top' }}>TAXES</td>
                  <td style={{ ...tds, fontWeight: 'bold' }}>As Shown Above.</td>
                </tr>
                <tr>
                  <td style={{ ...tds, verticalAlign: 'top' }}>Payment</td>
                  <td style={{ ...tds, whiteSpace: 'pre-wrap' }}>
                    {Array.isArray(q.paymentTerms) && q.paymentTerms.length > 0
                      ? q.paymentTerms.map((t, i) => (
                          <div key={i}>{t.percentage}% - {t.label}{t.wording ? ` — ${t.wording}` : ''}</div>
                        ))
                      : '100% Advance along with work order.'
                    }
                  </td>
                </tr>
                <tr>
                  <td style={{ ...tds, verticalAlign: 'top' }}>Offer Validity :</td>
                  <td style={tds}>{q.offerValidity || '15 days from the date of offer.'}</td>
                </tr>
                <tr>
                  <td style={{ ...tds, verticalAlign: 'top' }}>Delivery</td>
                  <td style={{ ...tds, whiteSpace: 'pre-wrap' }}>{q.delivery || ''}</td>
                </tr>
              </tbody>
            </table>

            {/* Bank Details */}
            <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginTop: 16, marginBottom: 8 }}>BANK DETAILS.</div>
            <div style={{ fontSize: 13 }}>
              <div>Bank : {cp.bankDetails?.bankName || ''}</div>
              <div>Account Holder Name : {cp.bankDetails?.accountHolderName || cp.displayName || cp.name || ''}</div>
              <div>Account Number: {cp.bankDetails?.accountNumber || ''}</div>
              <div>IFSC Code : {cp.bankDetails?.ifscCode || ''}</div>
            </div>

            {/* Excluded Works */}
            {(q.excludedWorks || []).length > 0 && (
              <>
                <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginTop: 16, marginBottom: 8 }}>EXCLUDED WORKS.</div>
                <div style={{ fontSize: 13 }}>
                  {q.excludedWorks.map((w, i) => (
                    <div key={i}>{i + 1}) {w}</div>
                  ))}
                </div>
              </>
            )}

            {q.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13 }}>{q.notes}</div>}
          </div>
        </div>
      </div>
    );
  }

  /* ── EDIT MODE ── */
  if (editing) {
    const editTotals = calcTotals(equipItems, accItems, form.gstPercent);
    return (
      <div className="enq-page">
        <h2>Edit Quotation — {q.quotationNumber}</h2>
        <form onSubmit={handleSave}>
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
          <EditLineItems items={equipItems} setItems={setEquipItems} label={form.division === 'Solar' ? 'Solar Equipment' : 'Equipment'} onAutocomplete={handleAutocomplete} isSolar={form.division === 'Solar'} />
          {/* Accessories (hidden for Solar — Solar uses flat table) */}
          {form.division !== 'Solar' && (
            <EditLineItems items={accItems} setItems={setAccItems} label="Accessories" onAutocomplete={handleAutocomplete} isSolar={false} />
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Quotation {q.quotationNumber}</h2>
          <span className={`status-badge ${statusClass(q.status)}`}>{q.status}</span>
          {q.revision > 0 && <span style={{ marginLeft: 8, color: '#888' }}>Rev {q.revision}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sec sm" onClick={openPreview}>Preview / Print</button>
          {canEdit && <button className="btn pri sm" onClick={() => { setEditing(true); api.get('/api/payment-term-templates?documentType=quotation').then(d => setPayTermTemplates(d.templates || [])).catch(() => {}); }}>Edit</button>}
          {canEdit && <button className="btn sec sm" onClick={handleDuplicate}>Duplicate</button>}
          {canEdit && (q.status === 'Draft' || q.status === 'Cancelled') && (
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
              {q.equipmentItems.map((item, i) => (
                <tr key={i}>
                  <td>{item.sNo || i + 1}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.qty}</td>
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
              {q.accessoriesItems.map((item, i) => (
                <tr key={i}><td>{item.sNo || i + 1}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.qty}</td>
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
          <div><strong>GST ({q.gstPercent || 18}%)</strong><br/>{money(q.gstAmount)}</div>
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

/* ── Inline line item editor (reused in edit mode) ── */
function EditLineItems({ items, setItems, label, onAutocomplete, isSolar }) {
  function setItemField(idx, key, value) {
    setItems(prev => { const c = [...prev]; c[idx] = { ...c[idx], [key]: value }; return c; });
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>{label} Items</h3>
        <button type="button" className="btn sec sm" onClick={() => setItems(prev => [...prev, { ...EMPTY_LINE, gstPercent: isSolar ? 18 : null }])}>+ Add Row</button>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th style={{ minWidth: 180 }}>Description</th>
              <th>Unit</th>
              <th>Qty</th>
              <th>Supply Rate</th>
              {!isSolar && <th>Install Rate</th>}
              {isSolar && <th>GST %</th>}
              <th style={{ textAlign: 'right' }}>Basic Amt</th>
              {isSolar && <th style={{ textAlign: 'right' }}>Amt with GST</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={isSolar ? 10 : 8} style={{ textAlign: 'center', color: '#888' }}>No items.</td></tr>
            ) : items.map((item, idx) => {
              const supplyAmt = (item.qty || 0) * (item.supplyRate || 0);
              const installAmt = (item.qty || 0) * (item.installationRate || 0);
              const basicAmt = isSolar ? supplyAmt : supplyAmt + installAmt;
              const gstPct = item.gstPercent != null ? item.gstPercent : 18;
              const amtWithGst = Math.round(basicAmt * (1 + gstPct / 100));
              return (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td><input value={item.description || ''} onChange={e => setItemField(idx, 'description', e.target.value)} style={{ width: '100%' }} /></td>
                  <td><input value={item.unit || ''} onChange={e => setItemField(idx, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                  <td><input type="number" value={item.qty || 0} onChange={e => setItemField(idx, 'qty', Number(e.target.value))} style={{ width: 60 }} /></td>
                  <td><input type="number" value={item.supplyRate || 0} onChange={e => setItemField(idx, 'supplyRate', Number(e.target.value))} style={{ width: 90 }} /></td>
                  {!isSolar && <td><input type="number" value={item.installationRate || 0} onChange={e => setItemField(idx, 'installationRate', Number(e.target.value))} style={{ width: 90 }} /></td>}
                  {isSolar && <td><input type="number" value={item.gstPercent != null ? item.gstPercent : ''} onChange={e => setItemField(idx, 'gstPercent', e.target.value === '' ? null : Number(e.target.value))} style={{ width: 70 }} placeholder="18" /></td>}
                  <td style={{ textAlign: 'right' }}>{money(basicAmt)}</td>
                  {isSolar && <td style={{ textAlign: 'right' }}>{money(amtWithGst)}</td>}
                  <td><button type="button" className="btn danger sm" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>&times;</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
