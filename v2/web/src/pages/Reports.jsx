import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getPresetRange, filterByDateRange, toCSV, downloadCSV } from '../utils/reports';
import { toast } from '../components/Toast';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

const MODULES = [
  { key: 'projects', label: 'Projects', dateKey: 'createdAt', cols: [
    {key:'name',label:'Name'},{key:'client',label:'Client'},{key:'div',label:'Division'},
    {key:'status',label:'Status'},{key:'value',label:'Value'},{key:'pm',label:'PM'},{key:'createdAt',label:'Created'},
  ]},
  { key: 'serviceCalls', label: 'Service Calls', dateKey: 'createdAt', cols: [
    {key:'psc',label:'PSC#'},{key:'client',label:'Client'},{key:'type',label:'Type'},
    {key:'priority',label:'Priority'},{key:'status',label:'Status'},{key:'eng',label:'Engineer'},{key:'createdAt',label:'Created'},
  ]},
  { key: 'contracts', label: 'Contracts', dateKey: 'createdAt', cols: [
    {key:'client',label:'Client'},{key:'type',label:'Type'},{key:'value',label:'Value'},
    {key:'start',label:'Start'},{key:'end',label:'End'},{key:'status',label:'Status'},
  ]},
  { key: 'payments', label: 'Payments', dateKey: 'createdAt', cols: [
    {key:'client',label:'Client'},{key:'invNo',label:'Inv#'},{key:'amount',label:'Amount'},
    {key:'due',label:'Due'},{key:'status',label:'Status'},{key:'createdAt',label:'Created'},
  ]},
  { key: 'enquiries', label: 'Enquiries', dateKey: 'createdAt', cols: [
    {key:'client',label:'Client'},{key:'subject',label:'Subject'},{key:'source',label:'Source'},
    {key:'value',label:'Value'},{key:'owner',label:'Owner'},{key:'status',label:'Status'},
  ]},
  { key: 'salesOrders', label: 'Sales Orders', dateKey: 'date', cols: [
    {key:'no',label:'No'},{key:'client',label:'Client'},{key:'date',label:'Date'},
    {key:'total',label:'Total'},{key:'status',label:'Status'},
  ]},
  { key: 'invItems', label: 'Inventory Items', dateKey: 'createdAt', cols: [
    {key:'code',label:'Code'},{key:'name',label:'Name'},{key:'qty',label:'Qty'},
    {key:'minQty',label:'Min'},{key:'rate',label:'Rate'},{key:'unit',label:'Unit'},
  ]},
  { key: 'users', label: 'Users', dateKey: 'createdAt', cols: [
    {key:'name',label:'Name'},{key:'un',label:'Username'},{key:'role',label:'Role'},
    {key:'email',label:'Email'},{key:'phone',label:'Phone'},
  ]},
];

export default function Reports() {
  const s = useStore();
  const [preset, setPreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [start, end] = useMemo(() => {
    if (preset === 'custom') return [
      customStart ? new Date(customStart).toISOString() : null,
      customEnd ? new Date(customEnd + 'T23:59:59').toISOString() : null,
    ];
    return getPresetRange(preset);
  }, [preset, customStart, customEnd]);

  function downloadOne(m) {
    let items = s[m.key] || [];
    // Scope by company for super admin
    if (s.user?.role === 'super' && s.scopedCompany) {
      items = items.filter(i => String(i.co) === String(s.scopedCompany));
    }
    const filtered = filterByDateRange(items, start, end, m.dateKey);
    if (!filtered.length) return toast(`No ${m.label} in this range`);
    const csv = toCSV(filtered, m.cols);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`${m.label.replace(/\s+/g, '_')}_${preset}_${stamp}.csv`, csv);
    toast(`Downloaded ${filtered.length} rows`);
  }

  function downloadAll() {
    let count = 0;
    MODULES.forEach(m => {
      let items = s[m.key] || [];
      if (s.user?.role === 'super' && s.scopedCompany) {
        items = items.filter(i => String(i.co) === String(s.scopedCompany));
      }
      const filtered = filterByDateRange(items, start, end, m.dateKey);
      if (!filtered.length) return;
      const csv = toCSV(filtered, m.cols);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCSV(`${m.label.replace(/\s+/g, '_')}_${preset}_${stamp}.csv`, csv);
      count += filtered.length;
    });
    toast(`Exported ${count} rows across all modules`);
  }

  function count(m) {
    let items = s[m.key] || [];
    if (s.user?.role === 'super' && s.scopedCompany) {
      items = items.filter(i => String(i.co) === String(s.scopedCompany));
    }
    return filterByDateRange(items, start, end, m.dateKey).length;
  }

  return (
    <div>
      <div className="main-header"><h2>Reports & Exports</h2></div>

      <div className="card">
        <div className="row">
          <div style={{flex: 1, minWidth: 200}}>
            <label>Date Range</label>
            <select value={preset} onChange={e => setPreset(e.target.value)}>
              {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {preset === 'custom' && (
            <>
              <div style={{flex: 1, minWidth: 140}}>
                <label>From</label>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div style={{flex: 1, minWidth: 140}}>
                <label>To</label>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            </>
          )}
          <div style={{alignSelf: 'flex-end'}}>
            <button className="btn grn" onClick={downloadAll}>⬇ Download All</button>
          </div>
        </div>
        {start && <p className="text-mut text-sm mt-2">Range: {new Date(start).toLocaleDateString()} → {end ? new Date(end).toLocaleDateString() : 'now'}</p>}
      </div>

      <div className="grid grid-3 mt-2">
        {MODULES.map(m => (
          <div key={m.key} className="card">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <div>
                <div className="text-mut text-sm">{m.label}</div>
                <div className="text-xl" style={{fontSize: 24, marginTop: 4}}>{count(m)}</div>
              </div>
              <button className="btn sm" onClick={() => downloadOne(m)}>⬇ CSV</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
