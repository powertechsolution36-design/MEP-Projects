'use strict';

const crypto = require('crypto');
const { ServiceError } = require('../errors');
const { bulkUpsertFromLineItems } = require('./itemNameService');
const { getEffectiveDivisions } = require('./subscriptionService');

/**
 * Quotation business logic.
 *
 * Quotation is a first-class commercial document for Sales/Finance.
 * It does NOT disturb existing Enquiry → SalesOrder flow.
 */

const ROW_TYPES = ['item', 'sub', 'heading', 'spec'];

/**
 * The content a quotation starting point carries (owner request, 22 Oct 2026):
 * the wording that is the same on every offer of that kind. Customer details,
 * dates, status and the quotation number are never part of it.
 */
const TEMPLATE_FIELDS = [
  'subject', 'system', 'capacity', 'siteDescription', 'summaryText',
  'technicalDescription', 'designApproval', 'benefitsOfSystem', 'designBy',
  'systemApprovedBy', 'gstPercent', 'offerValidity', 'delivery', 'notes',
  'excludedWorks', 'paymentTerms', 'equipmentItems', 'accessoriesItems',
];

/** A heading or specification row carries text only — never a price. */
function blankRow(item, idx, rowType) {
  return {
    ...item,
    rowType,
    sNo: null,
    qty: 0,
    supplyRate: 0,
    installationRate: 0,
    supplyAmount: 0,
    installationAmount: 0,
    totalAmount: 0,
    gstPercent: null,
    gstAmount: 0,
    amountWithGst: 0,
  };
}

function calculateLineTotals(items, division) {
  let number = 0; // only 'item' rows are numbered
  return items.map((item, idx) => {
    const rowType = ROW_TYPES.includes(item.rowType) ? item.rowType : 'item';
    if (rowType === 'heading' || rowType === 'spec') return blankRow(item, idx, rowType);
    const supplyAmount = (item.qty || 0) * (item.supplyRate || 0);
    const installationAmount = (item.qty || 0) * (item.installationRate || 0);
    const totalAmount = supplyAmount + installationAmount;
    // Per-item GST: Solar's flat table carries a GST % on every line
    // (default 18%, which is what the Solar form pre-fills); other divisions
    // use one GST % on the subtotal, so their lines keep GST only if given.
    const rawGst = item.gstPercent === '' || item.gstPercent === undefined ? null : item.gstPercent;
    const itemGst = rawGst != null ? Number(rawGst) : (division === 'Solar' ? 18 : null);
    const gstAmount = itemGst != null ? Math.round(totalAmount * itemGst / 100) : 0;
    const amountWithGst = itemGst != null ? totalAmount + gstAmount : totalAmount;
    if (rowType === 'item') number += 1;
    return {
      ...item,
      rowType,
      sNo: rowType === 'item' ? number : null,
      supplyAmount,
      installationAmount,
      totalAmount,
      gstPercent: itemGst,
      gstAmount,
      amountWithGst,
    };
  });
}

/** Rows that carry money; headings and specifications never do. */
function pricedRows(items) {
  return (items || []).filter((i) => {
    const t = i.rowType || 'item';
    return t !== 'heading' && t !== 'spec';
  });
}

/** True when at least one priced row sets its own GST %. */
function usesPerItemGst(items) {
  return pricedRows(items).some((i) => i.gstPercent !== null && i.gstPercent !== undefined);
}

/** GST of one section, each row at its own % (falling back to the document's). */
function sectionGstFromItems(items, fallbackPercent) {
  return pricedRows(items).reduce((sum, i) => {
    const pct = i.gstPercent !== null && i.gstPercent !== undefined ? Number(i.gstPercent) : fallbackPercent;
    return sum + Math.round((i.totalAmount || 0) * pct / 100);
  }, 0);
}

