import { useState } from 'react';
import { useStore } from '../store/useStore';
import Modal from '../components/Modal';
import ReportDownload from '../components/ReportDownload';
import { toast } from '../components/Toast';
import { api } from '../api/client';

export default function LostEnquiries() {
  const enquiries = useStore(s => s.enquiries);
  const scopedCompany = useStore(s => s.scopedCompany);
  const user = useStore(s => s.user);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const isSuper = user?.role === 'super';
  let list = enquiries.filter(e => e.status === 'lost');
  if (isSuper && scopedCompany) list = list.filter(e => String(e.co) === String(scopedCompany));
  if (q) list = list.filter(e => JSON.stringify(e).toLowerCase().includes(q.toLowerCase()));

  async function reopen(e) {
    if (!confirm(`Reopen enquiry from ${e.client}?`)) return;
    try {
      await api.put(`/api/enquiries/${e._id}`, { status: 'new' });
      toast('Reopened');
    } catch (err) { toast(err.message); }
  }

  return (
    <div>
      <div className="main-header">
        <h2>❌ Lost Enquiries</h2>
        <span className="text-mut text-sm">{list.length} record(s)</span>
      <ReportDownload module="enquiries" label="Lost Enquiries" /></div>
      <div className="card">
        <input placeholder="Search lost enquiries..." value={q} onChange={e => setQ(e.target.value)} style={{marginBottom: 12}} />
        <div className="tw"><table className="data-table">
          <thead><tr><th>Client</th><th>Subject</th><th>Est. Value</th><th>Owner</th><th>Lost On</th><th>Reason</th><th style={{width: 160}}>Action</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="text-center text-mut" style={{padding: 40}}>No lost enquiries</td></tr>}
            {list.map(e => {
              const lastLog = (e.log || []).slice().reverse().find(l => l.action === 'lost');
              return (
                <tr key={e._id} onClick={() => setSelected(e)} style={{cursor: 'pointer'}}>
                  <td><strong>{e.client}</strong></td>
                  <td>{e.subject || '—'}</td>
                  <td>{(e.value || 0).toLocaleString()}</td>
                  <td>{e.owner || '—'}</td>
                  <td className="text-mut text-sm">{lastLog ? new Date(lastLog.at).toLocaleDateString() : '—'}</td>
                  <td className="text-mut">{lastLog?.note || '—'}</td>
                  <td onClick={ev => ev.stopPropagation()}>
                    <button className="btn sm grn" onClick={() => reopen(e)}>↺ Reopen</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {selected && (
        <Modal title={selected.client} onClose={() => setSelected(null)} maxWidth={560}>
          <div style={{fontSize: 14}}>
            <div><strong>Subject:</strong> {selected.subject || '—'}</div>
            <div className="mt-1"><strong>Contact:</strong> {selected.contact || '—'} · {selected.phone || '—'}</div>
            <div className="mt-1"><strong>Value:</strong> ₹{(selected.value || 0).toLocaleString()}</div>
            <div className="mt-1"><strong>Description:</strong><br/>{selected.desc || '—'}</div>
            <h4 className="mt-2" style={{fontSize: 13, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Follow-up log</h4>
            <div className="mt-1">
              {(selected.log || []).length === 0 && <p className="text-mut">No log entries</p>}
              {(selected.log || []).slice().reverse().map((l, i) => (
                <div key={i} style={{padding: '8px 0', borderBottom: '1px solid var(--line)'}}>
                  <div className="text-sm"><strong>{l.action || 'note'}</strong> · <span className="text-mut">{l.by}</span> · <span className="text-mut">{new Date(l.at).toLocaleString()}</span></div>
                  {l.note && <div className="text-sm text-mut mt-1">{l.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
