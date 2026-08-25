import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { active: 'grn', expired: 'red', renewed: 'blu', cancelled: 'red' };

export default function Contracts() {
  const contracts = useStore(s => s.contracts);
  const user = useStore(s => s.user);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');

  const isSuper = user?.role === 'super';
  let list = contracts;
  if (isSuper && scopedCompany) list = list.filter(c => String(c.co) === String(scopedCompany));

  const now = Date.now();
  const expiring = list.filter(c => c.status === 'active' && c.end && (new Date(c.end).getTime() - now) <= 60 * 24 * 3600 * 1000 && (new Date(c.end).getTime() - now) >= 0);
  const dueVisits = list.flatMap(c => (c.svcs || []).map((v, i) => ({ contract: c, visit: v, idx: i }))).filter(x => !x.visit.done && x.visit.due && (new Date(x.visit.due).getTime() - now) <= 30 * 24 * 3600 * 1000);

  if (tab === 'active') list = list.filter(c => c.status === 'active');
  else if (tab === 'expired') list = list.filter(c => c.status === 'expired');
  if (q) list = list.filter(c => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="main-header">
        <h2>🔁 AMC / PM Contracts</h2>
        <button className="btn" onClick={() => setEditing({})}>+ New Contract</button>
      </div>
      <div className="grid grid-3 mb-2">
        <Stat label="Active Contracts" value={contracts.filter(c => c.status === 'active').length} color="var(--green)" />
        <Stat label="Expiring in 60 days" value={expiring.length} color="var(--amber)" />
        <Stat label="PM Visits Due (30d)" value={dueVisits.length} color="var(--red)" />
      </div>

      {dueVisits.length > 0 && (
        <div className="card">
          <h3 style={{fontSize: 15, marginBottom: 10}}>⏰ Upcoming PM Visits</h3>
          <div className="tw"><table className="data-table">
            <thead><tr><th>Client</th><th>Contract Type</th><th>Due Date</th><th>Days</th><th></th></tr></thead>
            <tbody>
              {dueVisits.slice(0, 10).map(x => {
                const days = Math.round((new Date(x.visit.due).getTime() - now) / (24 * 3600 * 1000));
                return (
                  <tr key={`${x.contract._id}-${x.idx}`} onClick={() => setSelected(x.contract)} style={{cursor: 'pointer'}}>
                    <td><strong>{x.contract.client}</strong></td>
                    <td>{x.contract.type}</td>
                    <td>{new Date(x.visit.due).toLocaleDateString()}</td>
                    <td><span className={`badge ${days < 7 ? 'red' : 'amb'}`}>{days}d</span></td>
                    <td><button className="btn sm grn" onClick={ev => { ev.stopPropagation(); markDone(x.contract._id, x.idx); }}>✓ Done</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="inv-tabs">
        {['active','expired','all'].map(t => (
          <button key={t} className={`inv-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'active' ? 'Active' : t === 'expired' ? 'Expired' : 'All'}
          </button>
        ))}
      </div>

      <div className="card">
        <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{marginBottom: 12}} />
        <div className="tw"><table className="data-table">
          <thead><tr><th>Client</th><th>Type</th><th>Frequency</th><th>Value</th><th>Start</th><th>End</th><th>Visits</th><th>Status</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="text-center text-mut" style={{padding: 40}}>No contracts</td></tr>}
            {list.map(c => {
              const doneVisits = (c.svcs || []).filter(v => v.done).length;
              const totalVisits = (c.svcs || []).length;
              return (
                <tr key={c._id} onClick={() => setSelected(c)} style={{cursor: 'pointer'}}>
                  <td><strong>{c.client}</strong></td>
                  <td>{c.type}</td>
                  <td>{c.freq}</td>
                  <td>₹{(c.value || 0).toLocaleString()}</td>
                  <td>{c.start ? new Date(c.start).toLocaleDateString() : '—'}</td>
                  <td>{c.end ? new Date(c.end).toLocaleDateString() : '—'}</td>
                  <td>{doneVisits}/{totalVisits}</td>
                  <td><span className={`badge ${STATUS_BADGE[c.status] || ''}`}>{c.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {selected && !editing && <ContractDetail contract={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
      {editing && <ContractForm initial={editing} onClose={() => { setEditing(null); setSelected(null); }} />}
    </div>
  );
}

async function markDone(contractId, idx) {
  try { await api.patch(`/api/contracts/${contractId}/svcs/${idx}`, { done: true }); toast('Visit marked done'); }
  catch (e) { toast(e.message); }
}

function ContractDetail({ contract, onClose, onEdit }) {
  const [addingVisit, setAddingVisit] = useState(false);
  return (
    <>
      <Modal title={contract.client} onClose={onClose} maxWidth={720}>
        <div style={{fontSize: 14}}>
          <div className="row"><strong style={{width: 100}}>Type:</strong> <span>{contract.type}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Frequency:</strong> <span>{contract.freq}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Value:</strong> <span>₹{(contract.value || 0).toLocaleString()}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Period:</strong> <span>{contract.start ? new Date(contract.start).toLocaleDateString() : '—'} → {contract.end ? new Date(contract.end).toLocaleDateString() : '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Status:</strong> <span className={`badge ${STATUS_BADGE[contract.status]}`}>{contract.status}</span></div>
          {contract.site && <div className="row mt-1"><strong style={{width: 100}}>Site:</strong> <span>{contract.site}</span></div>}

          <div className="row mt-2">
            <h4 style={{fontSize: 13, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1}}>PM Visit Schedule</h4>
            <button className="btn sm sec" onClick={() => setAddingVisit(true)}>+ Add Visit</button>
          </div>
          {(contract.svcs || []).length === 0 && <p className="text-mut mt-1">No visits scheduled</p>}
          {(contract.svcs || []).map((v, i) => (
            <div key={i} style={{padding: '8px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center'}}>
              <input type="checkbox" checked={!!v.done} onChange={e => api.patch(`/api/contracts/${contract._id}/svcs/${i}`, { done: e.target.checked })} style={{width: 18, height: 18}} />
              <div style={{flex: 1}}>
                <div><strong>Visit {i+1}</strong> · Due {v.due ? new Date(v.due).toLocaleDateString() : '—'}</div>
                {v.done && v.doneAt && <div className="text-sm text-mut">Done on {new Date(v.doneAt).toLocaleDateString()} by {v.eng || '—'}</div>}
                {v.notes && <div className="text-sm text-mut">{v.notes}</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16}}>
          <button className="btn sec" onClick={onEdit}>✏ Edit</button>
        </div>
      </Modal>
      {addingVisit && <AddVisit contract={contract} onClose={() => setAddingVisit(false)} />}
    </>
  );
}

function AddVisit({ contract, onClose }) {
  const [due, setDue] = useState('');
  const [eng, setEng] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const svcs = [...(contract.svcs || []), { due, eng, done: false }];
      await api.put(`/api/contracts/${contract._id}`, { svcs });
      toast('Visit scheduled'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title="Schedule PM Visit" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Due Date *</label>
        <input type="date" required value={due} onChange={e => setDue(e.target.value)} />
        <label className="mt-1">Assigned Engineer</label>
        <input value={eng} onChange={e => setEng(e.target.value)} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ContractForm({ initial, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ type: 'AMC', freq: 'quarterly', status: 'active', ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (initial._id) await api.put(`/api/contracts/${initial._id}`, payload);
      else await api.post('/api/contracts', payload);
      toast('Saved'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? 'Edit Contract' : 'New Contract'} onClose={onClose} maxWidth={560}>
      <form onSubmit={submit}>
        <label>Client *</label>
        <input required value={data.client || ''} onChange={e => set('client', e.target.value)} />
        <label className="mt-1">Site</label>
        <input value={data.site || ''} onChange={e => set('site', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Contract No.</label><input value={data.no || ''} onChange={e => set('no', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Type</label>
            <select value={data.type} onChange={e => set('type', e.target.value)}>
              <option value="AMC">AMC</option><option value="CAMC">CAMC</option><option value="One-time">One-time</option><option value="Rental">Rental</option>
            </select>
          </div>
          <div style={{flex: 1}}><label>Frequency</label>
            <select value={data.freq} onChange={e => set('freq', e.target.value)}>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
              <option value="halfyearly">Half-yearly</option><option value="yearly">Yearly</option>
            </select>
          </div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Start Date</label><input type="date" value={data.start ? new Date(data.start).toISOString().slice(0,10) : ''} onChange={e => set('start', e.target.value)} /></div>
          <div style={{flex: 1}}><label>End Date</label><input type="date" value={data.end ? new Date(data.end).toISOString().slice(0,10) : ''} onChange={e => set('end', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Value ₹</label><input type="number" value={data.value || 0} onChange={e => set('value', Number(e.target.value))} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Status</label>
            <select value={data.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option><option value="expired">Expired</option><option value="renewed">Renewed</option><option value="cancelled">Cancelled</option>
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

function Stat({ label, value, color }) {
  return (
    <div className="stat-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div><div className="text-mut text-sm">{label}</div><div className="stat-value">{value}</div></div>
    </div>
  );
}
