import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { draft: 'amb', confirmed: 'blu', delivered: 'grn', cancelled: 'red' };

export default function SalesOrders() {
  const orders = useStore(s => s.salesOrders);
  const user = useStore(s => s.user);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');

  const isSuper = user?.role === 'super';
  let list = orders;
  if (isSuper && scopedCompany) list = list.filter(o => String(o.co) === String(scopedCompany));
  if (statusF) list = list.filter(o => o.status === statusF);
  if (q) list = list.filter(o => JSON.stringify(o).toLowerCase().includes(q.toLowerCase()));

  const total = list.reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div>
      <div className="main-header">
        <div>
          <h2>🧾 Sales Orders</h2>
          <div className="text-sm text-mut">{list.length} orders · ₹{total.toLocaleString()}</div>
        </div>
        <button className="btn" onClick={() => setEditing({})}>+ New SO</button>
      </div>
      <div className="card">
        <div className="row mb-2">
          <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{maxWidth: 160}}>
            <option value="">All</option><option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="tw"><table className="data-table">
          <thead><tr><th>SO #</th><th>Client</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="text-center text-mut" style={{padding: 40}}>No sales orders</td></tr>}
            {list.map(o => (
              <tr key={o._id} onClick={() => setSelected(o)} style={{cursor: 'pointer'}}>
                <td><strong>{o.no}</strong></td>
                <td>{o.client}</td>
                <td>{o.date ? new Date(o.date).toLocaleDateString() : '—'}</td>
                <td>{(o.items || []).length}</td>
                <td>₹{(o.total || 0).toLocaleString()}</td>
                <td><span className={`badge ${STATUS_BADGE[o.status] || ''}`}>{o.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {selected && !editing && <SODetail order={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
      {editing && <SOForm initial={editing} onClose={() => { setEditing(null); setSelected(null); }} />}
    </div>
  );
}

function SODetail({ order, onClose, onEdit }) {
  return (
    <Modal title={`SO #${order.no} · ${order.client}`} onClose={onClose} maxWidth={720}>
      <div style={{fontSize: 14}}>
        <div className="row"><strong style={{width: 100}}>Date:</strong> <span>{order.date ? new Date(order.date).toLocaleDateString() : '—'}</span></div>
        <div className="row mt-1"><strong style={{width: 100}}>Contact:</strong> <span>{order.contact || '—'}</span></div>
        <div className="row mt-1"><strong style={{width: 100}}>Status:</strong> <span className={`badge ${STATUS_BADGE[order.status]}`}>{order.status}</span></div>
        <h4 style={{fontSize: 13, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 16, marginBottom: 8}}>Items</h4>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {(order.items || []).map((it, i) => (
              <tr key={i}><td>{it.desc}</td><td>{it.qty}</td><td>{it.unit}</td><td>{(it.rate || 0).toLocaleString()}</td><td>{(it.amount || 0).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table></div>
        <div className="mt-2" style={{textAlign: 'right'}}>
          <div>Subtotal: ₹{(order.subtotal || 0).toLocaleString()}</div>
          <div>Tax: ₹{(order.tax || 0).toLocaleString()}</div>
          <div style={{fontSize: 18, marginTop: 4}}><strong>Total: ₹{(order.total || 0).toLocaleString()}</strong></div>
        </div>
        {order.notes && <div className="mt-2"><strong>Notes:</strong><div className="mt-1 text-mut">{order.notes}</div></div>}
      </div>
      <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16}}>
        <button className="btn sec" onClick={onEdit}>✏ Edit</button>
      </div>
    </Modal>
  );
}

function SOForm({ initial, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ date: new Date().toISOString().slice(0,10), status: 'draft', items: [{desc:'',qty:1,unit:'nos',rate:0}], tax: 0, ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  function setItem(i, k, v) { set('items', data.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it)); }
  function addItem() { set('items', [...(data.items || []), {desc:'',qty:1,unit:'nos',rate:0}]); }
  function removeItem(i) { set('items', data.items.filter((_, idx) => idx !== i)); }

  const subtotal = (data.items || []).reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const total = subtotal + (Number(data.tax) || 0);

  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (initial._id) await api.put(`/api/sales-orders/${initial._id}`, payload);
      else await api.post('/api/sales-orders', payload);
      toast('Saved'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? `Edit SO #${initial.no}` : 'New Sales Order'} onClose={onClose} maxWidth={780}>
      <form onSubmit={submit}>
        <div className="row">
          <div style={{flex: 2}}><label>Client *</label><input required value={data.client || ''} onChange={e => set('client', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Contact</label><input value={data.contact || ''} onChange={e => set('contact', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Date</label><input type="date" value={data.date ? new Date(data.date).toISOString().slice(0,10) : ''} onChange={e => set('date', e.target.value)} /></div>
        </div>
        <label className="mt-2" style={{fontWeight: 700}}>Items</label>
        {(data.items || []).map((it, i) => (
          <div key={i} className="row mb-1" style={{background: '#f8fafc', padding: 8, borderRadius: 6}}>
            <input placeholder="Description" value={it.desc} onChange={e => setItem(i, 'desc', e.target.value)} style={{flex: 3}} required />
            <input type="number" placeholder="Qty" value={it.qty} onChange={e => setItem(i, 'qty', Number(e.target.value))} style={{width: 80}} min={1} />
            <input placeholder="Unit" value={it.unit} onChange={e => setItem(i, 'unit', e.target.value)} style={{width: 80}} />
            <input type="number" placeholder="Rate" value={it.rate} onChange={e => setItem(i, 'rate', Number(e.target.value))} style={{width: 100}} />
            <span style={{width: 100, textAlign: 'right', paddingTop: 8, fontWeight: 600}}>₹{((it.qty || 0) * (it.rate || 0)).toLocaleString()}</span>
            {data.items.length > 1 && <button type="button" className="btn sm" style={{background: 'var(--red)'}} onClick={() => removeItem(i)}>×</button>}
          </div>
        ))}
        <button type="button" className="btn sec sm" onClick={addItem}>+ Add item</button>
        <div className="row mt-2">
          <div style={{flex: 1}}><label>Tax ₹</label><input type="number" value={data.tax || 0} onChange={e => set('tax', Number(e.target.value))} /></div>
          <div style={{flex: 1}}><label>Status</label>
            <select value={data.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft</option><option value="confirmed">Confirmed</option>
              <option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div style={{flex: 1, textAlign: 'right', paddingTop: 8}}>
            <div className="text-sm">Subtotal: ₹{subtotal.toLocaleString()}</div>
            <div style={{fontSize: 18, fontWeight: 700}}>Total: ₹{total.toLocaleString()}</div>
          </div>
        </div>
        <label className="mt-2">Notes</label>
        <textarea rows={2} value={data.notes || ''} onChange={e => set('notes', e.target.value)} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
