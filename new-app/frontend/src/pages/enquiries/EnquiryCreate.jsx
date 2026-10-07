import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import './enquiry.css';

/**
 * New Enquiry form — PWA `mEnq()` exact reproduction.
 *
 * PWA fields: name, siteType (select), capacity, segment (select: HVAC/Solar/MEP/AMC),
 *   phone, referenceSource, rating (1-5), estimatedValue, remark
 * PWA validation: name required, segment required.
 * PWA FACT: only `sales` can create (enforced server-side + button visibility).
 */

const SITE_TYPES = ['Residential', 'Commercial', 'Factory', 'Banquet Hall', 'Hospital', 'Office'];
const SEGMENTS = ['HVAC', 'Solar', 'MEP', 'AMC'];

export default function EnquiryCreate() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '', siteType: '', capacity: '', segment: '',
    phone: '', referenceSource: '', rating: '', estimatedValue: '', remark: '',
  });

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) { alert('Project name is required.'); return; }
    if (!form.segment) { alert('Segment is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        rating: form.rating ? Number(form.rating) : undefined,
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
      };
      const data = await api.post('/api/enquiries', payload);
      navigate(`/enquiries/${data.enquiry.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="enq-page">
      <button className="btn sec sm" onClick={() => navigate('/enquiries')}>&larr; Back</button>
      <div className="panel">
        <h2>New Enquiry</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="filter-field">
              <label>Project Name *</label>
              <input value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Site Type</label>
              <select value={form.siteType} onChange={e => setField('siteType', e.target.value)}>
                <option value="">—</option>
                {SITE_TYPES.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Capacity</label>
              <input value={form.capacity} onChange={e => setField('capacity', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Segment *</label>
              <select value={form.segment} onChange={e => setField('segment', e.target.value)}>
                <option value="">— select —</option>
                {SEGMENTS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Customer Phone</label>
              <input value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Reference</label>
              <input value={form.referenceSource} onChange={e => setField('referenceSource', e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Rating (1-5)</label>
              <select value={form.rating} onChange={e => setField('rating', e.target.value)}>
                <option value="">—</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Estimated Value</label>
              <input type="number" value={form.estimatedValue} onChange={e => setField('estimatedValue', e.target.value)} />
            </div>
          </div>
          <div className="filter-field">
            <label>Remark</label>
            <textarea value={form.remark} onChange={e => setField('remark', e.target.value)} rows={3} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn sec sm" onClick={() => navigate('/enquiries')}>Cancel</button>
            <button type="submit" className="btn pri sm" disabled={busy}>Save Enquiry</button>
          </div>
        </form>
      </div>
    </div>
  );
}
