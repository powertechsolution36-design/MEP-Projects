import { useState } from 'react';
import { Routes, Route, useNavigate, useParams, Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import ReportDownload from '../components/ReportDownload';
import { toast } from '../components/Toast';
import { api } from '../api/client';

export default function Inventory() {
  return (
    <div>
      <Routes>
        <Route path="" element={<Overview />} />
        <Route path="stock" element={<Stock />} />
        <Route path="stock/:id" element={<ItemDetail />} />
        <Route path="issue" element={<IssueMaterial />} />
        <Route path="returns" element={<Returns />} />
        <Route path="transfer" element={<StockTransfer />} />
        <Route path="categories" element={<CategoriesLocations />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  );
}

// -------- Overview: dashboard KPIs + return requests + quick actions --------
function Overview() {
  const items = useStore(s => s.invItems);
  const issues = useStore(s => s.invIssues);
  const cats = useStore(s => s.invCategories);
  const nav = useNavigate();

  const total = items.length;
  const catCount = cats.length;
  const lowStock = items.filter(i => (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0);
  const outStock = items.filter(i => (i.qty || 0) === 0);
  const value = items.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0);
  const withStaff = issues.filter(i => i.status !== 'closed').length;
  const pendingReturns = issues.flatMap(i => (i.returnRequests || []).filter(r => r.status === 'pending').map(r => ({ ...r, issueId: i._id, staff: i.staff })));

  return (
    <div>
      <div className="grid grid-3 mb-3">
        <Stat label="Total Items" value={total} color="var(--red)" />
        <Stat label="Categories" value={catCount} color="var(--blue)" />
        <Stat label="Stock Value" value={`₹${value.toLocaleString()}`} color="var(--green)" />
        <Stat label="Low Stock" value={lowStock.length} color="var(--amber)" />
        <Stat label="Out of Stock" value={outStock.length} color="var(--red)" />
        <Stat label="With Staff" value={withStaff} color="var(--blue)" />
        <Stat label="Return Requests" value={pendingReturns.length} color="var(--red)" />
      </div>

      {pendingReturns.length > 0 && (
        <div className="card">
          <h3 style={{fontSize: 15, marginBottom: 12}}>📥 Return Requests from Staff</h3>
          <div className="tw"><table className="data-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Staff</th><th>Notes</th><th>Requested</th><th style={{width: 180}}>Action</th></tr></thead>
            <tbody>
              {pendingReturns.flatMap(r => r.items.map((it, idx) => (
                <tr key={`${r._id}-${idx}`}>
                  <td><strong>{it.name}</strong></td>
                  <td><strong className="text-mut">{it.qty} {it.unit}</strong></td>
                  <td>{r.staff}</td>
                  <td className="text-mut">{r.notes || '—'}</td>
                  <td className="text-mut text-sm">{new Date(r.at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn sm grn" onClick={() => handleReturn(r.issueId, r._id, 'receive')}>Receive</button>
                    <button className="btn sm" style={{background: 'var(--red)', marginLeft: 6}} onClick={() => handleReturn(r.issueId, r._id, 'reject')}>Reject</button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Quick Actions</h3>
        <div className="row">
          <button className="btn" onClick={() => nav('stock')}>📦 View Stock</button>
          <button className="btn sec" onClick={() => nav('issue')}>📤 Issue Material</button>
          <button className="btn sec" onClick={() => nav('returns')}>📥 Material Returns</button>
          <button className="btn sec" onClick={() => nav('transfer')}>🔄 Transfer Stock</button>
          <button className="btn sec" onClick={() => nav('categories')}>🗂 Categories</button>
          <button className="btn sec" onClick={() => nav('transactions')}>🧾 Transactions</button>
        </div>
      </div>

      {(lowStock.length > 0 || outStock.length > 0) && (
        <div className="card">
          <h3 style={{fontSize: 15, marginBottom: 12}}>⚠ Low / Out of Stock</h3>
          <div className="tw"><table className="data-table">
            <thead><tr><th>Code</th><th>Item</th><th>In Stock</th><th>Min Level</th><th>Shortfall</th><th>Status</th></tr></thead>
            <tbody>
              {[...outStock, ...lowStock.filter(i => (i.qty || 0) > 0)].map(i => (
                <tr key={i._id}>
                  <td>{i.code || '—'}</td>
                  <td><strong>{i.name}</strong></td>
                  <td className="text-red"><strong>{i.qty || 0} {i.unit}</strong></td>
                  <td>{i.minQty || 0}</td>
                  <td className="text-red"><strong>{Math.max(0, (i.minQty || 0) - (i.qty || 0))}</strong></td>
                  <td>{(i.qty || 0) === 0 ? <span className="badge red">Out of Stock</span> : <span className="badge amb">Low Stock</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

async function handleReturn(issueId, reqId, action) {
  try {
    await api.patch(`/api/inventory/issues/${issueId}/return-request/${reqId}`, { action });
    toast(action === 'receive' ? 'Return received' : 'Return rejected');
  } catch (e) { toast(e.message); }
}

// -------- Stock: full item list with low-stock highlight, click to detail --------
function Stock() {
  const items = useStore(s => s.invItems);
  const cats = useStore(s => s.invCategories);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [div, setDiv] = useState('');
  const [showLow, setShowLow] = useState(false);
  const nav = useNavigate();

  let list = items;
  if (cat) list = list.filter(i => String(i.cat) === cat);
  if (div) list = list.filter(i => (i.division || 'COMMON') === div);
  if (showLow) list = list.filter(i => (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0);
  if (q) list = list.filter(i => (i.name + ' ' + (i.code || '')).toLowerCase().includes(q.toLowerCase()));

  const [showNew, setShowNew] = useState(false);

  return (
    <div>
      <div className="row mb-2">
        <input placeholder="Search items..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1, minWidth: 200}} />
        <select value={cat} onChange={e => setCat(e.target.value)} style={{maxWidth: 200}}>
          <option value="">All Categories</option>
          {cats.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select value={div} onChange={e => setDiv(e.target.value)} style={{maxWidth: 180}}>
          <option value="">All Divisions</option>
          <option value="COMMON">Common</option>
          <option value="HVAC">HVAC</option>
          <option value="SOLAR">Solar</option>
          <option value="MEP">MEP</option>
        </select>
        <label style={{display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap'}}>
          <input type="checkbox" checked={showLow} onChange={e => setShowLow(e.target.checked)} style={{width: 'auto'}} />
          Low stock only
        </label>
        <button className="btn" onClick={() => setShowNew(true)}>+ Add Item</button>
      </div>
      <div className="card">
        <div className="tw"><table className="data-table">
          <thead><tr><th>Code</th><th>Item</th><th>Category</th><th>Division</th><th>Unit</th><th>In Stock</th><th>Min</th><th>Rate</th><th>Value</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="text-center text-mut" style={{padding: 40}}>No items</td></tr>}
            {list.map(i => {
              const cn = cats.find(c => String(c._id) === String(i.cat))?.name || '—';
              const low = (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0;
              return (
                <tr key={i._id} onClick={() => nav(`${i._id}`)} style={{cursor: 'pointer'}}>
                  <td>{i.code || '—'}</td>
                  <td><strong>{i.name}</strong></td>
                  <td>{cn}</td>
                  <td><span className={`badge ${(i.division||'COMMON')==='COMMON'?'blu':(i.division==='HVAC'?'grn':(i.division==='SOLAR'?'ylw':'org'))}`}>{i.division||'COMMON'}</span></td>
                  <td>{i.unit}</td>
                  <td className={low ? 'text-red' : ''}><strong>{i.qty || 0}</strong>{low && ' ⚠'}</td>
                  <td>{i.minQty || 0}</td>
                  <td>{(i.rate || 0).toLocaleString()}</td>
                  <td>{((i.qty || 0) * (i.rate || 0)).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {showNew && <ItemForm onClose={() => setShowNew(false)} />}
    </div>
  );
}

// -------- Item Detail --------
function ItemDetail() {
  const { id } = useParams();
  const items = useStore(s => s.invItems);
  const cats = useStore(s => s.invCategories);
  const txns = useStore(s => s.invTransactions || []);
  const item = items.find(i => String(i._id) === String(id));
  const nav = useNavigate();
  const [showAdjust, setShowAdjust] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  if (!item) return <div className="card text-center text-mut">Item not found</div>;

  const itemTxns = txns.filter(t => String(t.item) === String(id)).slice(0, 30);
  const catName = cats.find(c => String(c._id) === String(item.cat))?.name || '—';

  return (
    <div>
      <div className="row mb-2">
        <button className="btn sec sm" onClick={() => nav('../stock')}>← Back to Stock</button>
        <div style={{flex: 1}}></div>
        <button className="btn sec" onClick={() => setShowEdit(true)}>✏ Edit</button>
        <button className="btn" onClick={() => setShowAdjust(true)}>⚖ Adjust Stock</button>
      </div>
      <div className="card">
        <h3 style={{fontSize: 20, marginBottom: 4}}>{item.name}</h3>
        <p className="text-mut">{item.code || '—'} · {catName}</p>
        <div className="grid grid-3 mt-2">
          <Stat label="In Stock" value={`${item.qty || 0} ${item.unit}`} color="var(--red)" />
          <Stat label="Min Level" value={item.minQty || 0} color="var(--amber)" />
          <Stat label="Rate" value={`₹${(item.rate || 0).toLocaleString()}`} color="var(--blue)" />
          <Stat label="Stock Value" value={`₹${((item.qty || 0) * (item.rate || 0)).toLocaleString()}`} color="var(--green)" />
        </div>
        {item.desc && <p className="mt-2 text-mut">{item.desc}</p>}
      </div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Recent Transactions</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reference</th><th>By</th></tr></thead>
          <tbody>
            {itemTxns.length === 0 && <tr><td colSpan={5} className="text-center text-mut" style={{padding: 20}}>No transactions</td></tr>}
            {itemTxns.map(t => (
              <tr key={t._id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td><span className={`badge ${t.type === 'in' ? 'grn' : t.type === 'out' ? 'red' : 'blu'}`}>{t.type}</span></td>
                <td>{t.qty}</td>
                <td>{t.ref || '—'}</td>
                <td>{t.by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {showAdjust && <AdjustModal item={item} onClose={() => setShowAdjust(false)} />}
      {showEdit && <ItemForm initial={item} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

function AdjustModal({ item, onClose }) {
  const [qty, setQty] = useState(item.qty || 0);
  const [type, setType] = useState('adjust');
  const [ref, setRef] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      await api.post('/api/inventory/transactions', { item: item._id, type, qty: Number(qty), ref });
      toast('Stock updated');
      onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={`Adjust ${item.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Transaction Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="adjust">Set exact quantity (physical count)</option>
          <option value="in">Add stock (received)</option>
          <option value="out">Deduct stock (misc use)</option>
        </select>
        <label className="mt-1">{type === 'adjust' ? 'New Quantity' : 'Quantity Change'}</label>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} required />
        <label className="mt-1">Reference / Reason</label>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. Physical count, PO#123" />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Apply</button>
        </div>
      </form>
    </Modal>
  );
}

function ItemForm({ initial = {}, onClose }) {
  const cats = useStore(s => s.invCategories);
  const locs = useStore(s => s.invLocations);
  const scoped = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ unit: 'nos', division: 'COMMON', ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scoped && !payload.co) payload.co = scoped;
      if (initial._id) await api.put(`/api/inventory/items/${initial._id}`, payload);
      else await api.post('/api/inventory/items', payload);
      toast('Saved');
      onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? 'Edit Item' : 'New Item'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <div style={{flex: 1}}><label>Code</label><input value={data.code || ''} onChange={e => set('code', e.target.value)} /></div>
          <div style={{flex: 2}}><label>Name *</label><input required value={data.name || ''} onChange={e => set('name', e.target.value)} /></div>
        </div>
        <label className="mt-1">Category</label>
        <select value={data.cat || ''} onChange={e => set('cat', e.target.value)}>
          <option value="">— select —</option>
          {cats.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <label className="mt-1">Division *</label>
        <select value={data.division || 'COMMON'} onChange={e => set('division', e.target.value)} required>
          <option value="COMMON">Common (all divisions)</option>
          <option value="HVAC">HVAC only</option>
          <option value="SOLAR">Solar only</option>
          <option value="MEP">MEP only</option>
        </select>
        <label className="mt-1">Default Location</label>
        <select value={data.location || ''} onChange={e => set('location', e.target.value)}>
          <option value="">— select —</option>
          {locs.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
        </select>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Unit</label><input value={data.unit || ''} onChange={e => set('unit', e.target.value)} placeholder="nos, kg, mtr..." /></div>
          <div style={{flex: 1}}><label>Opening Qty</label><input type="number" value={data.qty || 0} onChange={e => set('qty', Number(e.target.value))} /></div>
          <div style={{flex: 1}}><label>Min Level</label><input type="number" value={data.minQty || 0} onChange={e => set('minQty', Number(e.target.value))} /></div>
          <div style={{flex: 1}}><label>Rate</label><input type="number" value={data.rate || 0} onChange={e => set('rate', Number(e.target.value))} /></div>
        </div>
        <label className="mt-1">Description</label>
        <textarea rows={2} value={data.desc || ''} onChange={e => set('desc', e.target.value)} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// -------- Issue Material --------
function IssueMaterial() {
  const issues = useStore(s => s.invIssues);
  const [showForm, setShowForm] = useState(false);
  const open = issues.filter(i => i.status !== 'closed');
  const closed = issues.filter(i => i.status === 'closed');
  return (
    <div>
      <div className="row mb-2">
        <h3 style={{flex: 1, fontSize: 17}}>📤 Issued Material</h3>
        <button className="btn" onClick={() => setShowForm(true)}>+ Issue Material</button>
      </div>
      <IssueTable title={`Open (${open.length})`} rows={open} />
      {closed.length > 0 && <IssueTable title={`Closed (${closed.length})`} rows={closed.slice(0, 50)} />}
      {showForm && <IssueForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

function IssueTable({ title, rows }) {
  return (
    <div className="card">
      <h4 style={{fontSize: 13, color: 'var(--mut)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em'}}>{title}</h4>
      <div className="tw"><table className="data-table">
        <thead><tr><th>Date</th><th>Staff</th><th>Site</th><th>Items</th><th>Status</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-mut" style={{padding: 20}}>No records</td></tr>}
          {rows.map(i => (
            <tr key={i._id}>
              <td className="text-mut text-sm">{new Date(i.createdAt).toLocaleDateString()}</td>
              <td><strong>{i.staff}</strong></td>
              <td>{i.site || '—'}</td>
              <td>{i.items?.length || 0} item(s) · {i.items?.reduce((s, l) => s + (l.qty || 0), 0)} total</td>
              <td><span className={`badge ${i.status === 'closed' ? 'grn' : i.status === 'partial' ? 'amb' : 'blu'}`}>{i.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function IssueForm({ onClose }) {
  const items = useStore(s => s.invItems);
  const scoped = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [staff, setStaff] = useState('');
  const [site, setSite] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ item: '', qty: 1 }]);

  function addLine() { setLines([...lines, { item: '', qty: 1 }]); }
  function setLine(idx, patch) { setLines(lines.map((l, i) => i === idx ? { ...l, ...patch } : l)); }
  function removeLine(idx) { setLines(lines.filter((_, i) => i !== idx)); }

  async function submit(e) {
    e.preventDefault();
    const validLines = lines.filter(l => l.item && l.qty > 0).map(l => {
      const it = items.find(x => String(x._id) === String(l.item));
      return { item: l.item, name: it?.name, qty: Number(l.qty), unit: it?.unit };
    });
    if (!validLines.length) return toast('Add at least one item');
    // Validate stock available
    for (const l of validLines) {
      const it = items.find(x => String(x._id) === String(l.item));
      if ((it?.qty || 0) < l.qty) return toast(`Insufficient stock: ${it?.name} (have ${it?.qty || 0}, need ${l.qty})`);
    }
    try {
      const payload = { staff, site, notes, items: validLines };
      if (user.role === 'super' && scoped) payload.co = scoped;
      await api.post('/api/inventory/issues', payload);
      toast('Material issued');
      onClose();
    } catch (e) { toast(e.message); }
  }

  return (
    <Modal title="Issue Material to Staff" onClose={onClose} maxWidth={720}>
      <form onSubmit={submit}>
        <div className="row">
          <div style={{flex: 1}}><label>Staff Name *</label><input required value={staff} onChange={e => setStaff(e.target.value)} /></div>
          <div style={{flex: 1}}><label>Site / Project</label><input value={site} onChange={e => setSite(e.target.value)} /></div>
        </div>
        <label className="mt-2" style={{fontWeight: 700}}>Items</label>
        {lines.map((l, idx) => {
          const it = items.find(x => String(x._id) === String(l.item));
          return (
            <div key={idx} className="row mb-1" style={{background: '#f8fafc', padding: 10, borderRadius: 6}}>
              <select value={l.item} onChange={e => setLine(idx, { item: e.target.value })} style={{flex: 3}}>
                <option value="">— select item —</option>
                {items.map(i => <option key={i._id} value={i._id}>{i.name} ({i.qty || 0} {i.unit} avail)</option>)}
              </select>
              <input type="number" value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} placeholder="Qty" style={{width: 90}} min={1} />
              {it && <span className="text-sm text-mut" style={{minWidth: 40}}>{it.unit}</span>}
              {lines.length > 1 && <button type="button" className="btn sm" style={{background: 'var(--red)'}} onClick={() => removeLine(idx)}>×</button>}
            </div>
          );
        })}
        <button type="button" className="btn sec sm" onClick={addLine}>+ Add another item</button>
        <label className="mt-2">Notes</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Issue Material</button>
        </div>
      </form>
    </Modal>
  );
}

// -------- Returns: pending + history --------
function Returns() {
  const issues = useStore(s => s.invIssues);
  const pending = issues.flatMap(i => (i.returnRequests || []).filter(r => r.status === 'pending').map(r => ({ ...r, issueId: i._id, staff: i.staff })));
  const handled = issues.flatMap(i => (i.returnRequests || []).filter(r => r.status !== 'pending').map(r => ({ ...r, issueId: i._id, staff: i.staff }))).slice(0, 50);

  return (
    <div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Pending ({pending.length})</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Staff</th><th>Notes</th><th>Requested</th><th style={{width: 180}}>Action</th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan={6} className="text-center text-mut" style={{padding: 20}}>No pending return requests</td></tr>}
            {pending.flatMap(r => r.items.map((it, idx) => (
              <tr key={`${r._id}-${idx}`}>
                <td><strong>{it.name}</strong></td><td>{it.qty} {it.unit}</td><td>{r.staff}</td><td className="text-mut">{r.notes || '—'}</td><td className="text-mut text-sm">{new Date(r.at).toLocaleDateString()}</td>
                <td>
                  <button className="btn sm grn" onClick={() => handleReturn(r.issueId, r._id, 'receive')}>Receive</button>
                  <button className="btn sm" style={{background: 'var(--red)', marginLeft: 6}} onClick={() => handleReturn(r.issueId, r._id, 'reject')}>Reject</button>
                </td>
              </tr>
            )))}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Recent Return History</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Date</th><th>Staff</th><th>Items</th><th>Status</th><th>Handled By</th></tr></thead>
          <tbody>
            {handled.length === 0 && <tr><td colSpan={5} className="text-center text-mut" style={{padding: 20}}>No history</td></tr>}
            {handled.map(r => (
              <tr key={r._id}>
                <td>{new Date(r.handledAt || r.at).toLocaleDateString()}</td>
                <td>{r.staff}</td>
                <td>{r.items?.length || 0} item(s)</td>
                <td><span className={`badge ${r.status === 'received' ? 'grn' : 'red'}`}>{r.status}</span></td>
                <td>{r.handledBy || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// -------- Stock Transfer --------
function StockTransfer() {
  const items = useStore(s => s.invItems);
  const locs = useStore(s => s.invLocations);
  const txns = useStore(s => s.invTransactions || []);
  const scoped = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [itemId, setItemId] = useState('');
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const it = items.find(x => String(x._id) === itemId);
  async function submit(e) {
    e.preventDefault();
    if (!itemId || !toLoc || !qty) return toast('Fill all required fields');
    if (fromLoc === toLoc) return toast('From and To locations must differ');
    try {
      const fromName = locs.find(l => String(l._id) === fromLoc)?.name || '—';
      const toName = locs.find(l => String(l._id) === toLoc)?.name || '—';
      const payload = { item: itemId, type: 'transfer', qty: Number(qty), ref: `${fromName} → ${toName}`, notes };
      if (user.role === 'super' && scoped) payload.co = scoped;
      await api.post('/api/inventory/transactions', payload);
      toast('Transfer logged');
      setItemId(''); setFromLoc(''); setToLoc(''); setQty(1); setNotes('');
    } catch (e) { toast(e.message); }
  }

  const transfers = txns.filter(t => t.type === 'transfer').slice(0, 50);

  return (
    <div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>🔄 Transfer Stock Between Locations</h3>
        <form onSubmit={submit}>
          <label>Item *</label>
          <select required value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">— select item —</option>
            {items.map(i => <option key={i._id} value={i._id}>{i.name} ({i.qty || 0} {i.unit})</option>)}
          </select>
          <div className="row mt-1">
            <div style={{flex: 1}}>
              <label>From Location</label>
              <select value={fromLoc} onChange={e => setFromLoc(e.target.value)}>
                <option value="">— select —</option>
                {locs.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{flex: 1}}>
              <label>To Location *</label>
              <select required value={toLoc} onChange={e => setToLoc(e.target.value)}>
                <option value="">— select —</option>
                {locs.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{width: 120}}>
              <label>Qty *</label>
              <input type="number" required min={1} value={qty} onChange={e => setQty(e.target.value)} />
              {it && <div className="text-sm text-mut">{it.unit}</div>}
            </div>
          </div>
          <label className="mt-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} />
          <button className="btn mt-2" type="submit">Record Transfer</button>
        </form>
      </div>
      <div className="card">
        <h3 style={{fontSize: 15, marginBottom: 12}}>Recent Transfers</h3>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Route</th><th>By</th></tr></thead>
          <tbody>
            {transfers.length === 0 && <tr><td colSpan={5} className="text-center text-mut" style={{padding: 20}}>No transfers</td></tr>}
            {transfers.map(t => {
              const item = items.find(i => String(i._id) === String(t.item));
              return (
                <tr key={t._id}>
                  <td className="text-mut text-sm">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td><strong>{item?.name || 'Unknown'}</strong></td>
                  <td>{t.qty}</td>
                  <td>{t.ref || '—'}</td>
                  <td>{t.by || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// -------- Categories & Locations combined --------
function CategoriesLocations() {
  const cats = useStore(s => s.invCategories);
  const locs = useStore(s => s.invLocations);
  const items = useStore(s => s.invItems);
  const [modal, setModal] = useState(null); // {type:'cat'|'loc', data?}

  async function saveCat(data) {
    try {
      if (data._id) await api.put(`/api/inventory/categories/${data._id}`, data);
      else await api.post('/api/inventory/categories', data);
      toast('Saved'); setModal(null);
    } catch (e) { toast(e.message); }
  }
  async function saveLoc(data) {
    try {
      if (data._id) await api.put(`/api/inventory/locations/${data._id}`, data);
      else await api.post('/api/inventory/locations', data);
      toast('Saved'); setModal(null);
    } catch (e) { toast(e.message); }
  }
  async function delCat(id) { if (confirm('Delete category?')) { await api.del(`/api/inventory/categories/${id}`); toast('Deleted'); } }
  async function delLoc(id) { if (confirm('Delete location?')) { await api.del(`/api/inventory/locations/${id}`); toast('Deleted'); } }

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="row mb-2"><h3 style={{fontSize: 15, flex: 1}}>🗂 Categories</h3><button className="btn sm" onClick={() => setModal({ type: 'cat', data: {} })}>+ Add</button></div>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Items</th><th style={{width: 80}}></th></tr></thead>
          <tbody>
            {cats.length === 0 && <tr><td colSpan={3} className="text-center text-mut" style={{padding: 20}}>No categories</td></tr>}
            {cats.map(c => (
              <tr key={c._id}>
                <td><strong>{c.name}</strong>{c.desc && <div className="text-mut text-sm">{c.desc}</div>}</td>
                <td>{items.filter(i => String(i.cat) === String(c._id)).length}</td>
                <td>
                  <button className="btn sm sec" onClick={() => setModal({ type: 'cat', data: c })}>Edit</button>
                  <button className="btn sm" style={{background: 'var(--red)', marginLeft: 4}} onClick={() => delCat(c._id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="row mb-2"><h3 style={{fontSize: 15, flex: 1}}>📍 Locations</h3><button className="btn sm" onClick={() => setModal({ type: 'loc', data: {} })}>+ Add</button></div>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Items</th><th style={{width: 80}}></th></tr></thead>
          <tbody>
            {locs.length === 0 && <tr><td colSpan={3} className="text-center text-mut" style={{padding: 20}}>No locations</td></tr>}
            {locs.map(l => (
              <tr key={l._id}>
                <td><strong>{l.name}</strong>{l.address && <div className="text-mut text-sm">{l.address}</div>}</td>
                <td>{items.filter(i => String(i.location) === String(l._id)).length}</td>
                <td>
                  <button className="btn sm sec" onClick={() => setModal({ type: 'loc', data: l })}>Edit</button>
                  <button className="btn sm" style={{background: 'var(--red)', marginLeft: 4}} onClick={() => delLoc(l._id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <SimpleForm title={modal.type === 'cat' ? 'Category' : 'Location'} initial={modal.data} onSave={modal.type === 'cat' ? saveCat : saveLoc} onClose={() => setModal(null)} extraField={modal.type === 'loc' ? 'address' : 'desc'} />}
    </div>
  );
}

function SimpleForm({ title, initial, onSave, onClose, extraField }) {
  const [data, setData] = useState({ ...initial });
  return (
    <Modal title={initial._id ? `Edit ${title}` : `New ${title}`} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(data); }}>
        <label>Name *</label>
        <input required value={data.name || ''} onChange={e => setData({ ...data, name: e.target.value })} />
        <label className="mt-1">{extraField === 'address' ? 'Address' : 'Description'}</label>
        <textarea rows={2} value={data[extraField] || ''} onChange={e => setData({ ...data, [extraField]: e.target.value })} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// -------- Transactions Log --------
function Transactions() {
  const items = useStore(s => s.invItems);
  const txns = useStore(s => s.invTransactions || []);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  let list = txns;
  if (type) list = list.filter(t => t.type === type);
  if (q) list = list.filter(t => JSON.stringify(t).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="row mb-2">
        <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
        <select value={type} onChange={e => setType(e.target.value)} style={{maxWidth: 180}}>
          <option value="">All types</option>
          <option value="in">Stock In</option>
          <option value="out">Stock Out</option>
          <option value="adjust">Adjustment</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>
      <div className="card">
        <div className="tw"><table className="data-table">
          <thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th><th>Reference</th><th>By</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="text-center text-mut" style={{padding: 40}}>No transactions</td></tr>}
            {list.slice(0, 200).map(t => {
              const item = items.find(i => String(i._id) === String(t.item));
              return (
                <tr key={t._id}>
                  <td className="text-mut text-sm">{new Date(t.createdAt).toLocaleString()}</td>
                  <td><span className={`badge ${t.type === 'in' ? 'grn' : t.type === 'out' ? 'red' : 'blu'}`}>{t.type}</span></td>
                  <td><strong>{item?.name || 'Unknown'}</strong></td>
                  <td>{t.qty}</td>
                  <td>{t.ref || '—'}</td>
                  <td>{t.by || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// -------- Shared Stat card --------
function Stat({ label, value, color }) {
  return (
    <div className="stat-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div>
        <div className="text-mut text-sm">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}
