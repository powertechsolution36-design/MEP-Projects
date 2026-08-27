import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import ReportDownload from '../components/ReportDownload';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { open: 'amb', assigned: 'blu', inprogress: 'blu', onhold: 'amb', closed: 'grn' };
const PRIORITY_BADGE = { low: '', normal: 'blu', high: 'amb', urgent: 'red' };

export default function ServiceCalls() {
  const calls = useStore(s => s.serviceCalls);
  const user = useStore(s => s.user);
  const users = useStore(s => s.users);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');

  const isSuper = user?.role === 'super';
  const isEng = user.role === 'service_eng';
  let list = calls;
  if (isSuper && scopedCompany) list = list.filter(c => String(c.co) === String(scopedCompany));
  if (isEng) list = list.filter(c => c.eng === user.name);
  if (statusF) list = list.filter(c => c.status === statusF);
  if (q) list = list.filter(c => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));

  const openCount = list.filter(c => c.status !== 'closed').length;
  const urgentCount = list.filter(c => c.priority === 'urgent' && c.status !== 'closed').length;

  return (
    <div>
      <div className="main-header">
        <div>
          <h2>🛠️ {isEng ? 'My Service Jobs' : 'Service Calls'}</h2>
          <div className="text-sm text-mut">{openCount} open · {urgentCount} urgent<ReportDownload module="service-calls" label="Service Calls" /></div>
        </div>
        {!isEng && <button className="btn" onClick={() => setEditing({})}>+ New Call</button>}
      </div>
      <div className="card">
        <div className="row mb-2">
          <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{maxWidth: 180}}>
            <option value="">All statuses</option>
            <option value="open">Open</option><option value="assigned">Assigned</option>
            <option value="inprogress">In Progress</option><option value="onhold">On Hold</option><option value="closed">Closed</option>
          </select>
        </div>
        <div className="tw"><table className="data-table">
          <thead><tr><th>PSC#</th><th>Client</th><th>Type</th><th>Priority</th><th>Engineer</th><th>Scheduled</th><th>Status</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="text-center text-mut" style={{padding: 40}}>No service calls</td></tr>}
            {list.map(c => (
              <tr key={c._id} onClick={() => setSelected(c)} style={{cursor: 'pointer'}}>
                <td><strong>PSC-{c.psc}</strong></td>
                <td>{c.client}{c.site && <div className="text-mut text-sm">{c.site}</div>}</td>
                <td>{c.type}</td>
                <td><span className={`badge ${PRIORITY_BADGE[c.priority] || ''}`}>{c.priority}</span></td>
                <td>{c.eng || <span className="text-mut">unassigned</span>}</td>
                <td className="text-mut text-sm">{c.scheduled ? new Date(c.scheduled).toLocaleDateString() : '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[c.status] || ''}`}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {selected && !editing && <CallDetail call={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
      {editing && <CallForm initial={editing} users={users} onClose={() => { setEditing(null); setSelected(null); }} />}
    </div>
  );
}

function CallDetail({ call, onClose, onEdit }) {
  const user = useStore(s => s.user);
  const [closing, setClosing] = useState(false);
  return (
    <>
      <Modal title={`PSC-${call.psc} · ${call.client}`} onClose={onClose} maxWidth={640}>
        <div style={{fontSize: 14}}>
          <div className="row"><strong style={{width: 100}}>Type:</strong> <span>{call.type}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Priority:</strong> <span className={`badge ${PRIORITY_BADGE[call.priority]}`}>{call.priority}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Status:</strong> <span className={`badge ${STATUS_BADGE[call.status]}`}>{call.status}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Client:</strong> <span>{call.client}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Site:</strong> <span>{call.site || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Contact:</strong> <span>{call.contact || '—'} · {call.phone || '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Engineer:</strong> <span>{call.eng || 'unassigned'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Scheduled:</strong> <span>{call.scheduled ? new Date(call.scheduled).toLocaleDateString() : '—'}</span></div>
          {call.desc && <div className="mt-2"><strong>Description:</strong><div className="mt-1 text-mut">{call.desc}</div></div>}
          {call.actions && <div className="mt-2"><strong>Actions Taken:</strong><div className="mt-1 text-mut">{call.actions}</div></div>}
          {(call.parts || []).length > 0 && (
            <div className="mt-2">
              <strong>Parts Used:</strong>
              <ul style={{marginTop: 6, paddingLeft: 20}}>
                {call.parts.map((p, i) => <li key={i}>{p.name} — {p.qty} {p.unit}</li>)}
              </ul>
            </div>
          )}
          {call.closedAt && <div className="text-mut text-sm mt-2">Closed: {new Date(call.closedAt).toLocaleString()}</div>}
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16, flexWrap: 'wrap'}}>
          {call.status !== 'closed' && call.eng === user.name && <button className="btn grn" onClick={() => setClosing(true)}>✓ Complete Job</button>}
          <button className="btn sec" onClick={onEdit}>✏ Edit</button>
        </div>
      </Modal>
      {closing && <CompleteJob call={call} onClose={() => { setClosing(false); onClose(); }} />}
    </>
  );
}

function CompleteJob({ call, onClose }) {
  const [actions, setActions] = useState(call.actions || '');
  const [parts, setParts] = useState(call.parts || []);
  function addPart() { setParts([...parts, { name: '', qty: 1, unit: 'nos' }]); }
  function setPart(i, k, v) { setParts(parts.map((p, idx) => idx === i ? { ...p, [k]: v } : p)); }
  async function submit(e) {
    e.preventDefault();
    try {
      await api.put(`/api/service-calls/${call._id}`, { actions, parts, status: 'closed' });
      toast('Service call closed'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={`Complete PSC-${call.psc}`} onClose={onClose} maxWidth={640}>
      <form onSubmit={submit}>
        <label>Actions Taken *</label>
        <textarea rows={4} required value={actions} onChange={e => setActions(e.target.value)} placeholder="Describe what was done..." />
        <label className="mt-2">Parts / Materials Used</label>
        {parts.map((p, i) => (
          <div key={i} className="row mb-1" style={{background: '#f8fafc', padding: 8, borderRadius: 6}}>
            <input placeholder="Part name" value={p.name} onChange={e => setPart(i, 'name', e.target.value)} style={{flex: 2}} />
            <input type="number" placeholder="Qty" value={p.qty} onChange={e => setPart(i, 'qty', Number(e.target.value))} style={{width: 80}} />
            <input placeholder="Unit" value={p.unit} onChange={e => setPart(i, 'unit', e.target.value)} style={{width: 80}} />
            <button type="button" className="btn sm" style={{background: 'var(--red)'}} onClick={() => setParts(parts.filter((_, idx) => idx !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn sec sm" onClick={addPart}>+ Add part</button>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn grn">Complete & Close</button>
        </div>
      </form>
    </Modal>
  );
}

function CallForm({ initial, users, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ type: 'breakdown', priority: 'normal', status: 'open', ...initial });
  const engs = users.filter(u => u.role === 'service_eng' || u.role === 'engineer');
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (payload.eng && payload.status === 'open') payload.status = 'assigned';
      if (initial._id) await api.put(`/api/service-calls/${initial._id}`, payload);
      else await api.post('/api/service-calls', payload);
      toast('Saved'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? `Edit PSC-${initial.psc}` : 'New Service Call'} onClose={onClose} maxWidth={640}>
      <form onSubmit={submit}>
        <label>Client *</label>
        <input required value={data.client || ''} onChange={e => set('client', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Site</label><input value={data.site || ''} onChange={e => set('site', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Contact</label><input value={data.contact || ''} onChange={e => set('contact', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Phone</label><input value={data.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Type</label>
            <select value={data.type} onChange={e => set('type', e.target.value)}>
              <option value="breakdown">Breakdown</option><option value="amc">AMC</option>
              <option value="installation">Installation</option><option value="inspection">Inspection</option><option value="other">Other</option>
            </select>
          </div>
          <div style={{flex: 1}}><label>Priority</label>
            <select value={data.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div style={{flex: 1}}><label>Scheduled</label><input type="date" value={data.scheduled ? new Date(data.scheduled).toISOString().slice(0,10) : ''} onChange={e => set('scheduled', e.target.value)} /></div>
        </div>
        <label className="mt-1">Assign Engineer</label>
        <select value={data.eng || ''} onChange={e => set('eng', e.target.value)}>
          <option value="">— unassigned —</option>
          {engs.map(u => <option key={u._id} value={u.name}>{u.name} ({u.role})</option>)}
        </select>
        <label className="mt-1">Description</label>
        <textarea rows={2} value={data.desc || ''} onChange={e => set('desc', e.target.value)} placeholder="Complaint / issue description" />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
