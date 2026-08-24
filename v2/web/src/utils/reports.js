// Reports & CSV export helpers

// Date range presets — returns [startISO, endISO]
export function getPresetRange(preset) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start;
  switch (preset) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return [y.toISOString(), new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59).toISOString()];
    }
    case 'week': {
      const d = now.getDay(); // 0 = Sun
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      break;
    }
    case 'last-week': {
      const d = now.getDay();
      const monEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d - 1, 23, 59, 59);
      const monStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d - 7);
      return [monStart.toISOString(), monEnd.toISOString()];
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last-month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return [s.toISOString(), e.toISOString()];
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case 'all':
    default:
      return [null, null];
  }
  return [start.toISOString(), end.toISOString()];
}

export function filterByDateRange(items, start, end, dateKey = 'createdAt') {
  if (!start && !end) return items;
  const s = start ? new Date(start).getTime() : -Infinity;
  const e = end ? new Date(end).getTime() : Infinity;
  return items.filter(it => {
    const t = new Date(it[dateKey]).getTime();
    return t >= s && t <= e;
  });
}

// Convert array of objects → CSV string. columns = [{key, label, render?}]
export function toCSV(rows, columns) {
  const header = columns.map(c => `"${(c.label || c.key).replace(/"/g, '""')}"`).join(',');
  const body = rows.map(row => columns.map(c => {
    let v = c.render ? c.render(row[c.key], row) : row[c.key];
    if (v === null || v === undefined) v = '';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
    return `"${v}"`;
  }).join(',')).join('\n');
  return header + '\n' + body;
}

export function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
