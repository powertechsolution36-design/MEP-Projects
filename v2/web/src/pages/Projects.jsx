import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams, Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { active: 'grn', planning: 'amb', onhold: 'blu', completed: 'grn', cancelled: 'red' };

export default function Projects() {
  return (
    <Routes>
      <Route path="" element={<List />} />
      <Route path=":id" element={<Detail />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}

function List() {
  const projects = useStore(s => s.projects);
  const user = useStore(s => s.user);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [divF, setDivF] = useState('');
  const [editing, setEditing] = useState(null);
  const nav = useNavigate();

  const isSuper = user?.role === 'super';
  let list = projects;
  if (isSuper && scopedCompany) list = list.filter(p => String(p.co) === String(scopedCompany));
  // Engineer "My Work" mode: only show projects where user is engineer/pm
  if (user.role === 'engineer') list = list.filter(p => (p.engs || []).includes(user.name) || p.pm === user.name);
  if (statusF) list = list.filter(p => p.status === statusF);
  if (divF) list = list.filter(p => p.div === divF);
  if (q) list = list.filter(p => JSON.stringify(p).toLowerCase().includes(q.toLowerCase()));

  const isEngineer = user.role === 'engineer';

  return (
    <div>
      <div className="main-header">
        <h2>🏗️ {isEngineer ? 'My Work' : 'Projects'}</h2>
        {!isEngineer && <button className="btn" onClick={() => setEditing({})}>+ New Project</button>}
      </div>
      <div className="card">
        <div className="row mb-2">
          <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{maxWidth: 160}}>
            <option value="">All statuses</option>
            <option value="planning">Planning</option><option value="active">Active</option>
            <option value="onhold">On Hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
          {!['hvac_pm','solar_pm','mep_pm'].includes(user.role) && (
            <select value={divF} onChange={e => setDivF(e.target.value)} style={{maxWidth: 140}}>
              <option value="">All divs</option>
              <option value="MEP">MEP</option><option value="HVAC">HVAC</option><option value="Solar">Solar</option>
            </select>
          )}
        </div>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Client</th><th>Division</th><th>Status</th><th>PM</th><th>Engineers</th><th>Value</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="text-center text-mut" style={{padding: 40}}>No projects</td></tr>}
            {list.map(p => (
              <tr key={p._id} onClick={() => nav(p._id)} style={{cursor: 'pointer'}}>
                <td><strong>{p.code || '—'}</strong></td>
                <td>{p.name}</td>
                <td>{p.client || '—'}</td>
                <td>{p.div || '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[p.status] || ''}`}>{p.status}</span></td>
                <td>{p.pm || '—'}</td>
                <td>{(p.engs || []).join(', ') || '—'}</td>
                <td>{(p.value || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {editing && <ProjectForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Detail() {
  const { id } = useParams();
  const nav = useNavigate();
  const projects = useStore(s => s.projects);
  const user = useStore(s => s.user);
  const project = projects.find(p => String(p._id) === String(id));
  const [showEdit, setShowEdit] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [showDC, setShowDC] = useState(false);
  const [tab, setTab] = useState('checklist');

  if (!project) return <div className="card text-center text-mut">Project not found</div>;

  const done = (project.chk || []).filter(c => c.done).length;
  const totalChk = (project.chk || []).length;
  const pct = totalChk ? Math.round((done / totalChk) * 100) : 0;

  return (
    <div>
      <div className="row mb-2">
        <button className="btn sec sm" onClick={() => nav('..')}>← Back</button>
        <div style={{flex: 1}}></div>
        <button className="btn sec" onClick={() => setShowEdit(true)}>✏ Edit</button>
      </div>
      <div className="card">
        <div className="row" style={{alignItems: 'flex-start'}}>
          <div style={{flex: 1}}>
            <h2 style={{fontSize: 22}}>{project.name}</h2>
            <div className="text-mut">{project.code} · {project.client} · {project.site || '—'}</div>
          </div>
          <span className={`badge ${STATUS_BADGE[project.status] || ''}`} style={{fontSize: 13, padding: '5px 12px'}}>{project.status}</span>
        </div>
        <div className="grid grid-3 mt-2">
          <Field label="Division" value={project.div} />
          <Field label="Project Manager" value={project.pm} />
          <Field label="Engineers" value={(project.engs || []).join(', ')} />
          <Field label="Start" value={project.start ? new Date(project.start).toLocaleDateString() : '—'} />
          <Field label="Target End" value={project.target ? new Date(project.target).toLocaleDateString() : '—'} />
          <Field label="Value" value={`₹${(project.value || 0).toLocaleString()}`} />
        </div>
        <div className="mt-2">
          <div className="text-sm text-mut">Checklist progress: {done} / {totalChk} ({pct}%)</div>
          <div style={{background: 'var(--line)', height: 6, borderRadius: 3, marginTop: 4}}>
            <div style={{background: 'var(--green)', height: '100%', width: `${pct}%`, borderRadius: 3, transition: 'width 0.3s'}}></div>
          </div>
        </div>
      </div>

      <div className="inv-tabs">
        {['checklist','updates','dc'].map(t => (
          <button key={t} className={`inv-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'checklist' ? '✅ Checklist' : t === 'updates' ? '📝 Updates' : '📋 Delivery Challans'}
          </button>
        ))}
      </div>

      {tab === 'checklist' && <ChecklistTab project={project} />}
      {tab === 'updates' && <UpdatesTab project={project} onAdd={() => setShowUpdate(true)} />}
      {tab === 'dc' && <DCTab project={project} onAdd={() => setShowDC(true)} />}

      {showEdit && <ProjectForm initial={project} onClose={() => setShowEdit(false)} />}
      {showUpdate && <UpdateForm projectId={project._id} onClose={() => setShowUpdate(false)} />}
      {showDC && <DCForm projectId={project._id} onClose={() => setShowDC(false)} />}
    </div>
  );
}

function Field({ label, value }) {
  return <div><div className="text-mut text-sm">{label}</div><div style={{fontWeight: 600}}>{value || '—'}</div></div>;
}

function ChecklistTab({ project }) {
  const user = useStore(s => s.user);
  const [newItem, setNewItem] = useState('');

  async function toggleItem(idx, done) {
    try { await api.patch(`/api/projects/${project._id}/chk/${idx}`, { done, by: user.name }); }
    catch (e) { toast(e.message); }
  }
  async function updateRemark(idx, notes) {
    try { await api.patch(`/api/projects/${project._id}/chk/${idx}`, { notes }); }
    catch (e) { toast(e.message); }
  }
  async function addNew(e) {
    e.preventDefault();
    if (!newItem.trim()) return;
    try {
      const chk = [...(project.chk || []), { title: newItem, done: false }];
      await api.put(`/api/projects/${project._id}`, { chk });
      setNewItem('');
    } catch (e) { toast(e.message); }
  }
  async function removeItem(idx) {
    if (!confirm('Remove this checklist item?')) return;
    try {
      const chk = (project.chk || []).filter((_, i) => i !== idx);
      await api.put(`/api/projects/${project._id}`, { chk });
    } catch (e) { toast(e.message); }
  }

  return (
    <div>
      {(project.chk || []).length === 0 && <div className="card text-center text-mut" style={{padding: 30}}>No checklist items. Add one below.</div>}
      {(project.chk || []).map((item, idx) => (
        <div key={idx} className={`chk-item ${item.done ? 'done' : ''}`}>
          <div style={{display: 'flex', gap: 10, alignItems: 'flex-start'}}>
            <input type="checkbox" checked={!!item.done} onChange={e => toggleItem(idx, e.target.checked)} style={{width: 18, height: 18, marginTop: 2}} />
            <div style={{flex: 1}}>
              <div style={{fontWeight: 600, textDecoration: item.done ? 'line-through' : 'none'}}>{item.title}</div>
              {item.done && item.by && <div className="text-sm text-mut">Done by {item.by} on {new Date(item.at).toLocaleDateString()}</div>}
              <input placeholder="Add remark..." defaultValue={item.notes || ''} onBlur={e => e.target.value !== item.notes && updateRemark(idx, e.target.value)} className="mt-1 text-sm" style={{padding: 6}} />
            </div>
            <button className="btn sm" style={{background: 'var(--red)'}} onClick={() => removeItem(idx)}>×</button>
          </div>
        </div>
      ))}
      <form onSubmit={addNew} className="card row mt-2" style={{gap: 8}}>
        <input placeholder="+ New checklist item..." value={newItem} onChange={e => setNewItem(e.target.value)} style={{flex: 1}} />
        <button className="btn" type="submit">Add</button>
      </form>
    </div>
  );
}

function UpdatesTab({ project, onAdd }) {
  const updates = (project.updates || []).slice().reverse();
  return (
    <div>
      <div className="row mb-2">
        <div style={{flex: 1}}></div>
        <button className="btn" onClick={onAdd}>+ Add Update</button>
      </div>
      {updates.length === 0 && <div className="card text-center text-mut" style={{padding: 30}}>No updates yet</div>}
      {updates.map((u, i) => (
        <div key={i} className="card">
          <div className="row"><strong style={{flex: 1}}>{u.by}</strong><span className="text-mut text-sm">{new Date(u.at).toLocaleString()}</span></div>
          <div className="mt-1">{u.text}</div>
        </div>
      ))}
    </div>
  );
}

function DCTab({ project, onAdd }) {
  const dcs = (project.dc || []).slice().reverse();
  return (
    <div>
      <div className="row mb-2">
        <div style={{flex: 1}}></div>
        <button className="btn" onClick={onAdd}>+ New Delivery Challan</button>
      </div>
      {dcs.length === 0 && <div className="card text-center text-mut" style={{padding: 30}}>No DCs yet</div>}
      {dcs.map((d, i) => (
        <div key={i} className="card">
          <div className="row">
            <strong style={{flex: 1}}>DC-{d.no || i+1}</strong>
            <span className="text-mut text-sm">by {d.by} · {new Date(d.at).toLocaleString()}</span>
          </div>
          <div className="text-mut text-sm">{d.type || 'Materials'}{d.ref && ` · Ref: ${d.ref}`}</div>
          {d.note && <div className="mt-1">{d.note}</div>}
        </div>
      ))}
    </div>
  );
}

function UpdateForm({ projectId, onClose }) {
  const [text, setText] = useState('');
  async function submit(e) {
    e.preventDefault();
    try { await api.post(`/api/projects/${projectId}/updates`, { text }); toast('Update added'); onClose(); }
    catch (e) { toast(e.message); }
  }
  return (
    <Modal title="Add Project Update" onClose={onClose}>
      <form onSubmit={submit}>
        <label>What happened / next steps</label>
        <textarea rows={4} required value={text} onChange={e => setText(e.target.value)} autoFocus />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function DCForm({ projectId, onClose }) {
  const [data, setData] = useState({ type: 'Materials to Site', ref: '', note: '' });
  async function submit(e) {
    e.preventDefault();
    try {
      const r = await api.post(`/api/projects/${projectId}/dc`, data);
      toast(`DC-${r.dc.no} created`); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title="New Delivery Challan" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Type</label>
        <select value={data.type} onChange={e => setData({...data, type: e.target.value})}>
          <option>Materials to Site</option><option>Return from Site</option><option>Transfer</option><option>Handover</option>
        </select>
        <label className="mt-1">Reference</label>
        <input value={data.ref} onChange={e => setData({...data, ref: e.target.value})} placeholder="Vehicle no, transporter, etc" />
        <label className="mt-1">Notes / Items</label>
        <textarea rows={3} value={data.note} onChange={e => setData({...data, note: e.target.value})} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Create DC</button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectForm({ initial, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ status: 'planning', div: 'MEP', engs: [], ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (typeof payload.engs === 'string') payload.engs = payload.engs.split(',').map(s => s.trim()).filter(Boolean);
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (initial._id) await api.put(`/api/projects/${initial._id}`, payload);
      else await api.post('/api/projects', payload);
      toast('Saved'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? `Edit ${initial.name}` : 'New Project'} onClose={onClose} maxWidth={640}>
      <form onSubmit={submit}>
        <label>Name *</label>
        <input required value={data.name || ''} onChange={e => set('name', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Client</label><input value={data.client || ''} onChange={e => set('client', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Site</label><input value={data.site || ''} onChange={e => set('site', e.target.value)} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Division</label>
            <select value={data.div} onChange={e => set('div', e.target.value)}>
              <option value="MEP">MEP</option><option value="HVAC">HVAC</option><option value="Solar">Solar</option><option value="Other">Other</option>
            </select>
          </div>
          <div style={{flex: 1}}><label>Status</label>
            <select value={data.status} onChange={e => set('status', e.target.value)}>
              <option value="planning">Planning</option><option value="active">Active</option>
              <option value="onhold">On Hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Start Date</label><input type="date" value={data.start ? new Date(data.start).toISOString().slice(0,10) : ''} onChange={e => set('start', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Target Date</label><input type="date" value={data.target ? new Date(data.target).toISOString().slice(0,10) : ''} onChange={e => set('target', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Value ₹</label><input type="number" value={data.value || 0} onChange={e => set('value', Number(e.target.value))} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Project Manager</label><input value={data.pm || ''} onChange={e => set('pm', e.target.value)} /></div>
          <div style={{flex: 2}}><label>Engineers (comma separated)</label><input value={Array.isArray(data.engs) ? data.engs.join(', ') : (data.engs || '')} onChange={e => set('engs', e.target.value)} /></div>
        </div>
        <label className="mt-1">Notes</label>
        <textarea rows={2} value={data.notes || ''} onChange={e => set('notes', e.target.value)} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
