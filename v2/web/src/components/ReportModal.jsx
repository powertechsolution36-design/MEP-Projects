import { useState, useMemo } from 'react';
import Modal from './Modal';
import { getPresetRange, filterByDateRange, toCSV, downloadCSV } from '../utils/reports';
import { toast } from './Toast';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

export default function ReportModal({ title, items, columns, onClose }) {
  const [preset, setPreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [dateKey, setDateKey] = useState('createdAt');

  const [start, end] = useMemo(() => {
    if (preset === 'custom') {
      return [customStart ? new Date(customStart).toISOString() : null,
              customEnd ? new Date(customEnd + 'T23:59:59').toISOString() : null];
    }
    return getPresetRange(preset);
  }, [preset, customStart, customEnd]);

  const filtered = useMemo(() => filterByDateRange(items, start, end, dateKey), [items, start, end, dateKey]);

  function download() {
    if (!filtered.length) return toast('No records in this range');
    const cols = [...columns];
    // Always include createdAt for reports
    if (!cols.find(c => c.key === 'createdAt')) cols.push({ key: 'createdAt', label: 'Created' });
    const csv = toCSV(filtered, cols);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`${title.replace(/\s+/g, '_')}_${preset}_${stamp}.csv`, csv);
    toast(`Downloaded ${filtered.length} rows`);
  }

  return (
    <Modal title={`Download ${title} Report`} onClose={onClose}>
      <label>Date Range</label>
      <select value={preset} onChange={e => setPreset(e.target.value)}>
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>

      {preset === 'custom' && (
        <div className="row mt-1">
          <div style={{flex: 1}}>
            <label>From</label>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
          </div>
          <div style={{flex: 1}}>
            <label>To</label>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
          </div>
        </div>
      )}

      <label className="mt-2">Filter By Field</label>
      <select value={dateKey} onChange={e => setDateKey(e.target.value)}>
        <option value="createdAt">Created Date</option>
        <option value="updatedAt">Last Updated</option>
        <option value="date">Record Date</option>
        <option value="due">Due Date</option>
      </select>

      <div className="card mt-2" style={{background: '#f8fafc', padding: 14}}>
        <div className="text-mut text-sm">Preview</div>
        <div className="text-xl" style={{fontSize: 22, marginTop: 4}}>{filtered.length} records</div>
        {start && <div className="text-mut text-sm mt-1">From: {new Date(start).toLocaleDateString()}</div>}
        {end && <div className="text-mut text-sm">To: {new Date(end).toLocaleDateString()}</div>}
      </div>

      <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
        <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
        <button type="button" className="btn grn" onClick={download}>⬇ Download CSV</button>
      </div>
    </Modal>
  );
}
