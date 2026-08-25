import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import { toast } from '../components/Toast';
import { api } from '../api/client';

const STATUS_BADGE = { pending: 'amb', partial: 'blu', paid: 'grn', overdue: 'red' };

export default function Payments() {
  const payments = useStore(s => s.payments);
  const user = useStore(s => s.user);
  const scopedCompany = useStore(s => s.scopedCompany);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const isSuper = user?.role === 'super';
  let list = payments;
  if (isSuper && scopedCompany) list = list.filter(p => String(p.co) === String(scopedCompany));
  if (filter === 'pending') list = list.filter(p => p.status !== 'paid');
  else if (filter !== 'all') list = list.filter(p => p.status === filter);
  if (q) list = list.filter(p => JSON.stringify(p).toLowerCase().includes(q.toLowerCase()));

  const totalBilled = list.reduce((s, p) => s + (p.amount || 0), 0);
  const totalCollected = list.reduce((s, p) => s + (p.paid || []).reduce((x, pp) => x + (pp.amt || 0), 0), 0);
  const outstanding = totalBilled - totalCollected;

  return (
    <div>
      <div className="main-header">
        <h2>💰 Payments</h2>
        <button className="btn" onClick={() => setEditing({})}>+ New Invoice</button>
      </div>
      <div className="grid grid-3 mb-2">
        <Stat label="Total Billed" value={`₹${totalBilled.toLocaleString()}`} color="var(--blue)" />
        <Stat label="Collected" value={`₹${totalCollected.toLocaleString()}`} color="var(--green)" />
        <Stat label="Outstanding" value={`₹${outstanding.toLocaleString()}`} color="var(--red)" />
      </div>
      <div className="card">
        <div className="row mb-2">
          <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{flex: 1}} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{maxWidth: 180}}>
            <option value="all">All</option>
            <option value="pending">Pending Only</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <div className="tw"><table className="data-table">
          <thead><tr><th>Inv #</th><th>Client</th><th>Amount</th><th>Received</th><th>Balance</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="text-center text-mut" style={{padding: 40}}>No payments</td></tr>}
            {list.map(p => {
              const received = (p.paid || []).reduce((s, x) => s + (x.amt || 0), 0);
              const balance = (p.amount || 0) - received;
              const overdue = p.due && new Date(p.due) < new Date() && balance > 0;
              return (
                <tr key={p._id} onClick={() => setSelected(p)} style={{cursor: 'pointer'}}>
                  <td><strong>{p.invNo || '—'}</strong></td>
                  <td>{p.client}</td>
                  <td>{(p.amount || 0).toLocaleString()}</td>
                  <td className="text-green">{received.toLocaleString()}</td>
                  <td className={balance > 0 ? 'text-red' : ''}><strong>{balance.toLocaleString()}</strong></td>
                  <td className={overdue ? 'text-red' : ''}>{p.due ? new Date(p.due).toLocaleDateString() : '—'}</td>
                  <td><span className={`badge ${overdue ? 'red' : STATUS_BADGE[p.status] || ''}`}>{overdue ? 'overdue' : p.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {selected && !editing && <PaymentDetail payment={selected} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} />}
      {editing && <PaymentForm initial={editing} onClose={() => { setEditing(null); setSelected(null); }} />}
    </div>
  );
}

function PaymentDetail({ payment, onClose, onEdit }) {
  const [showRecord, setShowRecord] = useState(false);
  const received = (payment.paid || []).reduce((s, x) => s + (x.amt || 0), 0);
  const balance = (payment.amount || 0) - received;
  return (
    <>
      <Modal title={`Invoice ${payment.invNo || '—'}`} onClose={onClose} maxWidth={640}>
        <div style={{fontSize: 14}}>
          <div className="row"><strong style={{width: 100}}>Client:</strong> <span>{payment.client}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Inv Date:</strong> <span>{payment.invDate ? new Date(payment.invDate).toLocaleDateString() : '—'}</span></div>
          <div className="row mt-1"><strong style={{width: 100}}>Due:</strong> <span>{payment.due ? new Date(payment.due).toLocaleDateString() : '—'}</span></div>
          <div className="grid grid-3 mt-2">
            <Stat label="Amount" value={`₹${(payment.amount || 0).toLocaleString()}`} color="var(--blue)" />
            <Stat label="Received" value={`₹${received.toLocaleString()}`} color="var(--green)" />
            <Stat label="Balance" value={`₹${balance.toLocaleString()}`} color={balance > 0 ? 'var(--red)' : 'var(--green)'} />
          </div>

          <h4 style={{fontSize: 13, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 20, marginBottom: 8}}>Payment History</h4>
          {(payment.paid || []).length === 0 && <p className="text-mut">No payments recorded</p>}
          {(payment.paid || []).slice().reverse().map((p, i) => (
            <div key={i} style={{padding: '6px 0', borderBottom: '1px solid var(--line)'}}>
              <div className="row">
                <strong style={{flex: 1}}>₹{(p.amt || 0).toLocaleString()}</strong>
                <span className="text-mut text-sm">{new Date(p.at).toLocaleDateString()}</span>
              </div>
              <div className="text-sm text-mut">{p.mode || '—'} {p.ref && `· ref: ${p.ref}`} · by {p.by || '—'}</div>
            </div>
          ))}
          {payment.notes && <div className="mt-2"><strong>Notes:</strong> <span className="text-mut">{payment.notes}</span></div>}
        </div>
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16, flexWrap: 'wrap'}}>
          {balance > 0 && <button className="btn grn" onClick={() => setShowRecord(true)}>+ Record Payment</button>}
          <button className="btn sec" onClick={onEdit}>✏ Edit</button>
        </div>
      </Modal>
      {showRecord && <RecordPayment payment={payment} balance={balance} onClose={() => setShowRecord(false)} />}
    </>
  );
}

