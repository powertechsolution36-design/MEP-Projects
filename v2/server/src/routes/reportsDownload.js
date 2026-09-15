const router = require('express').Router();
const ExcelJS = require('exceljs');
const { auth } = require('../middleware/auth');
const Enquiry = require('../models/Enquiry');
const SalesOrder = require('../models/SalesOrder');
const Project = require('../models/Project');
const ServiceCall = require('../models/ServiceCall');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const InvItem = require('../models/InvItem');
const InvTransaction = require('../models/InvTransaction');
const User = require('../models/User');
const Company = require('../models/Company');

router.use(auth);

function getRange(period, from, to) {
  const now = new Date();
  let start, end = new Date(now); end.setHours(23, 59, 59, 999);
  switch (period) {
    case 'daily': start = new Date(now); start.setHours(0, 0, 0, 0); break;
    case 'weekly': start = new Date(now); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0); break;
    case 'monthly': start = new Date(now); start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0); break;
    case 'custom': start = from ? new Date(from) : new Date(0); end = to ? new Date(to) : now; break;
    default: start = new Date(0); end = now;
  }
  return { start, end };
}

const { scopeFilter } = require('../utils/scope');
function scopeQuery(req, extra) {
  const q = Object.assign({}, extra || {});
  const mod = req.query.module;
  const resMap = {
    enquiries: 'enquiries', 'sales-orders': 'salesOrders', projects: 'projects',
    'service-calls': 'serviceCalls', contracts: 'contracts', payments: 'payments',
    inventory: 'inventory', 'inventory-transactions': 'inventoryTransactions', users: 'users',
  };
  const resource = resMap[mod] || 'other';
  const scoped = scopeFilter(req.user, resource, q);
  if (req.user.role === 'super' && req.query.co) scoped.co = req.query.co;
  // Explicit department filter (admin/super only — enforced by scopeFilter for others)
  // Explicit division filter (PROJECTS dept managers, admin/super)
  if (req.query.division) {
    const DIV_MAP = { HVAC: 'HVAC', SOLAR: 'Solar', MEP: 'MEP' };
    const div = DIV_MAP[req.query.division];
    if (['enquiries', 'salesOrders', 'projects'].includes(resource) && div) {
      scoped.division = div;
    }
  }
  return scoped;
}

