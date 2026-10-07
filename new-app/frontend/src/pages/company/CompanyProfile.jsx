import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import '../enquiries/enquiry.css';

/**
 * Company Profile — admin-only page to view/edit company profile fields
 * used in document generation (quotations, AMC docs, etc.).
 *
 * API: GET /api/companies/my-profile, PATCH /api/companies/my-profile
 * Profile fields: displayName, subtitle, tagline, phone, email, website,
 *   gstNumber, logoBase64, bankDetails, authorizedPerson, quotationPrefix
 */
export default function CompanyProfile() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Form state
  const [form, setForm] = useState({
    displayName: '', subtitle: '', tagline: '',
    phone: '', email: '', website: '', gstNumber: '',
    logoBase64: '',
    bankDetails: { bankName: '', accountNumber: '', ifscCode: '', branch: '', accountType: 'Current' },
    authorizedPerson: { name: '', designation: '', signatureBase64: '', stampBase64: '', contactPhone: '', contactEmail: '' },
    quotationPrefix: 'QTN',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/companies/my-profile');
      const c = data.company || {};
      setCompany(c);
      setForm({
        displayName: c.displayName || '',
        subtitle: c.subtitle || '',
        tagline: c.tagline || '',
        phone: c.phone || '',
        email: c.email || '',
        website: c.website || '',
        gstNumber: c.gstNumber || '',
        logoBase64: c.logoBase64 || '',
        bankDetails: {
          bankName: c.bankDetails?.bankName || '',
          accountNumber: c.bankDetails?.accountNumber || '',
          ifscCode: c.bankDetails?.ifscCode || '',
          branch: c.bankDetails?.branch || '',
          accountType: c.bankDetails?.accountType || 'Current',
        },
        authorizedPerson: {
          name: c.authorizedPerson?.name || '',
          designation: c.authorizedPerson?.designation || '',
          signatureBase64: c.authorizedPerson?.signatureBase64 || '',
          stampBase64: c.authorizedPerson?.stampBase64 || '',
          contactPhone: c.authorizedPerson?.contactPhone || '',
          contactEmail: c.authorizedPerson?.contactEmail || '',
        },
        quotationPrefix: c.quotationPrefix || 'QTN',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }
  function setBankField(key, value) {
    setForm(prev => ({ ...prev, bankDetails: { ...prev.bankDetails, [key]: value } }));
  }
  function setAuthPersonField(key, value) {
    setForm(prev => ({ ...prev, authorizedPerson: { ...prev.authorizedPerson, [key]: value } }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api.patch('/api/companies/my-profile', form);
      setCompany(data.company);
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleFileUpload(field, setter) {
    return (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 500 * 1024) { alert('File must be under 500 KB.'); return; }
      const reader = new FileReader();
      reader.onload = () => setter(field, reader.result);
      reader.readAsDataURL(file);
    };
  }

  if (loading) return <div className="enq-page"><p>Loading company profile…</p></div>;
  if (error) return <div className="enq-page"><p className="error">{error}</p></div>;

  return (
    <div className="enq-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Company Profile</h2>
        {isAdmin && !editing && (
          <button className="btn pri" onClick={() => setEditing(true)}>Edit Profile</button>
        )}
      </div>

      {!editing ? (
        /* ── READ-ONLY VIEW ── */
        <div>
          <div className="panel">
            <h3>Basic Information</h3>
            <div className="detail-grid">
              <div><strong>Company Name</strong><br/>{company?.name || '—'}</div>
              <div><strong>Display Name</strong><br/>{company?.displayName || '—'}</div>
              <div><strong>Subtitle</strong><br/>{company?.subtitle || '—'}</div>
              <div><strong>Tagline</strong><br/>{company?.tagline || '—'}</div>
              <div><strong>Phone</strong><br/>{company?.phone || '—'}</div>
              <div><strong>Email</strong><br/>{company?.email || '—'}</div>
              <div><strong>Website</strong><br/>{company?.website || '—'}</div>
              <div><strong>GST Number</strong><br/>{company?.gstNumber || '—'}</div>
              <div><strong>Quotation Prefix</strong><br/>{company?.quotationPrefix || 'QTN'}</div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Bank Details</h3>
            <div className="detail-grid">
              <div><strong>Bank Name</strong><br/>{company?.bankDetails?.bankName || '—'}</div>
              <div><strong>Account Number</strong><br/>{company?.bankDetails?.accountNumber || '—'}</div>
              <div><strong>IFSC Code</strong><br/>{company?.bankDetails?.ifscCode || '—'}</div>
              <div><strong>Branch</strong><br/>{company?.bankDetails?.branch || '—'}</div>
              <div><strong>Account Type</strong><br/>{company?.bankDetails?.accountType || '—'}</div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Authorized Person</h3>
            <div className="detail-grid">
              <div><strong>Name</strong><br/>{company?.authorizedPerson?.name || '—'}</div>
              <div><strong>Designation</strong><br/>{company?.authorizedPerson?.designation || '—'}</div>
              <div><strong>Contact Phone</strong><br/>{company?.authorizedPerson?.contactPhone || '—'}</div>
              <div><strong>Contact Email</strong><br/>{company?.authorizedPerson?.contactEmail || '—'}</div>
            </div>
          </div>

          {company?.logoBase64 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>Company Logo</h3>
              <img src={company.logoBase64} alt="Company Logo" style={{ maxWidth: 200, maxHeight: 100 }} />
            </div>
          )}
        </div>
      ) : (
        /* ── EDIT FORM ── */
        <form onSubmit={handleSave}>
          <div className="panel">
            <h3>Basic Information</h3>
            <div className="form-grid">
              <label className="filter-field">
                Display Name
                <input value={form.displayName} onChange={e => setField('displayName', e.target.value)} />
              </label>
              <label className="filter-field">
                Subtitle
                <input value={form.subtitle} onChange={e => setField('subtitle', e.target.value)} />
              </label>
              <label className="filter-field">
                Tagline
                <input value={form.tagline} onChange={e => setField('tagline', e.target.value)} />
              </label>
              <label className="filter-field">
                Phone
                <input value={form.phone} onChange={e => setField('phone', e.target.value)} />
              </label>
              <label className="filter-field">
                Email
                <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} />
              </label>
              <label className="filter-field">
                Website
                <input value={form.website} onChange={e => setField('website', e.target.value)} />
              </label>
              <label className="filter-field">
                GST Number
                <input value={form.gstNumber} onChange={e => setField('gstNumber', e.target.value)} />
              </label>
              <label className="filter-field">
                Quotation Prefix
                <input value={form.quotationPrefix} onChange={e => setField('quotationPrefix', e.target.value)}
                  placeholder="QTN" maxLength={10} />
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Bank Details</h3>
            <div className="form-grid">
              <label className="filter-field">
                Bank Name
                <input value={form.bankDetails.bankName} onChange={e => setBankField('bankName', e.target.value)} />
              </label>
              <label className="filter-field">
                Account Number
                <input value={form.bankDetails.accountNumber} onChange={e => setBankField('accountNumber', e.target.value)} />
              </label>
              <label className="filter-field">
                IFSC Code
                <input value={form.bankDetails.ifscCode} onChange={e => setBankField('ifscCode', e.target.value)} />
              </label>
              <label className="filter-field">
                Branch
                <input value={form.bankDetails.branch} onChange={e => setBankField('branch', e.target.value)} />
              </label>
              <label className="filter-field">
                Account Type
                <select value={form.bankDetails.accountType} onChange={e => setBankField('accountType', e.target.value)}>
                  <option value="Current">Current</option>
                  <option value="Savings">Savings</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Authorized Person</h3>
            <div className="form-grid">
              <label className="filter-field">
                Name
                <input value={form.authorizedPerson.name} onChange={e => setAuthPersonField('name', e.target.value)} />
              </label>
              <label className="filter-field">
                Designation
                <input value={form.authorizedPerson.designation} onChange={e => setAuthPersonField('designation', e.target.value)} />
              </label>
              <label className="filter-field">
                Contact Phone
                <input value={form.authorizedPerson.contactPhone} onChange={e => setAuthPersonField('contactPhone', e.target.value)} />
              </label>
              <label className="filter-field">
                Contact Email
                <input type="email" value={form.authorizedPerson.contactEmail} onChange={e => setAuthPersonField('contactEmail', e.target.value)} />
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Images</h3>
            <div className="form-grid">
              <label className="filter-field">
                Company Logo (max 500 KB)
                <input type="file" accept="image/*" onChange={handleFileUpload('logoBase64', setField)} />
                {form.logoBase64 && <img src={form.logoBase64} alt="Preview" style={{ maxWidth: 150, maxHeight: 60, marginTop: 4 }} />}
              </label>
              <label className="filter-field">
                Authorized Signature (max 500 KB)
                <input type="file" accept="image/*" onChange={handleFileUpload('signatureBase64', setAuthPersonField)} />
                {form.authorizedPerson.signatureBase64 && <img src={form.authorizedPerson.signatureBase64} alt="Sig preview" style={{ maxWidth: 150, maxHeight: 60, marginTop: 4 }} />}
              </label>
              <label className="filter-field">
                Company Stamp (max 500 KB)
                <input type="file" accept="image/*" onChange={handleFileUpload('stampBase64', setAuthPersonField)} />
                {form.authorizedPerson.stampBase64 && <img src={form.authorizedPerson.stampBase64} alt="Stamp preview" style={{ maxWidth: 150, maxHeight: 60, marginTop: 4 }} />}
              </label>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="submit" className="btn pri" disabled={busy}>
              {busy ? 'Saving…' : 'Save Profile'}
            </button>
            <button type="button" className="btn sec" onClick={() => { setEditing(false); load(); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
