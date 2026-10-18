/**
 * Super Admin platform helpers — exact ports of the PWA's helpers
 * (MEP_PROJECTS_PWA/index.html):
 *   mrr(c)        1681   collected(c) 1682-1687   expiring30() 1417-1423
 *   coDivs(c)     1215   dlCSV(rows)  3460-3466 (BOM + CRLF, all cells quoted)
 */
import { fmtDate } from './format';

const ALL_DIVS = ['HVAC', 'Solar', 'MEP'];

export function coDivs(c) {
  return c && Array.isArray(c.divisions) && c.divisions.length ? c.divisions : ALL_DIVS;
}

export function mrr(c) {
  if (c.status !== 'Active' || !c.subscriptionRate) return 0;
  return c.subscriptionCycle === 'Yearly' ? c.subscriptionRate / 12 : c.subscriptionRate;
}

export function collected(c) {
  if (c.status !== 'Active' || !c.subscriptionRate || !c.subscriptionStart) return 0;
  const days = (Date.now() - new Date(c.subscriptionStart).getTime()) / 86400000;
  if (days < 0) return 0;
  if (c.subscriptionCycle === 'Yearly') return c.subscriptionRate * Math.max(1, Math.ceil(days / 365));
  return c.subscriptionRate * Math.max(1, Math.ceil(days / 30.44));
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Active with a subscription end within 30 days, or Trial ending within 30 days. */
export function expiring30(companies) {
  const t = todayKey();
  const lim = addDaysKey(t, 30);
  return companies.filter((c) => {
    if (c.status === 'Active' && c.subscriptionEnd) {
      const e = fmtDate(c.subscriptionEnd);
      return e >= t && e <= lim;
    }
    if (c.status === 'Trial' && c.trialEnd) return fmtDate(c.trialEnd) <= lim;
    return false;
  });
}

export function firstContact(c) {
  const ct = (c.contacts || [])[0] || {};
  return { name: ct.name || ct.n || '', phone: ct.phone || ct.ph || '' };
}

export function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* PWA FACT: dlReport(type, period) rows (index.html:1564-1590). */
function dk(v) { return v ? fmtDate(v) : ''; }

export function buildRevenueRows(companies, period) {
  const rows = [['Company', 'City', 'GST No', 'Divisions', 'Status', 'Billing Cycle', 'Rate (₹)', 'Monthly Equivalent (₹)', 'Subscription Start', 'Subscription End', period === 'all' ? 'Collected Total (₹)' : 'Period Revenue (₹)']];
  let tot = 0;
  companies.forEach((c) => {
    const v = period === 'month' ? mrr(c) : period === 'year' ? mrr(c) * 12 : collected(c);
    tot += v;
    rows.push([c.name, c.city || '', c.gstNumber || '', coDivs(c).join(' + '), c.status, c.subscriptionCycle || '', c.subscriptionRate || 0, Math.round(mrr(c)), dk(c.subscriptionStart), dk(c.subscriptionEnd), Math.round(v)]);
  });
  rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', Math.round(tot)]);
  return rows;
}

export function buildSubscriberRows(companies, period) {
  const t = todayKey();
  const tm = t.slice(0, 7);
  const ty = t.slice(0, 4);
  const list = companies.filter((c) => {
    const since = dk(c.since);
    if (period === 'month') return since.slice(0, 7) === tm;
    if (period === 'year') return since.slice(0, 4) === ty;
    return true;
  });
  const rows = [['Company', 'City', 'Address', 'GST No', 'Divisions', 'Status', 'Joined', 'Trial End', 'Subscription Start', 'Subscription End', 'Contact 1', 'Phone 1', 'Contact 2', 'Phone 2', 'Email']];
  ['Active', 'Trial', 'Suspended'].forEach((st) => {
    list.filter((c) => c.status === st).forEach((c) => {
      const ct = c.contacts || [];
      const c0 = ct[0] || {};
      const c1 = ct[1] || {};
      rows.push([c.name, c.city || '', c.address || '', c.gstNumber || '', coDivs(c).join(' + '), c.status, dk(c.since), dk(c.trialEnd), dk(c.subscriptionStart), dk(c.subscriptionEnd), c0.name || '', c0.phone || '', c1.name || '', c1.phone || '', c.email || '']);
    });
  });
  return rows;
}