function calculateTotals(equipmentItems, accessoriesItems, gstPercent, division) {
  const eqSupply = equipmentItems.reduce((s, i) => s + (i.supplyAmount || 0), 0);
  const eqInstall = equipmentItems.reduce((s, i) => s + (i.installationAmount || 0), 0);
  const accSupply = accessoriesItems.reduce((s, i) => s + (i.supplyAmount || 0), 0);
  const accInstall = accessoriesItems.reduce((s, i) => s + (i.installationAmount || 0), 0);
  const eqTotal = eqSupply + eqInstall;
  const accTotal = accSupply + accInstall;
  const subtotal = eqTotal + accTotal;
  const docGst = gstPercent != null ? gstPercent : 18;

  let gst = docGst;
  let equipmentGstAmount;
  let accessoriesGstAmount;
  let gstAmount;

  if (division === 'Solar') {
    // DECISION (owner-approved, Completion order): a Solar quotation's GST is
    // the sum of its per-item GST, so the grand total equals the sum of the
    // lines' "Amount with GST" printed on the document.
    equipmentGstAmount = pricedRows(equipmentItems).reduce((a, i) => a + (i.gstAmount || 0), 0);
    accessoriesGstAmount = pricedRows(accessoriesItems).reduce((a, i) => a + (i.gstAmount || 0), 0);
    gstAmount = equipmentGstAmount + accessoriesGstAmount;
    gst = null;
  } else if (usesPerItemGst(equipmentItems) || usesPerItemGst(accessoriesItems)) {
    // OWNER REQUEST (22 Oct 2026): GST can be set per item on the Equipment
    // (high side) section of any division, not just Solar. Rows left blank
    // fall back to the quotation's own GST %, which is why that stays set.
    equipmentGstAmount = sectionGstFromItems(equipmentItems, docGst);
    accessoriesGstAmount = sectionGstFromItems(accessoriesItems, docGst);
    gstAmount = equipmentGstAmount + accessoriesGstAmount;
  } else {
    // Unchanged: one GST % on the subtotal.
    gstAmount = Math.round(subtotal * docGst / 100);
    equipmentGstAmount = Math.round(eqTotal * docGst / 100);
    accessoriesGstAmount = Math.round(accTotal * docGst / 100);
  }

  const grandTotal = subtotal + gstAmount;
  return {
    equipmentSupplyTotal: eqSupply,
    equipmentInstallTotal: eqInstall,
    equipmentTotal: eqTotal,
    equipmentGstAmount,
    accessoriesSupplyTotal: accSupply,
    accessoriesInstallTotal: accInstall,
    accessoriesTotal: accTotal,
    accessoriesGstAmount,
    subtotal,
    gstPercent: gst,
    gstAmount,
    grandTotal,
  };
}