const MODULES = {
  enquiries: {
    label: 'Enquiries',
    columns: [
      { header: 'Date', key: 'createdAt', width: 12, type: 'date' },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Contact', key: 'contact', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Subject', key: 'subject', width: 30 },
      { header: 'Division', key: 'division', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Notes', key: 'notes', width: 40 },
    ],
    fetch: async (req, range) => Enquiry.find(scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } })).sort({ createdAt: -1 }).lean(),
  },
  'sales-orders': {
    label: 'Sales Orders',
    columns: [
      { header: 'SO #', key: 'no', width: 10 },
      { header: 'Date', key: 'createdAt', width: 12, type: 'date' },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Subject', key: 'subject', width: 30 },
      { header: 'Division', key: 'division', width: 12 },
      { header: 'Amount', key: 'total', width: 15, type: 'currency' },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Notes', key: 'notes', width: 40 },
    ],
    fetch: async (req, range) => SalesOrder.find(scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } })).sort({ createdAt: -1 }).lean(),
  },
  projects: {
    label: 'Projects',
    columns: [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Client', key: 'client', width: 25 },
      { header: 'Division', key: 'division', width: 12 },
      { header: 'Start', key: 'startDate', width: 12, type: 'date' },
      { header: 'End', key: 'endDate', width: 12, type: 'date' },
      { header: 'Value', key: 'value', width: 15, type: 'currency' },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Progress', key: 'progress', width: 10 },
      { header: 'Notes', key: 'notes', width: 40 },
    ],
    fetch: async (req, range) => Project.find(scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } })).sort({ createdAt: -1 }).lean(),
  },
  'service-calls': {
    label: 'Service Calls',
    columns: [
      { header: 'Date', key: 'createdAt', width: 12, type: 'date' },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Contact', key: 'contact', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Issue', key: 'issue', width: 40 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Resolution', key: 'resolution', width: 40 },
    ],
    fetch: async (req, range) => {
      const q = scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } });
      if (req.user.role === 'service_eng') q.assignedTo = req.user._id;
      return ServiceCall.find(q).sort({ createdAt: -1 }).lean();
    },
  },
  contracts: {
    label: 'AMC / PM Contracts',
    columns: [
      { header: 'Contract #', key: 'no', width: 15 },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Start', key: 'startDate', width: 12, type: 'date' },
      { header: 'End', key: 'endDate', width: 12, type: 'date' },
      { header: 'Value', key: 'value', width: 15, type: 'currency' },
      { header: 'Frequency', key: 'frequency', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
    ],
    fetch: async (req, range) => Contract.find(scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } })).sort({ createdAt: -1 }).lean(),
  },
  payments: {
    label: 'Payments',
    columns: [
      { header: 'Date', key: 'date', width: 12, type: 'date' },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Amount', key: 'amount', width: 15, type: 'currency' },
      { header: 'Method', key: 'method', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
    ],
    fetch: async (req, range) => Payment.find(scopeQuery(req, { $or: [
      { date: { $gte: range.start, $lte: range.end } },
      { createdAt: { $gte: range.start, $lte: range.end } },
    ]})).sort({ createdAt: -1 }).lean(),
  },
  inventory: {
    label: 'Inventory Stock',
    columns: [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Stock', key: 'qty', width: 12, type: 'number' },
      { header: 'Min Level', key: 'minLevel', width: 12, type: 'number' },
      { header: 'Rate', key: 'rate', width: 12, type: 'currency' },
      { header: 'Value', key: 'stockValue', width: 15, type: 'currency' },
    ],
    fetch: async (req) => {
      const items = await InvItem.find(scopeQuery(req)).lean();
      return items.map(it => Object.assign({}, it, { stockValue: (it.qty || 0) * (it.rate || 0) }));
    },
  },
  'inventory-transactions': {
    label: 'Inventory Transactions',
    columns: [
      { header: 'Date', key: 'createdAt', width: 12, type: 'date' },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Qty', key: 'qty', width: 10, type: 'number' },
      { header: 'Ref', key: 'ref', width: 15 },
      { header: 'Notes', key: 'notes', width: 40 },
    ],
    fetch: async (req, range) => InvTransaction.find(scopeQuery(req, { createdAt: { $gte: range.start, $lte: range.end } })).sort({ createdAt: -1 }).lean(),
  },
  users: {
    label: 'Users',
    columns: [
      { header: 'Username', key: 'un', width: 20 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Active', key: 'activeText', width: 10 },
      { header: 'Created', key: 'createdAt', width: 12, type: 'date' },
    ],
    fetch: async (req) => {
      const users = await User.find(scopeQuery(req)).select('-pw').lean();
      return users.map(u => Object.assign({}, u, { activeText: u.disabled ? 'No' : 'Yes' }));
    },
  },
  companies: {
    label: 'Companies',
    columns: [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Divisions', key: 'divsText', width: 25 },
      { header: 'GSTIN', key: 'gstin', width: 20 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Created', key: 'createdAt', width: 12, type: 'date' },
    ],
    fetch: async (req) => {
      if (req.user.role !== 'super') return [];
      const companies = await Company.find({}).lean();
      return companies.map(c => Object.assign({}, c, { divsText: (c.divs || []).join(', ') }));
    },
  },
};

router.get('/download', async (req, res) => {
  try {
    const { module, period, from, to, format = 'xlsx' } = req.query;
    const cfg = MODULES[module];
    if (!cfg) return res.status(400).json({ error: `Unknown module: ${module}` });

    const range = getRange(period, from, to);
    // If department scoping blocks this resource, return empty
    const testQuery = scopeQuery(req, {});
    if (testQuery._blocked) {
      const rows = [];
      // proceed to generate empty report
    }
    const rows = testQuery._blocked ? [] : ((await cfg.fetch(req, range)) || []);

    const fmt = (r, col) => {
      const v = r[col.key];
      if (v == null || v === '') return '';
      if (col.type === 'date') return new Date(v).toLocaleDateString();
      if (col.type === 'currency' || col.type === 'number') return Number(v) || 0;
      return String(v);
    };

    const dateLabel = `${range.start.toISOString().slice(0, 10)}_${range.end.toISOString().slice(0, 10)}`;
    const fileBase = `${cfg.label.replace(/\s+/g, '_')}_${period || 'all'}_${dateLabel}`;

    if (format === 'csv') {
      const headers = cfg.columns.map(c => c.header).join(',');
      const csvRows = rows.map(r => cfg.columns.map(c => {
        let v = String(fmt(r, c)).replace(/"/g, '""');
        return /[,"\n]/.test(v) ? `"${v}"` : v;
      }).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      return res.send([headers, ...csvRows].join('\n'));
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MEP Projects';
    wb.created = new Date();
    const ws = wb.addWorksheet(cfg.label.slice(0, 31));

    ws.mergeCells(1, 1, 1, cfg.columns.length);
    const t = ws.getCell(1, 1);
    t.value = `${cfg.label} Report — ${period || 'All Time'}`;
    t.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0392B' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, cfg.columns.length);
    const rInfo = ws.getCell(2, 1);
    rInfo.value = `Period: ${range.start.toLocaleDateString()} to ${range.end.toLocaleDateString()}  •  Records: ${rows.length}  •  Generated: ${new Date().toLocaleString()}`;
    rInfo.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
    rInfo.alignment = { horizontal: 'center' };

    cfg.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

    const headerRow = ws.getRow(4);
    cfg.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 22;
    headerRow.commit();

    rows.forEach((r, ri) => {
      const row = ws.getRow(5 + ri);
      cfg.columns.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = fmt(r, c);
        if (c.type === 'currency') cell.numFmt = '#,##0.00';
        if (c.type === 'number') cell.numFmt = '#,##0';
        cell.border = { top: { style: 'thin', color: { argb: 'FFDDDDDD' } }, left: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } }, right: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      row.commit();
    });

    const currencyCols = cfg.columns.map((c, i) => c.type === 'currency' ? i + 1 : null).filter(x => x);
    if (rows.length > 0 && currencyCols.length > 0) {
      const totalRow = ws.getRow(5 + rows.length);
      totalRow.getCell(1).value = 'TOTAL';
      totalRow.getCell(1).font = { bold: true };
      currencyCols.forEach(colIdx => {
        const cell = totalRow.getCell(colIdx);
        const startRef = ws.getCell(5, colIdx).address;
        const endRef = ws.getCell(4 + rows.length, colIdx).address;
        cell.value = { formula: `SUM(${startRef}:${endRef})` };
        cell.numFmt = '#,##0.00';
        cell.font = { bold: true };
      });
      totalRow.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF7' } };
        c.border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
      });
    }

    ws.views = [{ state: 'frozen', ySplit: 4 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[reports/download]', e);
    res.status(500).json({ error: e.message || 'Report generation failed' });
  }
});

router.get('/modules', (req, res) => {
  const role = req.user.role;
  const ROLE_MODULES = {
    super: ['companies', 'users', 'enquiries', 'sales-orders', 'projects', 'service-calls', 'contracts', 'payments', 'inventory', 'inventory-transactions'],
    admin: ['enquiries', 'sales-orders', 'projects', 'service-calls', 'contracts', 'payments', 'inventory', 'inventory-transactions', 'users'],
    sales: ['enquiries', 'sales-orders'],
    hvac_pm: ['projects', 'sales-orders', 'inventory'],
    solar_pm: ['projects', 'sales-orders', 'inventory'],
    mep_pm: ['projects', 'sales-orders'],
    engineer: ['projects'],
    store: ['inventory', 'inventory-transactions'],
    service_mgr: ['service-calls', 'contracts', 'inventory'],
    service_eng: ['service-calls'],
    accounts: ['payments', 'sales-orders'],
    viewer: ['enquiries', 'sales-orders', 'projects', 'service-calls'],
  };
  const modules = ROLE_MODULES[role] || [];
  res.json({ modules: modules.map(m => ({ key: m, label: MODULES[m]?.label || m })) });
});

module.exports = router;
