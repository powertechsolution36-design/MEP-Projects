import { useState, useEffect } from 'react';
import { API_BASE, getToken } from '../api/client';
import { useStore } from '../store/useStore';
import Modal from './Modal';
import { toast } from './Toast';

export default function ReportDownload({ module: fixedModule, label: fixedLabel, buttonClass = 'btn sec' }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [format, setFormat] = useState('xlsx');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [module, setModule] = useState(fixedModule || '');
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const scopedCompany = useStore(s => s.scopedCompany);

  useEffect(() => {
    if (!open || fixedModule) return;
    fetch(`${API_BASE}/api/reports/modules`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { setModules(d.modules || []); if (!module && d.modules?.length) setModule(d.modules[0].key); })
      .catch(() => {});
  }, [open]);

  async function download() {
    if (!module) return toast('Pick a report module');
    if (period === 'custom' && (!from || !to)) return toast('Pick From and To dates');
    setLoading(true);
    try {
      const params = new URLSearchParams({ module, period, format });
      if (period === 'custom') { params.set('from', from); params.set('to', to); }
      if (scopedCompany) params.set('co', scopedCompany);
      const res = await fetch(`${API_BASE}/api/reports/download?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const filename = /filename="?([^"]+)"?/.exec(cd)?.[1] || `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Report downloaded');
      setOpen(false);
    } catch (e) { toast(e.message || 'Download failed'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <button className={buttonClass} onClick={() => setOpen(true)} title="Download Report">📥 Report</button>
      {open && (
        <Modal title={`Download ${fixedLabel || 'Report'}`} onClose={() => setOpen(false)} maxWidth={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!fixedModule && (
              <div>
                <label>Report Type</label>
                <select value={module} onChange={e => setModule(e.target.value)}>
                  {modules.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label>Period</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{v:'daily',l:'Daily (Today)'},{v:'weekly',l:'Weekly (7 days)'},{v:'monthly',l:'Monthly (30 days)'},{v:'custom',l:'Custom'}].map(o => (
                  <button key={o.v} type="button" className={`btn ${period === o.v ? '' : 'sec'}`} onClick={() => setPeriod(o.v)} style={{ flex: '1 1 auto', minWidth: 100 }}>{o.l}</button>
                ))}
              </div>
            </div>
            {period === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
                <div><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
              </div>
            )}
            <div>
              <label>Format</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`btn ${format === 'xlsx' ? '' : 'sec'}`} onClick={() => setFormat('xlsx')} style={{ flex: 1 }}>📊 Excel (.xlsx)</button>
                <button type="button" className={`btn ${format === 'csv' ? '' : 'sec'}`} onClick={() => setFormat('csv')} style={{ flex: 1 }}>📄 CSV</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn sec" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn" onClick={download} disabled={loading}>{loading ? 'Generating...' : 'Download'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