async function generateQuotationNumber(companyId, deps) {
  const seq = await deps.counterRepo.getNextSequence(companyId, 'quotation');
  // Get company prefix
  let prefix = 'QTN';
  if (deps.companyRepo) {
    const company = await deps.companyRepo.findById(companyId);
    if (company && company.quotationPrefix) prefix = company.quotationPrefix;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

async function createQuotation(companyId, data, actorId, deps) {
  if (!data.division) throw new ServiceError('Division is required.');
  if (!data.customerName) throw new ServiceError('Customer name is required.');

  // Validate division entitlement
  const divisions = await getEffectiveDivisions(companyId, deps);
  if (!divisions.includes(data.division)) {
    throw new ServiceError(
      `Division "${data.division}" is not available for this company.`,
      'DIVISION_NOT_ENTITLED',
      403
    );
  }

  // Generate quotation number
  const quotationNumber = await generateQuotationNumber(companyId, deps);

  // Calculate line item amounts
  const equipmentItems = calculateLineTotals(data.equipmentItems || [], data.division);
  const accessoriesItems = calculateLineTotals(data.accessoriesItems || [], data.division);
  const totals = calculateTotals(equipmentItems, accessoriesItems, data.gstPercent, data.division);

  const quotation = await deps.quotationRepo.create({
    companyId,
    quotationNumber,
    division: data.division,
    status: data.status || 'Draft',
    customerName: data.customerName,
    customerAddress: data.customerAddress || '',
    customerPhone: data.customerPhone || '',
    customerEmail: data.customerEmail || '',
    customerGst: data.customerGst || '',
    subject: data.subject || '',
    system: data.system || '',
    capacity: data.capacity || '',
    siteDescription: data.siteDescription || '',
    summaryText: data.summaryText || '',
    technicalDescription: data.technicalDescription || '',
    designApproval: data.designApproval || '',
    benefitsOfSystem: data.benefitsOfSystem || '',
    designBy: data.designBy || '',
    systemApprovedBy: data.systemApprovedBy || '',
    equipmentItems,
    accessoriesItems,
    ...totals,
    paymentTerms: Array.isArray(data.paymentTerms) ? data.paymentTerms : [],
    paymentTermTemplateId: data.paymentTermTemplateId || null,
    offerValidity: data.offerValidity || '',
    delivery: data.delivery || '',
    excludedWorks: data.excludedWorks || [],
    notes: data.notes || '',
    date: data.date || new Date(),
    createdBy: actorId,
    lastEditedBy: actorId,
  });

  // Upsert item names (save timing: only on document save)
  const allItems = [
    ...equipmentItems.map(i => ({ ...i, section: 'Equipment' })),
    ...accessoriesItems.map(i => ({ ...i, section: 'Accessories' })),
  ];
  await bulkUpsertFromLineItems(companyId, data.division, allItems, deps);

  return quotation;
}

async function updateQuotation(companyId, quotationId, data, actorId, deps) {
  const existing = await deps.quotationRepo.findById(companyId, quotationId);
  if (!existing) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);

  // If division changed, validate entitlement
  if (data.division && data.division !== existing.division) {
    const divisions = await getEffectiveDivisions(companyId, deps);
    if (!divisions.includes(data.division)) {
      throw new ServiceError(
        `Division "${data.division}" is not available for this company.`,
        'DIVISION_NOT_ENTITLED',
        403
      );
    }
  }

  const patch = {};
  const simpleFields = [
    'status', 'division', 'customerName', 'customerAddress', 'customerPhone',
    'customerEmail', 'customerGst', 'subject', 'system', 'capacity',
    'siteDescription', 'summaryText', 'technicalDescription', 'designApproval',
    'benefitsOfSystem', 'designBy', 'systemApprovedBy',
    'paymentTerms', 'paymentTermTemplateId', 'offerValidity', 'delivery',
    'excludedWorks', 'notes', 'date', 'revision',
  ];
  for (const f of simpleFields) {
    if (data[f] !== undefined) {
      // Ensure array fields stay arrays (guard against string input)
      if ((f === 'paymentTerms' || f === 'excludedWorks') && !Array.isArray(data[f])) {
        patch[f] = [];
      } else {
        patch[f] = data[f];
      }
    }
  }

  // Recalculate line items if provided
  const divisionChanged = data.division && data.division !== existing.division;
  if (data.equipmentItems !== undefined || data.accessoriesItems !== undefined || divisionChanged
    || (data.gstPercent !== undefined && data.gstPercent !== existing.gstPercent)) {
    const division = data.division || existing.division;
    const eqItems = calculateLineTotals(data.equipmentItems || existing.equipmentItems || [], division);
    const accItems = calculateLineTotals(data.accessoriesItems || existing.accessoriesItems || [], division);
    const totals = calculateTotals(eqItems, accItems, data.gstPercent != null ? data.gstPercent : existing.gstPercent, division);
    patch.equipmentItems = eqItems;
    patch.accessoriesItems = accItems;
    Object.assign(patch, totals);

    // Upsert item names
    const allItems = [
      ...eqItems.map(i => ({ ...i, section: 'Equipment' })),
      ...accItems.map(i => ({ ...i, section: 'Accessories' })),
    ];
    await bulkUpsertFromLineItems(companyId, division, allItems, deps);
  }

  patch.lastEditedBy = actorId;
  return deps.quotationRepo.updateFields(companyId, quotationId, patch);
}

async function getQuotation(companyId, quotationId, deps) {
  const q = await deps.quotationRepo.findById(companyId, quotationId);
  if (!q) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);
  return q;
}

