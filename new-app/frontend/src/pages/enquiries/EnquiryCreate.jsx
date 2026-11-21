import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import useMyDivisions from '../../hooks/useMyDivisions';
import ContactsField from '../../components/ContactsField';
import ClientSelect from '../../components/ClientSelect';
import ContactPick from '../../components/ContactPick';

/**
 * New Enquiry form — PWA `mEnq()` exact reproduction.
 *
 * PWA fields: name, siteType (select), capacity, segment (select: HVAC/Solar/MEP/AMC),
 *   phone, referenceSource, rating (1-5), estimatedValue, remark
 * PWA validation: name required, segment required.
 * PWA FACT: only `sales` can create (enforced server-side + button visibility).
 */

const SITE_TYPES = ['Residential', 'Commercial', 'Factory', 'Banquet Hall', 'Hospital', 'Office'];

export default function EnquiryCreate() {
  const SEGMENTS = [...useMyDivisions(), 'AMC']; // PWA mEnq: myDivs().concat(["AMC"])
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    // PWA FACT (mEnq, index.html:1914): Site Type is a select with no blank
    // option, so it always submits a value (first option, Residential).
    name: '', siteType: 'Residential', capacity: '', segment: '',
    phone: '', referenceSource: '', rating: '3', estimatedValue: '', remark: '', // PWA default rating 3
    // Owner request (5 Nov 2026): the other people at the site.
    contacts: [],
  });
  // The client whose people the picker offers, and which of them the main
  // number belongs to. Neither is saved: the enquiry keeps the number in
  // `phone` and everyone in `contacts`, exactly as it always has.
  const [pickedClient, setPickedClient] = useState(null);

  /**
   * A person picked from the client drops into the first empty contact row,
   * or a new row when they are all taken. Somebody already on the list is
   * not added twice, and nothing typed is overwritten.
   */
  function useClientContact(person) {
    if (!person) return;
    setForm((prev) => {
      const rows = Array.isArray(prev.contacts) ? [...prev.contacts] : [];
      const already = rows.some(
        (r) => String(r.name || '').trim() === person.name && String(r.phone || '').trim() === person.phone
      );
      if (already) return prev;
      const next = { name: person.name, designation: person.designation || '', phone: person.phone || '' };
      const slot = rows.findIndex((r) => !String(r.name || '').trim() && !String(r.phone || '').trim());
      if (slot === -1) rows.push(next);
      else rows[slot] = { ...rows[slot], ...next };
      // The lead's own number follows the main person when none was typed.
      const phone = prev.phone || (person.main ? person.phone : '') || prev.phone;
      return { ...prev, contacts: rows, phone };
    });
  }
  const [picked, setPicked] = useState(null);

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
            {/* Owner request (16 Nov 2026): pick a client we already have
                and their details come with them. A name that is not on the
                list is simply typed, and joins the list on save. */}
            <ClientSelect
              label="Project Name"
              required
              value={form.name}
              onType={(v) => setField('name', v)}
              onPick={(c) => {
                setPickedClient(c);
                setPicked(null);
                setForm((f) => ({
                  ...f,
                  name: c.companyName || c.clientName || f.name,
                  phone: f.phone || c.phone || '',
                  contacts: (f.contacts || []).some((r) => r.name) ? f.contacts : (c.contacts || []),
                }));
              }}
            />
            {/* Owner request (17 Nov 2026): whose number is the one to ring.
                Everyone at the client is already copied into Contacts below;
                this says which of them the main number belongs to. */}
            <ContactPick
              client={pickedClient}
              picked={picked}
              onPick={(person) => {
                setPicked(person);
                if (!person) return;
                setForm((f) => ({
                  ...f,
                  phone: person.phone || f.phone,
                  contacts: (f.contacts || []).some(
                    (r) => (r.name || '') === person.name && (r.phone || '') === person.phone
                  ) ? f.contacts : [...(f.contacts || []), {
                    name: person.name, designation: person.designation, phone: person.phone,
                  }].slice(0, 10),
                }));
              }}
              label="Whose number is this?"
            />
            <div className="filter-field">
              <label>Site Type</label>
              <select value={form.siteType} onChange={e => setField('siteType', e.target.value)}>
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
          {/* Owner request (21 Nov 2026): "need dropdown for contract from
              saved client like project have a dropdown." Once a saved
              client is picked above, their people are offered here the way
              the sales order and quotation forms already offer them —
              picked into the first empty row, and still editable. */}
          <ContactPick
            client={pickedClient}
            picked={null}
            onPick={useClientContact}
            label="Add a person from this client"
          />
          <ContactsField
            value={form.contacts}
            onChange={(contacts) => setField('contacts', contacts)}
            label="Contacts at this site"
          />

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