function RecordPayment({ payment, balance, onClose }) {
  const [data, setData] = useState({ amt: balance, mode: 'bank', ref: '' });
  async function submit(e) {
    e.preventDefault();
    try { await api.post(`/api/payments/${payment._id}/paid`, data); toast('Payment recorded'); onClose(); }
    catch (e) { toast(e.message); }
  }
  return (
    <Modal title="Record Payment" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-mut text-sm mb-2">Outstanding: <strong>₹{balance.toLocaleString()}</strong></p>
        <label>Amount ₹ *</label>
        <input type="number" required min={1} max={balance} value={data.amt} onChange={e => setData({...data, amt: Number(e.target.value)})} />
        <label className="mt-1">Payment Mode</label>
        <select value={data.mode} onChange={e => setData({...data, mode: e.target.value})}>
          <option value="bank">Bank Transfer</option>
          <option value="cheque">Cheque</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="card">Card</option>
        </select>
        <label className="mt-1">Reference (Txn ID / Cheque No)</label>
        <input value={data.ref} onChange={e => setData({...data, ref: e.target.value})} />
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
          <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn grn">Save Payment</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentForm({ initial, onClose }) {
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [data, setData] = useState({ status: 'pending', ...initial });
  function set(k, v) { setData(d => ({ ...d, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    try {
      const payload = { ...data };
      if (user.role === 'super' && scopedCompany && !payload.co) payload.co = scopedCompany;
      if (initial._id) await api.put(`/api/payments/${initial._id}`, payload);
      else await api.post('/api/payments', payload);
      toast('Saved'); onClose();
    } catch (e) { toast(e.message); }
  }
  return (
    <Modal title={initial._id ? 'Edit Invoice' : 'New Invoice'} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Client *</label>
        <input required value={data.client || ''} onChange={e => set('client', e.target.value)} />
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Invoice #</label><input value={data.invNo || ''} onChange={e => set('invNo', e.target.value)} /></div>
          <div style={{flex: 1}}><label>Invoice Date</label><input type="date" value={data.invDate ? new Date(data.invDate).toISOString().slice(0,10) : ''} onChange={e => set('invDate', e.target.value)} /></div>
        </div>
        <div className="row mt-1">
          <div style={{flex: 1}}><label>Amount ₹ *</label><input type="number" required value={data.amount || 0} onChange={e => set('amount', Number(e.target.value))} /></div>
          <div style={{flex: 1}}><label>Due Date</label><input type="date" value={data.due ? new Date(data.due).toISOString().slice(0,10) : ''} onChange={e => set('due', e.target.value)} /></div>
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

function Stat({ label, value, color }) {
  return (
    <div className="stat-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div><div className="text-mut text-sm">{label}</div><div className="stat-value">{value}</div></div>
    </div>
  );
}
