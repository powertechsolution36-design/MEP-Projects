'use strict';

const { ServiceError } = require('../errors');
const { bulkUpsertFromLineItems } = require('./itemNameService');
const { getEffectiveDivisions } = require('./subscriptionService');

/**
 * Quotation business logic.
 *
 * Quotation is a first-class commercial document for Sales/Finance.
 * It does NOT disturb existing Enquiry → SalesOrder flow.
 */

function calculateLineTotals(items, division) {
  return items.map((item, idx) => {
    const supplyAmount = (item.qty || 0) * (item.supplyRate || 0);
    const installationAmount = (item.qty || 0) * (item.installationRate || 0);
    const totalAmount = supplyAmount + installationAmount;
    // Per-item GST (Solar uses per-item GST%)
    const itemGst = item.gstPercent != null ? item.gstPercent : null;
    const gstAmount = itemGst != null ? Math.round(totalAmount * itemGst / 100) : 0;
    const amountWithGst = itemGst != null ? totalAmount + gstAmount : totalAmount;
    return {
      ...item,
      sNo: item.sNo || idx + 1,
      supplyAmount,
      installationAmount,
      totalAmount,
      gstPercent: itemGst,
      gstAmount,
      amountWithGst,
    };
  });
}

function calculateTotals(equipmentItems, accessoriesItems, gstPercent) {
  const eqSupply = equipmentItems.reduce((s, i) => s + (i.supplyAmount || 0), 0);
  const eqInstall = equipmentItems.reduce((s, i) => s + (i.installationAmount || 0), 0);
  const accSupply = accessoriesItems.reduce((s, i) => s + (i.supplyAmount || 0), 0);
  const accInstall = accessoriesItems.reduce((s, i) => s + (i.installationAmount || 0), 0);
  const eqTotal = eqSupply + eqInstall;
  const accTotal = accSupply + accInstall;
  const subtotal = eqTotal + accTotal;
  const gst = gstPercent != null ? gstPercent : 18;
  const gstAmount = Math.round(subtotal * gst / 100);
  const grandTotal = subtotal + gstAmount;
  return {
    equipmentSupplyTotal: eqSupply,
    equipmentInstallTotal: eqInstall,
    equipmentTotal: eqTotal,
    accessoriesSupplyTotal: accSupply,
    accessoriesInstallTotal: accInstall,
    accessoriesTotal: accTotal,
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
  const totals = calculateTotals(equipmentItems, accessoriesItems, data.gstPercent);

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
  if (data.equipmentItems !== undefined || data.accessoriesItems !== undefined) {
    const division = data.division || existing.division;
    const eqItems = calculateLineTotals(data.equipmentItems || existing.equipmentItems || [], division);
    const accItems = calculateLineTotals(data.accessoriesItems || existing.accessoriesItems || [], division);
    const totals = calculateTotals(eqItems, accItems, data.gstPercent != null ? data.gstPercent : existing.gstPercent);
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
};
