import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import ReportDownload from '../components/ReportDownload';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { new: 'blu', contacted: 'amb', quoted: 'blu', won: 'grn', lost: 'red' };

export default function Enquiries() {
  const enquiries = useStore(s => s.enquiries);
  const user = useStore(s => s.user);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');

  const isSuper = user?.role === 'super';
  let list = enquiries.filter(e => e.status !== 'lost'); // hide lost
  if (isSuper && scopedCompany) list = list.filter(e => String(e.co) === String(scopedCompany));
  if (filter) list = list.filter(e => e.status === filter);
  if (q) list = list.filter(e => JSON.stringify(e).toLowerCase().includes(q.toLowerCase()));

  const totalValue = list.reduce((s, e) => s + (e.value || 0), 0);

  return (
    <div>
      <div className="main-header">
        <div>
          <h2>📋 Enquiries</h2>
          <div className="text-sm text-mut">{list.length} active · ₹{totalValue.toLocaleString()} pipeline</div>
        </div>
        <button className="btn" onClick={() => setEditing({})}>+ New Enquiry</button>
        <ReportDownload module="enquiries" label="Enquiries" />
      </div>
      <div className="card">
        <div className="row mb-2">
          <input placeholder="Search enquiries..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{maxWidth: 180}}>
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="quoted">Quoted</option>
            <option value="won">Won</option>
          </select>
        </div>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Client</th><th>Subject</th><th>Owner</th><th>Value</th><th>Status</th><th>Last Follow-up</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="text-center text-mut" style={{padding: 40}}>No enquiries</td></tr>}
            {list.map(e => {
              const last = (e.log || []).slice().reverse().find(l => l);
              return (
                <tr key={e._id} onClick={() => setSelected(e)} style={{cursor: 'pointer'}}>
                  <td><strong>{e.client}</strong>{e.contact && <div className="text-mut text-sm">{e.contact}</div>}</td>
                  <td>{e.subject || '—'}</td>
                  <td>{e.owner || '—'}</td>
                  <td>{(e.value || 0).toLocaleString()}</td>
                  <td><span className={`badge ${STATUS_BADGE[e.status] || ''}`}>{e.status}</span></td>
                  <td className="text-mut text-sm">{last ? `${last.action || 'note'} · ${new Date(last.at).toLocaleDateString()}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {selected && !editing && <EnquiryDetail enquiry={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
      {editing && <EnquiryForm initial={editing} onClose={() => { setEditing(null); setSelected(null); }} />}
    </div>
  );
}

function EnquiryDetail({ enquiry, onClose, onEdit }) {
  const [showLog, setShowLog] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  return (
    <>
      <Modal title={enquiry.client} onClose={onClose} maxWidth={640}>
        <div style={{fontSize: 14}}>
          <div className="row"><strong style={{width: 100}}>Subject:</strong> <span>{enquiry.subject || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Contact:</strong> <span>{enquiry.contact || '—'} · {enquiry.phone || '—'} · {enquiry.email || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Source:</strong> <span>{enquiry.source || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Value:</strong> <span>₹{(enquiry.value || 0).toLocaleString()}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Owner:</strong> <span>{enquiry.owner || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Status:</strong> <span className={`badge ${STATUS_BADGE[enquiry.status]}`}>{enquiry.status}</span></div>
          {enquiry.desc && <div className="mt-2"><strong>Description:</strong><div className="mt-1 text-mut">{enquiry.desc}</div></div>}

          <h4 style={{fontSize: 13, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 20, marginBottom: 8}}>Follow-up Log</h4>
          {(enquiry.log || []).length === 0 && <p className="text-mut">No follow-ups yet</p>}
          {(enquiry.log || []).slice().reverse().map((l, i) => (
            <div key={i} style={{padding: '6px 0', borderBottom: '1px solid var(--line)'}}>
              <div className="text-sm"><strong>{l.action || 'note'}</strong> · <span className="text-mut">{l.by}</span> · <span className="text-mut">{new Date(l.at).toLocaleString()}</span></div>
              {l.note && <div className="text-sm text-mut mt-1">{l.note}</div>}
            </div>
          ))}
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16, flexWrap: 'wrap'}}>
          <button className="btn sec sm" onClick={() => setShowLog(true)}>+ Add follow-up</button>
          {enquiry.status !== 'won' && <button className="btn grn sm" onClick={() => setShowConvert(true)}>✓ Convert to SO</button>}
          <button className="btn sm" style={{background: 'var(--red)'}} onClick={() => setShowLost(true)}>✗ Mark Lost</button>
          <button className="btn sec sm" onClick={onEdit}>✏ Edit</button>
        </div>
      </Modal>
      {showLog && <LogModal enquiryId={enquiry._id} onClose={() => setShowLog(false)} />}
      {showLost && <LostModal enquiryId={enquiry._id} onClose={() => { setShowLost(false); onClose(); }} />}
      {showConvert && <ConvertModal enquiry={enquiry} onClose={() => { setShowConvert(false); onClose(); }} />}
    </>
  );
}

function LogModal({ enquiryId, onClose }) {
  const [action, setAction] = useState('called');
  const [note, setNote] = useState('');
  async function submit(e) {
    e.preventDefault();
    try { await api.post(`/api/enquiries/${enquiryId}/log`, { action, note }); toast('Follow-up added'); onClose(); }
    catch (e) { toast(e.message); }
  }
  return (
    <Modal title="Add Follow-up" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Action</label>
        <select value={action} onChange={e => setAction(e.target.value)}>
          <option value="called">Called</option>
          <option value="emailed">Emailed</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="visited">Visited</option>
          <option value="quoted">Quoted</option>
          <option value="note">Note</option>
        </select>
        <label className="mt-1">Note</label>
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened, next steps..." />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function LostModal({ enquiryId, onClose }) {
  const [reason, setReason] = useState('');
  async function submit(e) {
    e.preventDefault();
    try { await api.post(`/api/enquiries/${enquiryId}/lost`, { reason }); toast('Marked as lost'); onClose(); }
    catch (e) { toast(e.message); }
  }
  return (
    <Modal title="Mark Enquiry as Lost" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Reason (required)</label>
        <textarea rows={3} required value={reason} onChange={e => setReason(e.target.value)} placeholder="Why did we lose this? Budget, competitor, timing..." />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" style={{background: 'var(--red)'}}>Mark Lost</button>
        </div>
      </form>
    </Modal>
  );
}

function ConvertModal({ enquiry, onClose }) {
  const [items, setItems] = useState([{ desc: enquiry.subject || '', qty: 1, unit: 'nos', rate: enquiry.value || 0 }]);
  function addItem() { setItems([...items, { desc: '', qty: 1, unit: 'nos', rate: 0 }]); }
  function setItem(i, k, v) { setItems(items.map((x, idx) => idx === i ? { ...x, [k]: v } : x)); }
  function removeItem(i) { setItems(items.filter((_, idx) => idx !== i)); }
  const total = items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);

  async function submit(e) {
    e.preventDefault();
    try {
      const r = await api.post(`/api/enquiries/${enquiry._id}/convert`, { items });
      toast(`Sales Order #${r.salesOrder.no} created`);
      onClose();
    } catch (e) { toast(e.message); }
  }

  return (
    <Modal title={`Convert to Sales Order — ${enquiry.client}`} onClose={onClose} maxWidth={720}>
      <form onSubmit={submit}>
        <p className="text-mut text-sm mb-2">Marks the enquiry as won and creates a confirmed Sales Order with these items.</p>
        <label>Items</label>
        {items.map((it, i) => (
          <div key={i} className="row mb-1" style={{background: '#f8fafc', padding: 8, borderRadius: 6}}>
            <input placeholder="Description" value={it.desc} onChange={e => setItem(i, 'desc', e.target.value)} style={{flex: 3}} required />
            <input type="number" placeholder="Qty" value={it.qty} onChange={e => setItem(i, 'qty', Number(e.target.value))} style={{width: 80}} min={1} />
            <input placeholder="Unit" value={it.unit} onChange={e => setItem(i, 'unit', e.target.value)} style={{width: 80}} />
            <input type="number" placeholder="Rate" value={it.rate} onChange={e => setItem(i, 'rate', Number(e.target.value))} style={{width: 100}} />
            {items.length > 1 && <button type="button" className="btn sm" style={{background: 'var(--red)'}} onClick={() => removeItem(i)}>×</button>}
          </div>
        ))}
        <button type="button" className="btn sec sm" onClick={addItem}>+ Add line</button>
        <div className="mt-2 text-lg" style={{textAlign: 'right'}}><strong>Total: ₹{total.toLocaleString()}</strong></div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn grn">Create SO</button>
        </div>
      </form>
    </Modal>
  );
}

function EnquiryForm({ initial, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ status: 'new', ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (initial._id) await api.put(`/api/enquiries/${initial._id}`, payload);
      else await api.post('/api/enquiries', payload);
      toast('Saved');
      onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? 'Edit Enquiry' : 'New Enquiry'} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Client *</label>
        <input required value={data.client || ''} onChange={e => set('client', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Contact Person</label><input value={data.contact || ''} onChange={e => set('contact', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Phone</label><input value={data.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Email</label><input type="email" value={data.email || ''} onChange={e => set('email', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Source</label><input value={data.source || ''} onChange={e => set('source', e.target.value)} placeholder="Referral, Website..." /></div>
        </div>
        <label className="mt-1">Subject</label>
        <input value={data.subject || ''} onChange={e => set('subject', e.target.value)} />
        <label className="mt-1">Description</label>
        <textarea rows={2} value={data.desc || ''} onChange={e => set('desc', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Est. Value ₹</label><input type="number" value={data.value || 0} onChange={e => set('value', Number(e.target.value))} /></div>
          <div style={{flex: 1}}><label>Owner</label><input value={data.owner || ''} onChange={e => set('owner', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Status</label>
            <select value={data.status} onChange={e => set('status', e.target.value)}>
              <option value="new">New</option><option value="contacted">Contacted</option>
              <option value="quoted">Quoted</option><option value="won">Won</option>
            </select>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