async function listQuotations(companyId, filters, deps) {
  return deps.quotationRepo.listByCompany(companyId, filters);
}

async function duplicateQuotation(companyId, quotationId, actorId, deps) {
  const source = await deps.quotationRepo.findById(companyId, quotationId);
  if (!source) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);

  const quotationNumber = await generateQuotationNumber(companyId, deps);
  const { id, _id, quotationNumber: _qn, createdAt, updatedAt, ...rest } = source;
  return deps.quotationRepo.create({
    ...rest,
    quotationNumber,
    status: 'Draft',
    revision: 0,
    createdBy: actorId,
    lastEditedBy: actorId,
    date: new Date(),
  });
}

async function deleteQuotation(companyId, quotationId, deps) {
  const q = await deps.quotationRepo.findById(companyId, quotationId);
  if (!q) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);
  if (q.status !== 'Draft' && q.status !== 'Cancelled') {
    throw new ServiceError('Only Draft or Cancelled quotations can be deleted.');
  }
  await deps.quotationRepo.delete(companyId, quotationId);
  return { deleted: true };
}

const PDF_TOKEN_RE = /^[a-f0-9]{48}$/;

function newPdfToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * The client-facing link for this quotation's PDF. Any member of the
 * quotation's company may fetch it (same tenant gate as reading it).
 * Quotations created before this feature get a token on first request.
 */
async function getPdfLink(companyId, quotationId, deps) {
  const q = await deps.quotationRepo.findById(companyId, quotationId);
  if (!q) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);
  if (q.pdfToken) return { pdfToken: q.pdfToken };
  const updated = await deps.quotationRepo.setPdfTokenIfMissing(companyId, quotationId, newPdfToken());
  return { pdfToken: updated.pdfToken };
}

/**
 * Public (no login) PDF for the customer, addressed only by the
 * unguessable token in the link they were sent. Returns { filename, pdf }.
 */
async function renderPublicQuotation(token, deps) {
  if (typeof token !== 'string' || !PDF_TOKEN_RE.test(token)) {
    throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);
  }
  const q = await deps.quotationRepo.findByPdfToken(token);
  if (!q) throw new ServiceError('Quotation not found.', 'NOT_FOUND', 404);
  const company = (await deps.companyRepo.findById(q.companyId)) || {};
  // Loaded on demand so the rest of the Quotation module never depends on
  // the PDF library being installed.
  const { buildQuotationPdf } = require('./quotationPdf');
  const pdf = await buildQuotationPdf({ company, quotation: q });
  return { filename: `Quotation-${q.quotationNumber || 'quotation'}.pdf`, pdf };
}

async function exportQuotationsCsv(companyId, deps) {
  const quotations = await deps.quotationRepo.listByCompany(companyId, {});
  const header = 'Quotation No,Date,Division,Customer,Subject,System,Status,Equipment Total,Accessories Total,Subtotal,GST,Grand Total';
  const rows = quotations.map(q => [
    q.quotationNumber,
    q.date ? new Date(q.date).toISOString().split('T')[0] : '',
    q.division,
    `"${(q.customerName || '').replace(/"/g, '""')}"`,
    `"${(q.subject || '').replace(/"/g, '""')}"`,
    `"${(q.system || '').replace(/"/g, '""')}"`,
    q.status,
    q.equipmentTotal || 0,
    q.accessoriesTotal || 0,
    q.subtotal || 0,
    q.gstAmount || 0,
    q.grandTotal || 0,
  ].join(','));
  return [header, ...rows].join('\n');
}

module.exports = {
  TEMPLATE_FIELDS,
  usesPerItemGst,
  calculateLineTotals,
  calculateTotals,
  generateQuotationNumber,
  createQuotation,
  updateQuotation,
  getQuotation,
  listQuotations,
  duplicateQuotation,
  deleteQuotation,
  exportQuotationsCsv,
  getPdfLink,
  renderPublicQuotation,
};
