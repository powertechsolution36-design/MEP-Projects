import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from './Modal';
import ReportModal from './ReportModal';
import { toast } from './Toast';

export default function ResourcePage({ title, resource, columns, fields, canCreate = true, canDelete = true, requiresCompany = true }) {
  const items = useStore(s => s[resource] || []);
  const user = useStore(s => s.user);
  const companies = useStore(s => s.companies);
  const scopedCompany = useStore(s => s.scopedCompany);
  const setScopedCompany = useStore(s => s.setScopedCompany);
  const create = useStore(s => s.create);
  const update = useStore(s => s.update);
  const remove = useStore(s => s.remove);
  const [editing, setEditing] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [q, setQ] = useState('');

  const isSuper = user?.role === 'super';

  // Super admin without a scoped company → show company picker landing screen
  // (except for Companies page which lists them anyway)
  if (isSuper && !scopedCompany && requiresCompany && resource !== 'companies') {
    return <CompanyPicker title={title} companies={companies} items={items} onPick={setScopedCompany} />;
  }

  // Filter items by scoped company for super admin
  let scopedItems = items;
  if (isSuper && scopedCompany) {
    scopedItems = items.filter(i => String(i.co) === String(scopedCompany));
  }

  const filtered = q ? scopedItems.filter(it => JSON.stringify(it).toLowerCase().includes(q.toLowerCase())) : scopedItems;

  // For super admin, if scope is set, auto-fill co in create form (hide selector)
  const effectiveFields = fields;

  async function onSave(data) {
    try {
      // Auto-attach scoped company if super has selected one
      const payload = { ...data };
      if (isSuper && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (editing?._id) await update(resource, editing._id, payload);
      else await create(resource, payload);
      setEditing(null);
      toast('Saved');
    } catch (e) { toast(e.message || 'Save failed'); }
  }

  async function onDelete(item) {
    if (!confirm(`Delete this ${title.replace(/s$/, '')}?`)) return;
    try { await remove(resource, item._id); toast('Deleted'); }
    catch (e) { toast(e.message); }
  }

  const currentCoName = scopedCompany ? (companies.find(c => String(c._id) === String(scopedCompany))?.name || '') : '';

  return (
    <div>
      <div className="main-header">
        <div>
          <h2>{title}</h2>
          {isSuper && scopedCompany && (
            <div className="text-sm text-mut" style={{marginTop: 4}}>
              🏢 {currentCoName} · <button className="link-btn" onClick={() => setScopedCompany(null)}>← switch company</button>
            </div>
          )}
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn sec" onClick={() => setShowReport(true)} title="Download report">📊 Reports</button>
          {canCreate && <button className="btn" onClick={() => setEditing({})}>+ New</button>}
        </div>
      </div>
      <div className="card">
        <input placeholder={`Search ${title.toLowerCase()}...`} value={q} onChange={e => setQ(e.target.value)} style={{marginBottom: 12}} />
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(c => <th key={c.key}>{c.label}</th>)}
              <th style={{width: 100}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={columns.length + 1} className="text-center text-mut" style={{padding: 40}}>No {title.toLowerCase()} yet</td></tr>}
            {filtered.map(item => (
              <tr key={item._id} onClick={() => setEditing(item)}>
                {columns.map(c => <td key={c.key}>{c.render ? c.render(item[c.key], item) : (item[c.key] ?? '—')}</td>)}
                <td onClick={e => e.stopPropagation()}>
                  <button className="btn sm sec" onClick={() => setEditing(item)}>Edit</button>
                  {canDelete && <button className="btn sm" style={{marginLeft: 4, background: 'var(--red)'}} onClick={() => onDelete(item)}>×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FormModal title={editing._id ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`} fields={effectiveFields} initial={editing} onSave={onSave} onClose={() => setEditing(null)} />}
      {showReport && <ReportModal title={title} items={scopedItems} columns={columns} onClose={() => setShowReport(false)} />}
    </div>
  );
}

function CompanyPicker({ title, companies, items, onPick }) {
  const count = (coId) => items.filter(i => String(i.co) === String(coId)).length;
  return (
    <div>
      <div className="main-header">
        <h2>{title}</h2>
        <button className="btn sec" onClick={() => onPick(null)}>Show all →</button>
      </div>
      <p className="text-mut mb-2">Select a company to view its {title.toLowerCase()}:</p>
      <div className="grid grid-3">
        {companies.length === 0 && <div className="card text-center text-mut">No companies yet</div>}
        {companies.map(co => (
          <button key={co._id} className="co-card" onClick={() => onPick(co._id)}>
            <div className="co-card-icon">🏢</div>
            <div className="co-card-name">{co.name}</div>
            <div className="co-card-code text-mut text-sm">{co.code || '—'}</div>
            <div className="co-card-count">{count(co._id)} {title.toLowerCase()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FormModal({ title, fields, initial, onSave, onClose }) {
  const [data, setData] = useState(() => ({ ...initial }));
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  function submit(e) { e.preventDefault(); onSave(data); }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {fields.map(f => (
          <div key={f.key} style={{marginBottom: 12}}>
            <label>{f.label}{f.required && ' *'}</label>
            {f.type === 'select' ? (
              <select value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} required={f.required}>
                <option value="">— select —</option>
                {f.options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea rows={3} value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} required={f.required} />
            ) : f.type === 'number' ? (
              <input type="number" value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value ? Number(e.target.value) : '')} required={f.required} />
            ) : f.type === 'date' ? (
              <input type="date" value={data[f.key] ? new Date(data[f.key]).toISOString().slice(0,10) : ''} onChange={e => set(f.key, e.target.value)} />
            ) : f.type === 'password' ? (
              <input type="password" value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} required={f.required} />
            ) : (
              <input value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} required={f.required} />
            )}
          </div>
        ))}
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
