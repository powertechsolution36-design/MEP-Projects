import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiRequest } from '../../api/client';
import { money, fmtDate } from '../../utils/format';
import '../enquiries/enquiry.css';

/**
 * AMC Document Generation — generates a printable AMC document from a
 * contract + company profile + template.
 *
 * Three template types (section 33 source wording locked):
 *   - comprehensive
 *   - non-comprehensive
 *   - amc-letter
 *
 * API: GET /api/amc-documents/generate/:contractId/:templateType
 *      GET /api/amc-documents/templates
 *      GET /api/amc-documents/templates/:type
 *      PUT /api/amc-documents/templates (admin save)
 *
 * Navigation: /contracts/:id/amc-document?type=comprehensive
 */

const TEMPLATE_TYPES = [
  { value: 'comprehensive', label: 'Comprehensive AMC' },
  { value: 'non-comprehensive', label: 'Non-Comprehensive AMC' },
  { value: 'amc-letter', label: 'AMC Letter' },
];

export default function AmcDocument() {
  const { contractId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const printRef = useRef(null);

  const initialType = searchParams.get('type') || 'comprehensive';
  const [templateType, setTemplateType] = useState(initialType);
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Template editing
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [template, setTemplate] = useState(null);
  const [editSections, setEditSections] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    loadDocument();
  }, [contractId, templateType]);

  async function loadDocument() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/amc-documents/generate/${contractId}/${templateType}`);
      setDocument(data.document);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplate() {
    try {
      const data = await api.get(`/api/amc-documents/templates/${templateType}`);
      setTemplate(data.template);
      setEditSections((data.template?.sections || []).map(s => ({ ...s })));
      setShowTemplateEditor(true);
    } catch (err) { alert(err.message); }
  }

  async function saveTemplateChanges() {
    setSavingTemplate(true);
    try {
      await apiRequest('/api/amc-documents/templates', {
        method: 'PUT',
        body: {
          type: templateType,
          name: template?.name || `Custom ${templateType}`,
          sections: editSections,
        },
      });
      setShowTemplateEditor(false);
      loadDocument(); // Regenerate with updated template
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingTemplate(false);
    }
  }

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>AMC Document</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 13px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        h1 { font-size: 18px; text-align: center; border-bottom: 2px solid #1a4a7a; padding-bottom: 8px; }
        h2 { font-size: 14px; color: #1a4a7a; margin: 16px 0 6px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
        .company-name { font-size: 20px; font-weight: bold; color: #1a4a7a; }
        .section-content { white-space: pre-wrap; margin: 4px 0 12px; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; }
        .stamp-block { text-align: center; }
        .stamp-block img { max-width: 120px; max-height: 60px; }
        .page-break { page-break-before: always; break-before: page; }
        @media print { body { padding: 0; } @page { margin: 15mm; } }
      </style>
    </head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  if (loading) return <div className="enq-page"><p>Generating AMC document…</p></div>;
  if (error) return (
    <div className="enq-page">
      <p className="error">{error}</p>
      <button className="btn sec" onClick={() => navigate(`/contracts/${contractId}`)}>Back to Contract</button>
    </div>
  );
  if (!document) return <div className="enq-page"><p>No document generated.</p></div>;

  const doc = document;
  const cp = doc.company || {};
  const contract = doc.contract || {};
  const sections = (doc.template?.sections || []);
  const secByKey = {};
  sections.forEach(s => { secByKey[s.key] = s; });

  function renderHeader() {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          {cp.logoBase64 && <img src={cp.logoBase64} alt="Logo" style={{ maxHeight: 50, marginBottom: 4 }} />}
          <div style={{ fontSize: 12, color: '#666' }}>{cp.tagline || '"Trusted-Econimical-Reliable"'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1a4a7a' }}>{cp.name || 'Company Name'}</div>
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

  function renderFooter() {
    return (
      <div style={{ marginTop: 40 }}>
        <div>Yours truly,</div>
        <div style={{ fontWeight: 'bold' }}>For {cp.name || 'Company'}</div>
        <div style={{ marginTop: 8 }}>
          {cp.authorizedPerson?.signatureBase64 && <div><img src={cp.authorizedPerson.signatureBase64} alt="Signature" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
          {cp.authorizedPerson?.stampBase64 && <div><img src={cp.authorizedPerson.stampBase64} alt="Stamp" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
          <div style={{ fontWeight: 600 }}>{cp.authorizedPerson?.name || ''}</div>
          {cp.phone && <div style={{ fontSize: 12 }}>Mob: {cp.phone}</div>}
        </div>
      </div>
    );
  }

  function renderAmcContract(doc, cp, contract, type) {
    const label = type === 'comprehensive' ? 'Comprehensive' : 'Non-Comprehensive';
    return (
      <>
        {/* ── PAGE 1: SUMMARY ── */}
        {renderHeader()}
        <div style={{ textAlign: 'center', background: '#e8e800', fontWeight: 'bold', padding: 4, marginBottom: 12 }}>SUMMARY</div>
        <div style={{ marginBottom: 8 }}><strong>Quote To -</strong> {contract.customer || '—'}</div>
        <div style={{ marginBottom: 12 }}><strong>{secByKey['subject']?.content || `SUB:- ${label} Maintenance Contract for your Air Conditioning System.`}</strong></div>

        {/* Intro */}
        <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{secByKey['introduction']?.content || ''}</div>

        {/* Contract description */}
        <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{secByKey['contract_description']?.content || ''}</div>

        {renderFooter()}

        {/* ── PAGE 2: PRICING + SERVICE TERMS ── */}
        <div style={{ borderTop: '3px solid #1a4a7a', marginTop: 30, paddingTop: 16 }}>
          {renderHeader()}
          <div style={{ textAlign: 'center', background: '#e8e800', fontWeight: 'bold', padding: 4, marginBottom: 12 }}>SUPPLY &amp; INSTALLATION OF HVAC SYSTEM</div>

          {/* Pricing table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', margin: '10px 0' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5' }}>S No</th>
                <th style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5' }}>Description</th>
                <th style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5' }}>Unit</th>
                <th style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5' }}>Qty</th>
                <th colSpan={2} style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5', textAlign: 'center' }}>Unit Rate</th>
                <th colSpan={2} style={{ border: '1px solid #ccc', padding: '6px 8px', background: '#f5f5f5', textAlign: 'center' }}>Amount</th>
              </tr>
              <tr>
                <th colSpan={4} style={{ border: '1px solid #ccc', padding: '4px' }}></th>
                <th style={{ border: '1px solid #ccc', padding: '4px', fontSize: 11 }}>Supply</th>
                <th style={{ border: '1px solid #ccc', padding: '4px', fontSize: 11 }}>Installation</th>
                <th style={{ border: '1px solid #ccc', padding: '4px', fontSize: 11 }}>Supply</th>
                <th style={{ border: '1px solid #ccc', padding: '4px', fontSize: 11 }}>Installation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>1</td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>{label} Maintenance Contract{contract.capacity ? ` for ${contract.capacity}` : ''}{contract.site ? ` - ${contract.site}` : ''}</td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>Lot</td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px' }}>1</td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}></td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}>{money(contract.amount)}</td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}></td>
                <td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}>{money(contract.amount)}</td>
              </tr>
              <tr><td colSpan={4} style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>Sub Total</td><td colSpan={2}></td><td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}></td><td style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right' }}>{money(contract.amount)}</td></tr>
              <tr style={{ background: '#e8e800' }}><td colSpan={6} style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>TOTAL (Basic)</td><td colSpan={2} style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>{money(contract.amount)}</td></tr>
              <tr style={{ background: '#e8e800' }}><td colSpan={6} style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>TOTAL (With 18% GST)</td><td colSpan={2} style={{ border: '1px solid #ccc', padding: '6px 8px', textAlign: 'right', fontWeight: 'bold' }}>{money(Math.round(contract.amount * 1.18))}</td></tr>
            </tbody>
          </table>

          {/* SPMS terms */}
          <div style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{secByKey['spms_heading']?.content || ''}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 4 }}><strong>1)</strong> {secByKey['service_coverage']?.content || ''}</div>
            <div style={{ marginBottom: 4 }}><strong>2)</strong> {secByKey['spare_policy']?.content || ''}</div>
            {secByKey['electrical_fluctuation'] && <div style={{ marginBottom: 4 }}><strong>3)</strong> {secByKey['electrical_fluctuation'].content}</div>}
            <div style={{ marginBottom: 4 }}><strong>{secByKey['electrical_fluctuation'] ? '4' : '3'})</strong> {secByKey['complaint_response']?.content || ''}</div>
            <div style={{ marginBottom: 4 }}><strong>{secByKey['electrical_fluctuation'] ? '5' : '4'})</strong> The routine servicing will cover the following:</div>
            <div style={{ paddingLeft: 20, whiteSpace: 'pre-wrap' }}>{secByKey['routine_servicing']?.content || ''}</div>
          </div>

          {renderFooter()}
        </div>

        {/* ── PAGE 3: COMMERCIAL TERMS ── */}
        <div style={{ borderTop: '3px solid #1a4a7a', marginTop: 30, paddingTop: 16 }}>
          {renderHeader()}
          <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginBottom: 12 }}>COMMERCIAL TERMS AND CONDITIONS.</div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td style={{ border: '1px solid #ccc', padding: '8px', width: '30%', verticalAlign: 'top' }}>TAXES</td><td style={{ border: '1px solid #ccc', padding: '8px', fontWeight: 'bold' }}>{secByKey['taxes']?.content || 'GST as shown'}</td></tr>
              <tr><td style={{ border: '1px solid #ccc', padding: '8px', verticalAlign: 'top' }}>Payment</td><td style={{ border: '1px solid #ccc', padding: '8px', whiteSpace: 'pre-wrap' }}>{secByKey['payment']?.content || ''}{contract.amount ? `\n\n₹ ${money(Math.round(contract.amount * 1.18))}` : ''}</td></tr>
              <tr><td style={{ border: '1px solid #ccc', padding: '8px', verticalAlign: 'top' }}>Offer Validity :</td><td style={{ border: '1px solid #ccc', padding: '8px' }}>{secByKey['offer_validity']?.content || '30 days'}</td></tr>
              <tr><td style={{ border: '1px solid #ccc', padding: '8px', verticalAlign: 'top' }}>Delivery</td><td style={{ border: '1px solid #ccc', padding: '8px', whiteSpace: 'pre-wrap' }}>{secByKey['delivery']?.content || ''}</td></tr>
              <tr><td style={{ border: '1px solid #ccc', padding: '8px', verticalAlign: 'top' }}>Final Billing</td><td style={{ border: '1px solid #ccc', padding: '8px', whiteSpace: 'pre-wrap' }}>{secByKey['final_billing']?.content || ''}</td></tr>
            </tbody>
          </table>

          {/* Bank Details */}
          <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginTop: 16, marginBottom: 8 }}>BANK DETAILS.</div>
          <div style={{ fontSize: 13 }}>
            <div>Bank : {cp.bankDetails?.bankName || ''}</div>
            <div>Account Holder Name : {cp.bankDetails?.accountHolderName || cp.name || ''}</div>
            <div>Account Number: {cp.bankDetails?.accountNumber || ''}</div>
            <div>IFSC Code : {cp.bankDetails?.ifscCode || ''}</div>
          </div>

          {/* Excluded Works */}
          <div style={{ background: '#00b050', color: '#fff', fontWeight: 'bold', padding: '4px 8px', marginTop: 16, marginBottom: 8 }}>EXCLUDED WORKS.</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {secByKey['excluded_works']?.content || ''}
          </div>
        </div>
      </>
    );
  }

  function renderAmcLetter(doc, cp, contract) {
    return (
      <>
        {/* AMC Letter — single page letter format per reference */}
        <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>AMC LETTER</div>

        <div style={{ marginBottom: 8 }}>{secByKey['salutation']?.content || 'Dear Sir/ Madam,'}</div>
        <div style={{ marginBottom: 4, fontWeight: 'bold' }}>{contract.customer || '—'},</div>
        <div style={{ marginBottom: 12 }}>{contract.site || ''}</div>

        <div style={{ marginBottom: 12 }}>{secByKey['acknowledgement']?.content || ''}</div>

        {/* Contract reference paragraph with dynamic values */}
        <div style={{ marginBottom: 12 }}>
          {(secByKey['proposal']?.content || '')
            .replace('{{contractAmount}}', money(contract.amount))
            .replace('{{contractPeriod}}', `${contract.visitsPerYear ? Math.ceil(12 / contract.visitsPerYear) : 1} Year${contract.visitsPerYear && Math.ceil(12 / contract.visitsPerYear) > 1 ? 's' : ''}`)
            .replace('{{startDate}}', fmtDate(contract.startDate))
            .replace('{{endDate}}', fmtDate(contract.endDate))
          }
        </div>

        <div style={{ marginBottom: 12 }}>{secByKey['terms_intro']?.content || 'Please keep in mind following T&C during AMC.'}</div>

        {/* T&C as numbered list */}
        <ul style={{ listStyleType: 'disc', paddingLeft: 24, lineHeight: 1.8 }}>
          <li>{secByKey['routine_service_frequency']?.content || ''}</li>
          <li>{secByKey['spare_inclusion']?.content || ''}</li>
          <li>{secByKey['n_service']?.content || ''}</li>
          <li>{secByKey['routine_servicing_intro']?.content || 'The routine servicing will cover the following:'}</li>
          <li>{secByKey['service_quality']?.content || ''}</li>
          <li>{secByKey['n_service_vrf']?.content || ''}</li>
        </ul>

        {/* Servicing detail items */}
        <ul style={{ listStyleType: 'disc', paddingLeft: 40, lineHeight: 1.8 }}>
          {(secByKey['routine_service_points']?.content || '').split('\n').map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>

        {/* Exclusions and conditions */}
        <ul style={{ listStyleType: 'disc', paddingLeft: 24, lineHeight: 1.8 }}>
          <li>{secByKey['system_shutdown']?.content || ''}</li>
          <li>{secByKey['outdoor_access']?.content || ''}</li>
          <li>{secByKey['electrical_notification']?.content || ''}</li>
          <li>{secByKey['electrical_exclusion']?.content || ''}</li>
          <li>{secByKey['storage_requirement']?.content || ''}</li>
          <li>{secByKey['structural_exclusion']?.content || ''}</li>
          <li>{secByKey['natural_disaster_exclusion']?.content || ''}</li>
          <li>{secByKey['civil_work_exclusion']?.content || ''}</li>
          <li>{secByKey['ladder_requirement']?.content || ''}</li>
        </ul>

        {/* Payment Terms */}
        <div style={{ marginTop: 16 }}>
          <strong>Payment Terms – </strong>
          <div>{secByKey['payment_terms']?.content || '100% Advance along with work order .'}</div>
        </div>

        {/* Please Note */}
        <div style={{ marginTop: 12 }}>
          <strong>Please Note – </strong>
          <div>{secByKey['please_note']?.content || ''}</div>
        </div>

        {/* Contact details */}
        <div style={{ marginTop: 20 }}>
          <div>Our contact details for your reference –</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>{cp.authorizedPerson?.name || ''}</div>
              <div style={{ fontSize: 12 }}>{cp.authorizedPerson?.designation || '(Project & Service head)'}</div>
              <div style={{ fontSize: 12 }}>{cp.phone || ''}{cp.email ? ` / ${cp.email}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 'bold' }}>{cp.name || ''}</div>
              <div style={{ fontSize: 12 }}>(Complaint Registration at)</div>
              <div style={{ fontSize: 12 }}>Office - {cp.phone || ''}</div>
            </div>
          </div>
        </div>

        {/* Sign & Stamp */}
        <div style={{ marginTop: 30 }}>
          <div style={{ fontWeight: 'bold' }}>Sign & Stamp –</div>
          <div style={{ marginTop: 8 }}>
            {cp.authorizedPerson?.signatureBase64 && <div><img src={cp.authorizedPerson.signatureBase64} alt="Signature" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
            {cp.authorizedPerson?.stampBase64 && <div><img src={cp.authorizedPerson.stampBase64} alt="Stamp" style={{ maxWidth: 120, maxHeight: 60 }} /></div>}
          </div>
        </div>
      </>
    );
  }

  /* ── TEMPLATE EDITOR ── */
  if (showTemplateEditor) {
    return (
      <div className="enq-page">
        <h2>Edit Template — {TEMPLATE_TYPES.find(t => t.value === templateType)?.label}</h2>
        <p style={{ color: '#888', fontSize: 13 }}>Edit the template sections below. Changes are saved as a company-level override (the system default is preserved).</p>
        {editSections.map((sec, idx) => (
          <div key={idx} className="panel" style={{ marginTop: 12 }}>
            <div className="form-grid">
              <label className="filter-field">
                Section Title
                <input value={sec.title || ''} onChange={e => {
                  const c = [...editSections]; c[idx] = { ...c[idx], title: e.target.value }; setEditSections(c);
                }} />
              </label>
              <label className="filter-field">
                Key
                <input value={sec.key || ''} disabled style={{ background: '#f5f5f5' }} />
              </label>
            </div>
            <label className="filter-field" style={{ marginTop: 8 }}>
              Content
              <textarea rows={5} value={sec.content || ''} onChange={e => {
                const c = [...editSections]; c[idx] = { ...c[idx], content: e.target.value }; setEditSections(c);
              }} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
            </label>
          </div>
        ))}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn pri" onClick={saveTemplateChanges} disabled={savingTemplate}>
            {savingTemplate ? 'Saving…' : 'Save Template'}
          </button>
          <button className="btn sec" onClick={() => setShowTemplateEditor(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  /* ── DOCUMENT PREVIEW ── */
  return (
    <div className="enq-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>AMC Document</h2>
          <select value={templateType} onChange={e => setTemplateType(e.target.value)} style={{ marginLeft: 8 }}>
            {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" onClick={handlePrint}>Print / Save as PDF</button>
          <button className="btn sec sm" onClick={loadTemplate}>Edit Template</button>
          <button className="btn sec sm" onClick={() => navigate(`/contracts/${contractId}`)}>Back to Contract</button>
        </div>
      </div>

      {/* Preview — structured to match reference document layout */}
      <div ref={printRef} style={{ background: '#fff', padding: 24, border: '1px solid #ddd', maxWidth: 800, margin: '0 auto' }}>
        {templateType === 'amc-letter' ? renderAmcLetter(doc, cp, contract) : renderAmcContract(doc, cp, contract, templateType)}
      </div>
    </div>
  );
}
