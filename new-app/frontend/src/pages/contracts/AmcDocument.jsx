import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiRequest, getStoredToken, assertDownloadOk } from '../../api/client';
import { money, fmtDate } from '../../utils/format';

/**
 * AMC Document Generation — generates a printable AMC document from a
 * contract + company profile + template.
 *
 * Three template types (section 33 source wording locked):
 *   - comprehensive
 *   - non-comprehensive
 *   - amc-letter
 *
 * The document itself is built on the server and opened as a PDF — the same
 * one the client receives. The page shows what it will be made from and the
 * template that supplies its wording; it does not draw the document itself
 * (owner decision, 24 Oct 2026).
 *
 * API: GET /api/amc-documents/generate/:contractId/:templateType/pdf
 *      GET /api/amc-documents/generate/:contractId/:templateType
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
  const [opening, setOpening] = useState(false);

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

  /**
   * Open the AMC document (owner decision, 24 Oct 2026).
   *
   * This page used to print by writing its own HTML and stylesheet into a
   * pop-up, so the preview on screen, the printed page and the copy the
   * client received were three different layouts — and none matched the
   * company's own sheets. There is now one document, built on the server;
   * viewing, printing and saving all come from it.
   */
  async function openDocument() {
    setOpening(true);
    setError(null);
    try {
      const resp = await fetch(`/api/amc-documents/generate/${contractId}/${templateType}/pdf`, {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      await assertDownloadOk(resp); // a refused document must not be saved as a "PDF"
      const url = URL.createObjectURL(await resp.blob());
      const win = window.open(url, '_blank');
      if (!win) {
        // Pop-ups are refused inside the Android app and by some browsers:
        // hand the file over as a download instead of doing nothing.
        const a = window.document.createElement('a');
        a.href = url;
        a.download = `${templateType}-amc.pdf`;
        window.document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || 'Could not open the AMC document.');
    } finally {
      setOpening(false);
    }
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
  const contract = doc.contract || {};

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn pri" onClick={openDocument} disabled={opening}>{opening ? 'Preparing…' : 'Preview / Print'}</button>
          <button className="btn sec sm" onClick={loadTemplate}>Edit Template</button>
          <button className="btn sec sm" onClick={() => navigate(`/contracts/${contractId}`)}>Back to Contract</button>
        </div>
      </div>

      {/* One document: the server-built PDF, which is also what the client
          gets. The summary below is just what it will be made from. */}
      <div className="panel" style={{ maxWidth: 800, margin: '0 auto' }}>
        <h3 style={{ marginTop: 0 }}>{TEMPLATE_TYPES.find(t => t.value === templateType)?.label}</h3>
        <div className="detail-grid">
          <div><strong>Client</strong><br />{contract.customer || '—'}</div>
          <div><strong>Site</strong><br />{contract.site || '—'}</div>
          <div><strong>Capacity</strong><br />{contract.capacity || '—'}</div>
          <div><strong>Cover</strong><br />{contract.category || '—'} · {contract.amcType || '—'}</div>
          <div><strong>Period</strong><br />{fmtDate(contract.startDate)} – {fmtDate(contract.endDate)}</div>
          <div><strong>Amount</strong><br />{money(contract.amount)}</div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Open the document to read, print or save it. The wording comes from this
          company&apos;s AMC template — use <strong>Edit Template</strong> to change it.
        </p>
        <div className="detail-actions">
          <button className="btn pri" onClick={openDocument} disabled={opening}>
            {opening ? 'Preparing…' : 'Preview / Print'}
          </button>
        </div>
      </div>
    </div>
  );
}
