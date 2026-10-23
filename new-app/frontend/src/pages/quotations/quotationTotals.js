/**
 * The quotation totals, as the server computes them
 * (backend/src/services/quotationService.js → calculateTotals). Shared by the
 * create and edit screens so the figures on screen are the figures that get
 * saved and printed.
 *
 * GST follows three rules, in this order:
 *   Solar                      every line carries its own GST % (18% if blank)
 *   any line sets a GST %      each line at its own %, blank lines at the
 *                              quotation's own % (owner request, 22 Oct 2026:
 *                              per-item GST on the high side of any division)
 *   otherwise                  one GST % on the subtotal, as before
 *
 * Heading and specification lines carry no money and are skipped.
 */

function priced(items) {
  return (items || []).filter((i) => {
    const t = i.rowType || 'item';
    return t !== 'heading' && t !== 'spec';
  });
}

function lineTotal(i) {
  return (i.qty || 0) * ((i.supplyRate || 0) + (i.installationRate || 0));
}

function hasOwnGst(items) {
  return priced(items).some((i) => i.gstPercent !== null && i.gstPercent !== undefined);
}

function gstOf(items, fallbackPercent) {
  return priced(items).reduce((sum, i) => {
    const pct = i.gstPercent !== null && i.gstPercent !== undefined ? Number(i.gstPercent) : fallbackPercent;
    return sum + Math.round(lineTotal(i) * pct / 100);
  }, 0);
}

export function quotationTotals(equipmentItems, accessoriesItems, gstPercentInput, division) {
  const eqTotal = priced(equipmentItems).reduce((s, i) => s + lineTotal(i), 0);
  const accTotal = priced(accessoriesItems).reduce((s, i) => s + lineTotal(i), 0);
  const subtotal = eqTotal + accTotal;
  const docGst = gstPercentInput === '' || gstPercentInput == null ? 18 : Number(gstPercentInput);

  let eqGst;
  let accGst;
  let gstAmount;
  if (division === 'Solar') {
    eqGst = gstOf(equipmentItems, 18);
    accGst = gstOf(accessoriesItems, 18);
    gstAmount = eqGst + accGst;
  } else if (hasOwnGst(equipmentItems) || hasOwnGst(accessoriesItems)) {
    eqGst = gstOf(equipmentItems, docGst);
    accGst = gstOf(accessoriesItems, docGst);
    gstAmount = eqGst + accGst;
  } else {
    gstAmount = Math.round(subtotal * docGst / 100);
    eqGst = Math.round(eqTotal * docGst / 100);
    accGst = Math.round(accTotal * docGst / 100);
  }

  return {
    eqTotal,
    accTotal,
    subtotal,
    gstPercent: division === 'Solar' ? null : docGst,
    perItemGst: division === 'Solar' || hasOwnGst(equipmentItems) || hasOwnGst(accessoriesItems),
    equipmentGstAmount: eqGst,
    accessoriesGstAmount: accGst,
    gstAmount,
    grandTotal: subtotal + gstAmount,
  };
}

export default quotationTotals;
