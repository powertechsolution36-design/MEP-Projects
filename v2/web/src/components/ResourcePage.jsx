import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from './Modal';
import { toast } from './Toast';

/**
 * Generic list + create/edit/delete page.
 * Props:
 *  - title, resource (store key), columns [{key,label,render?}]
 *  - fields [{key,label,type,options?,required?}]
 *  - filterBy?: array of query filter columns
 */
export default function ResourcePage({ title, resource, columns, fields, canCreate = true, canDelete = true, requiresCompany = true }) {
  const items = useStore(s => s[resource] || []);
  const user = useStore(s => s.user);
  const companies = useStore(s => s.companies);
  const create = useStore(s => s.create);
  const update = useStore(s => s.update);
  const remove = useStore(s => s.remove);
  const [editing, setEditing] = useState(null); // null | {} | doc
  const [q, setQ] = useState('');

  const isSuper = user?.role === 'super';
  const filtered = q ? items.filter(it => JSON.stringify(it).toLowerCase().includes(q.toLowerCase())) : items;

  // For super admin, prepend a company selector to fields (except when the resource IS companies)
  const effectiveFields = (isSuper && requiresCompany && resource !== 'companies')
    ? [{ key: 'co', label: 'Company', type: 'select', options: companies.map(c => ({ value: c._id, label: c.name })), required: true }, ...fields]
    : fields;

  async function onSave(data) {
    try {
      if (editing?._id) await update(resource, editing._id, data);
      else await create(resource, data);
      setEditing(null);
      toast('Saved');
    } catch (e) { toast(e.message || 'Save failed'); }
  }

  async function onDelete(item) {
    if (!confirm(`Delete this ${title.replace(/s$/, '')}?`)) return;
    try { await remove(resource, item._id); toast('Deleted'); }
    catch (e) { toast(e.message); }
  }

  return (
    <div>
      <div className="main-header">
        <h2>{title}</h2>
        {canCreate && <button className="btn" onClick={() => setEditing({})}>+ New</button>}
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
