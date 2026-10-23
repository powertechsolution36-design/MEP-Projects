'use strict';

/**
 * Quotation PDF.
 *
 * Owner decision, 22 Oct 2026: the "Print / Save as PDF" button used to open
 * a pop-up window, which the Android app's web view blocks, so nothing
 * happened. The quotation is now rendered server-side as a real PDF.
 *
 * The layout reproduces the company's own quotation workbooks
 * (C:\Quotation — "AC Offer - Split/Ducted/VRF.xlsx", "Solar Offer 5kw.xlsx"),
 * which the owner supplied as the target format:
 *
 *   Page 1  letterhead · SUMMARY band · Quote To / Subject / intro /
 *           System · Benefits of System · Capacity · "Yours truly" block
 *           with Design By and System Approved By
 *   Page 2  letterhead · SUPPLY & INSTALLATION OF <division> SYSTEM band ·
 *           priced table (Section A/B with Supply + Installation columns, or
 *           Solar's flat per-item-GST table) · yellow TOTAL rows · green
 *           GRAND TOTAL WITH GST · "Yours truly" block
 *   Page 3  letterhead · COMMERCIAL TERMS AND CONDITIONS · BANK DETAILS ·
 *           EXCLUDED WORKS (light-green band headings)
 *
 * Every page is drawn inside a single outer box, as in the workbooks.
 * All company text (name, subtitle, tagline, address, bank, authorised
 * person, logo) comes from Company Profile — nothing is hardcoded to one
 * tenant.
 *
 * Same engine as serviceReportPdf.js: pdfkit, with the bundled DejaVu Sans
 * (assets/fonts) because the PDF standard fonts have no rupee glyph. Pure
 * function of its inputs -- no database access here.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

/*
 * Fonts, chosen to match the company's own quotation workbooks (owner
 * request, 22 Oct 2026). These apply to the quotation PDF only — the app's
 * own screens and the Service Report PDF are untouched.
 *
 *   workbook                     here                       why
 *   Bookman Old Style Bold   ->  TeX Gyre Bonum Bold        the free Bookman
 *   Calibri                  ->  Carlito                    metric-compatible with Calibri
 *   Times New Roman Bold     ->  Liberation Serif Bold      metric-compatible with Times New Roman
 *
 * All three are free to embed and redistribute (GUST Font License and SIL
 * OFL; see the LICENSE files beside them). Carlito carries the rupee glyph,
 * which the PDF standard fonts do not.
 */
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'Carlito-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'Carlito-Bold.ttf');
const FONT_HEAD = path.join(FONT_DIR, 'texgyrebonum-bold.otf');
const FONT_SERIF_BOLD = path.join(FONT_DIR, 'LiberationSerif-Bold.ttf');
const FONT_SERIF_BOLD_ITALIC = path.join(FONT_DIR, 'LiberationSerif-BoldItalic.ttf');

// Colours taken from the workbooks themselves.
const C = {
  navy: '#002060', // letterhead name / tagline
  ink: '#000000',
  muted: '#444444',
  rule: '#000000',
  yellow: '#ffff00', // TOTAL rows
  green: '#92d050', // GRAND TOTAL WITH GST
  bandGreen: '#ccffcc', // COMMERCIAL TERMS / BANK DETAILS / EXCLUDED WORKS
};

/** Decode a `data:image/png|jpeg;base64,...` URI to a Buffer; anything else -> null. */
function imageBuffer(dataUri) {
  if (typeof dataUri !== 'string') return null;
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUri.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function fmtDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

/** Plain number with Indian grouping, as the workbooks print it. */
function num(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function money(n) {
  return `₹ ${num(n)}`;
}

function hasText(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

/**
 * @param {object} p
 * @param {object} p.company    Company document (displayName/name, subtitle, tagline, address,
 *                              city, phone, email, website, gstNumber, logoBase64,
 *                              bankDetails, authorizedPerson)
 * @param {object} p.quotation  Quotation document
 * @returns {Promise<Buffer>}
 */
function buildQuotationPdf({ company, quotation }) {
  return new Promise((resolve, reject) => {
    const co = company || {};
    const q = quotation || {};
    const isSolar = q.division === 'Solar';
    const eqItems = Array.isArray(q.equipmentItems) ? q.equipmentItems : [];
    const accItems = Array.isArray(q.accessoriesItems) ? q.accessoriesItems : [];
    const allItems = [...eqItems, ...accItems];
    const ref = str(q.quotationNumber);
    const coName = str(co.displayName || co.name).toUpperCase();
    const person = co.authorizedPerson || {};
    const gstPct = q.gstPercent === null || q.gstPercent === undefined ? 18 : q.gstPercent;
    // Owner request (22 Oct 2026): GST may be set per item on the high side.
    // When it is, the table gains a GST % column and the section totals come
    // from the stored per-section GST rather than one flat percentage.
    const priced = (arr) => (Array.isArray(arr) ? arr : []).filter((i) => {
      const t = str(i.rowType || 'item');
      return t !== 'heading' && t !== 'spec';
    });
    const perItemGst = [...priced(eqItems), ...priced(accItems)].some((i) => i.gstPercent !== null && i.gstPercent !== undefined);
    const sectionWithGst = (sectionTotal, storedGst) => (
      perItemGst && storedGst !== undefined && storedGst !== null
        ? (sectionTotal || 0) + storedGst
        : Math.round((sectionTotal || 0) * (1 + gstPct / 100))
    );
    const gstLabel = perItemGst ? 'with GST' : `with ${gstPct}% GST`;

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 34, bottom: 44, left: 34, right: 34 },
      info: { Title: `Quotation ${ref}`, Author: coName, Subject: 'Quotation' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('R', FONT_REGULAR);   // body
    doc.registerFont('B', FONT_BOLD);      // body, bold
    doc.registerFont('H', FONT_HEAD);      // letterhead name and subtitle
    doc.registerFont('S', FONT_SERIF_BOLD);        // address block
    doc.registerFont('SI', FONT_SERIF_BOLD_ITALIC); // tagline

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const RIGHT = L + W;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom;
    // Where the outer box of the current page starts, so it can be closed off.
    let boxTop = doc.page.margins.top;

    function line(x1, y1, x2, y2, width = 0.8) {
      doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(C.rule).stroke();
    }

    /* ---------- Letterhead, drawn at the top of every page ---------- */
    function letterhead() {
      boxTop = doc.page.margins.top;
      const top = boxTop;
      const splitX = L + W * 0.52;
      const logo = imageBuffer(co.logoBase64);

      // Name block, right half.
      doc.font('H').fontSize(13.5).fillColor(C.navy)
        .text(coName, splitX, top + 9, { width: RIGHT - splitX, align: 'center' });
      if (hasText(co.subtitle)) {
        doc.font('H').fontSize(11).fillColor(C.navy)
          .text(str(co.subtitle), splitX, top + 32, { width: RIGHT - splitX, align: 'center' });
      }

      // Logo, left half.
      if (logo) {
        try {
          doc.image(logo, L + 14, top + 8, { fit: [splitX - L - 28, 44] });
        } catch { /* unreadable logo: the letterhead still prints */ }
      }

      const bandY = top + 56;
      line(L, bandY, RIGHT, bandY);

      // Tagline (left) + address and date (right).
      const addrLines = [
        [co.address, co.city].filter(hasText).join(', '),
        str(co.email),
        str(co.website),
      ].filter(hasText);
      if (hasText(co.gstNumber)) addrLines.push(`GSTIN: ${str(co.gstNumber)}`);

      let ry = bandY + 5;
      doc.font('S').fontSize(9).fillColor(C.ink);
      addrLines.forEach((l) => {
        doc.text(l, splitX + 4, ry, { width: RIGHT - splitX - 8, align: 'center' });
        ry = doc.y + 1;
      });
      doc.font('S').fontSize(9).fillColor(C.ink)
        .text(fmtDate(q.date), splitX + 4, ry + 1, { width: RIGHT - splitX - 8, align: 'center' });
      const rightBottom = doc.y + 4;

      if (hasText(co.tagline)) {
        doc.font('SI').fontSize(9.5).fillColor(C.navy)
          .text(`"${str(co.tagline).replace(/^"|"$/g, '')}"`, L + 6, bandY + 8, { width: splitX - L - 12, align: 'center' });
      }

      const headBottom = Math.max(rightBottom, bandY + 30);
      line(splitX, bandY, splitX, headBottom);
      line(L, headBottom, RIGHT, headBottom);
      doc.y = headBottom;
    }

    /** Closes the outer box on the page that is finishing. */
    function closeBox() {
      const bottom = Math.min(doc.y, pageBottom());
      line(L, boxTop, L, bottom);
      line(RIGHT, boxTop, RIGHT, bottom);
      line(L, boxTop, RIGHT, boxTop);
      line(L, bottom, RIGHT, bottom);
    }

    function newPage() {
      closeBox();
      doc.addPage();
      letterhead();
    }

    const room = (h) => doc.y + h <= pageBottom() - 6;
    function ensure(h) {
      if (!room(h)) newPage();
    }

    /** Centred, bordered band — SUMMARY, SUPPLY & INSTALLATION … */
    function titleBand(title) {
      ensure(22);
      const y = doc.y;
      doc.font('B').fontSize(9).fillColor(C.ink)
        .text(String(title).toUpperCase(), L + 4, y + 4.5, { width: W - 8, align: 'center' });
      const h = 17;
      line(L, y + h, RIGHT, y + h);
      doc.y = y + h;
    }

    /** Left-aligned light-green band — COMMERCIAL TERMS AND CONDITIONS. … */
    function greenBand(title) {
      ensure(24);
      const y = doc.y + 6;
      const h = 15;
      doc.rect(L, y, W, h).fillColor(C.bandGreen).fill();
      line(L, y, RIGHT, y);
      line(L, y + h, RIGHT, y + h);
      doc.font('B').fontSize(9).fillColor(C.ink).text(String(title), L + 5, y + 3.5, { width: W - 10 });
      doc.y = y + h + 6;
    }

    /** "Label -   value" line, as the workbook's Quote To / Subject rows. */
    function labelled(label, value, { gap = 78, bold = false, size = 9.5 } = {}) {
      const v = str(value);
      const h = Math.max(13, doc.font('R').fontSize(size).heightOfString(v, { width: W - gap - 16 }) + 3);
      ensure(h + 4);
      const y = doc.y + 2;
      doc.font('B').fontSize(size).fillColor(C.ink).text(label, L + 8, y, { width: gap });
      doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(C.ink).text(v, L + 8 + gap, y, { width: W - gap - 16 });
      doc.y = y + h;
    }

    /** Free paragraph inside the box. */
    function paragraph(value, { size = 9, bold = false, gapBefore = 6 } = {}) {
      const v = str(value).trim();
      if (!v) return;
      const h = doc.font(bold ? 'B' : 'R').fontSize(size).heightOfString(v, { width: W - 16 });
      ensure(h + gapBefore + 4);
      const y = doc.y + gapBefore;
      doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(C.ink).text(v, L + 8, y, { width: W - 16 });
      doc.y = y + h + 2;
    }

    /** "Yours truly / For <company> / signature / name / Mob:" block. */
    function signatureBlock({ withApprovals = false } = {}) {
      const sig = imageBuffer(person.signatureBase64);
      const stamp = imageBuffer(person.stampBase64);
      const needed = 50 + (sig || stamp ? 44 : 0);
      ensure(needed);
      let y = doc.y + 10;
      doc.font('R').fontSize(9).fillColor(C.ink).text('Yours truly,', L + 8, y, { width: W * 0.5 });
      y = doc.y + 1;
      doc.font('B').fontSize(9.5).fillColor(C.ink).text(`For ${coName}`, L + 8, y, { width: W * 0.5 });
      if (withApprovals) {
        doc.font('B').fontSize(9).fillColor(C.ink)
          .text(`Design By - ${str(q.designBy)}`, L + W * 0.42, y, { width: W * 0.26 })
          .text(`System Approved By - ${str(q.systemApprovedBy)}`, L + W * 0.68, y, { width: W * 0.3 - 8 });
      }
      y = doc.y + 3;
      if (sig || stamp) {
        if (sig) {
          try { doc.image(sig, L + 8, y, { fit: [110, 38] }); } catch { /* skip unreadable image */ }
        }
        if (stamp) {
          try { doc.image(stamp, L + 132, y, { fit: [110, 38] }); } catch { /* skip unreadable image */ }
        }
        y += 42;
      }
      if (hasText(person.name)) {
        doc.font('R').fontSize(9).fillColor(C.ink).text(str(person.name), L + 8, y, { width: W * 0.5 });
        y = doc.y;
      }
      const mob = str(person.contactPhone || co.phone);
      if (mob) {
        doc.font('R').fontSize(9).fillColor(C.ink).text(`Mob: ${mob}`, L + 8, y, { width: W * 0.5 });
        y = doc.y;
      }
      doc.y = y + 4;
    }

    /**
     * The priced table. `cols` = [{ title, sub, width, align }].
     * `rows` = { cells, bold, fill, mergeFrom } — `mergeFrom` draws cells from
     * that index onward as one wide cell, which is how the workbook's TOTAL
     * rows span the amount columns.
     */
    function itemTable(cols, rows, twoRowHeader) {
      const totalW = cols.reduce((s, c) => s + c.width, 0);
      const widths = cols.map((c) => (c.width / totalW) * W);
      const xs = [];
      let acc = L;
      widths.forEach((w) => { xs.push(acc); acc += w; });

      function drawHeader() {
        const h = twoRowHeader ? 28 : 23; // 23 leaves room for a two-line head such as "Amount with GST"
        ensure(h + 14);
        const y = doc.y;
        const mid = y + 14;
        doc.font('B').fontSize(7.5).fillColor(C.ink);
        cols.forEach((c, i) => {
          if (twoRowHeader && c.sub) {
            // Group title spans this column and the next; the two sub-heads
            // sit under it, so the divider between them starts at `mid`.
            if (c.groupStart) {
              doc.text(c.group, xs[i], y + 4, { width: widths[i] + widths[i + 1], align: 'center' });
              line(xs[i], y, xs[i], y + h);
            } else {
              line(xs[i], mid, xs[i], y + h);
            }
            doc.text(c.sub, xs[i], mid + 3, { width: widths[i], align: 'center' });
          } else {
            // Ungrouped heads are full-height cells, so no divider crosses them.
            doc.text(c.title, xs[i], y + (twoRowHeader ? h / 2 - 4 : 4), { width: widths[i], align: 'center' });
            line(xs[i], y, xs[i], y + h);
          }
        });
        line(RIGHT, y, RIGHT, y + h);
        line(L, y, RIGHT, y);
        line(L, y + h, RIGHT, y + h);
        if (twoRowHeader) {
          // The divider runs under the group titles only — never across a
          // full-height head such as "GST %" that sits after them.
          const firstGrouped = cols.findIndex((c) => c.sub);
          let lastGrouped = -1;
          cols.forEach((c, i) => { if (c.sub) lastGrouped = i; });
          if (firstGrouped >= 0) {
            const endX = lastGrouped + 1 < cols.length ? xs[lastGrouped + 1] : RIGHT;
            line(xs[firstGrouped], mid, endX, mid);
          }
        }
        doc.y = y + h;
      }

      drawHeader();
      rows.forEach((row) => {
        const from = Number.isInteger(row.mergeFrom) ? row.mergeFrom : null;
        const f = row.bold ? 'B' : 'R';
        // A heading or specification row runs the width of the description
        // column and everything to its right, with no inner dividers.
        const wide = row.wide ? { x: xs[1], w: RIGHT - xs[1] } : null;
        let h = 0;
        if (wide) {
          h = doc.font(f).fontSize(8).heightOfString(str(row.cells[1]), { width: wide.w - 8 });
        } else {
          row.cells.forEach((cell, i) => {
            if (from !== null && i > from) return;
            const w = from !== null && i === from ? RIGHT - xs[i] : widths[i];
            const ch = doc.font(f).fontSize(8).heightOfString(str(cell), { width: w - 8 });
            if (ch > h) h = ch;
          });
        }
        h = Math.max(h + 7, 16);
        if (!room(h)) { newPage(); drawHeader(); }
        const y = doc.y;
        if (row.fill) doc.rect(L, y, W, h).fillColor(row.fill).fill();
        if (wide) {
          doc.font(f).fontSize(8).fillColor(C.ink)
            .text(str(row.cells[0]), xs[0] + 4, y + 4, { width: widths[0] - 8, align: 'center' });
          doc.font(f).fontSize(8).fillColor(C.ink)
            .text(str(row.cells[1]), wide.x + 4, y + 4, { width: wide.w - 8 });
          line(xs[0], y, xs[0], y + h);
          line(xs[1], y, xs[1], y + h);
        } else {
          row.cells.forEach((cell, i) => {
            if (from !== null && i > from) return;
            const w = from !== null && i === from ? RIGHT - xs[i] : widths[i];
            doc.font(f).fontSize(8).fillColor(C.ink)
              .text(str(cell), xs[i] + 4, y + 4, { width: w - 8, align: cols[i].align || 'left' });
            line(xs[i], y, xs[i], y + h);
          });
        }
        line(RIGHT, y, RIGHT, y + h);
        line(L, y + h, RIGHT, y + h);
        doc.y = y + h;
      });
    }

    /* ================= PAGE 1 — SUMMARY ================= */
    letterhead();
    titleBand('Summary');

    labelled('Quote To -', q.customerName);
    if (hasText(q.customerAddress)) paragraph(q.customerAddress, { gapBefore: 1 });
    const custLine = [
      hasText(q.customerPhone) ? `Phone: ${str(q.customerPhone)}` : '',
      hasText(q.customerEmail) ? `Email: ${str(q.customerEmail)}` : '',
      hasText(q.customerGst) ? `GST: ${str(q.customerGst)}` : '',
    ].filter(Boolean).join('   ');
    if (custLine) paragraph(custLine, { gapBefore: 1, size: 8.5 });
    if (hasText(q.subject)) labelled('Subject -', q.subject);

    if (hasText(q.summaryText)) paragraph(q.summaryText, { gapBefore: 10 });
    if (hasText(q.siteDescription)) paragraph(q.siteDescription, { gapBefore: 8 });

    if (hasText(q.technicalDescription) || hasText(q.system) || hasText(q.capacity) || hasText(q.benefitsOfSystem)) {
      paragraph('As per the site conditions and design parameters we reached to following Engineering -', { gapBefore: 10 });
    }
    if (hasText(q.system)) labelled('System -', q.system);
    if (hasText(q.benefitsOfSystem)) labelled('Benefits of System -', q.benefitsOfSystem, { gap: 110 });
    if (hasText(q.capacity)) labelled('Capacity -', q.capacity);
    if (hasText(q.technicalDescription)) paragraph(q.technicalDescription, { gapBefore: 8 });
    if (hasText(q.designApproval)) paragraph(q.designApproval, { gapBefore: 8 });

    signatureBlock({ withApprovals: true });

    /* ================= PAGE 2 — PRICING ================= */
    newPage();
    titleBand(`Supply & Installation of ${isSolar ? 'Solar PV' : str(q.division) || ''} System`.replace(/\s+/g, ' '));

    if (isSolar) {
      const rows = allItems.map((item) => {
        const t = str(item.rowType || 'item');
        if (t === 'heading' || t === 'spec') {
          return { cells: ['', str(item.description), '', '', '', '', '', ''], bold: t === 'heading', wide: true };
        }
        const basic = item.supplyAmount || 0;
        const itemGst = item.gstPercent != null ? item.gstPercent : gstPct;
        const withGst = item.amountWithGst || Math.round(basic * (1 + itemGst / 100));
        return {
          cells: [
            item.sNo ? String(item.sNo) : '', str(item.description), str(item.unit), str(item.qty ?? ''),
            num(item.supplyRate), num(basic), `${itemGst}%`, num(withGst),
          ],
        };
      });
      if (!rows.length) rows.push({ cells: ['', 'No items on this quotation.', '', '', '', '', '', ''] });
      rows.push({ cells: ['', 'TOTAL (Basic)', '', '', '', '', num(q.subtotal), ''], bold: true, fill: C.yellow, mergeFrom: 6 });
      rows.push({ cells: ['', 'GRAND TOTAL WITH GST', '', '', '', '', num(q.grandTotal), ''], bold: true, fill: C.green, mergeFrom: 6 });
      itemTable([
        { title: 'S No', width: 32, align: 'center' },
        { title: 'Description', width: 190 },
        { title: 'Unit', width: 32, align: 'center' },
        { title: 'Qty', width: 30, align: 'center' },
        { title: 'Supply', width: 52, align: 'right' },
        { title: 'Basic Amount', width: 60, align: 'right' },
        { title: 'GST %', width: 32, align: 'right' },
        { title: 'Amount with GST', width: 72, align: 'right' },
      ], rows, false);
    } else {
      const rows = [];
      /**
       * A total row: the label sits in the description column and the value
       * spans the amount columns (and the GST column when there is one), so a
       * total is never printed under a heading it does not belong to.
       */
      const totalRow = (label, value, fill) => {
        const pair = Array.isArray(value);
        const cells = ['', label, '', '', '', '', pair ? value[0] : value, pair ? value[1] : ''];
        if (perItemGst) cells.push('');
        const row = { cells, bold: true };
        if (fill) row.fill = fill;
        if (!pair) row.mergeFrom = 6;
        return row;
      };
      const lineCells = (item) => {
        const t = str(item.rowType || 'item');
        const blanks = perItemGst ? ['', '', '', '', '', '', ''] : ['', '', '', '', '', ''];
        if (t === 'heading') {
          return { cells: ['', str(item.description), ...blanks], bold: true, wide: true };
        }
        if (t === 'spec') {
          return { cells: ['', str(item.description), ...blanks], wide: true };
        }
        const cells = [
          item.sNo ? String(item.sNo) : '', str(item.description), str(item.unit), str(item.qty ?? ''),
          num(item.supplyRate), num(item.installationRate), num(item.supplyAmount), num(item.installationAmount),
        ];
        if (perItemGst) {
          const pct = item.gstPercent !== null && item.gstPercent !== undefined ? Number(item.gstPercent) : gstPct;
          cells.push(`${pct}%`);
        }
        return { cells };
      };
      if (eqItems.length) {
        rows.push({ cells: ['A', 'Equipment', '', '', '', '', '', ''], bold: true });
        eqItems.forEach((item) => rows.push(lineCells(item)));
        rows.push(totalRow('Sub Total', [num(q.equipmentSupplyTotal), num(q.equipmentInstallTotal)]));
        rows.push(totalRow('TOTAL Equipment (Basic)', num(q.equipmentTotal), C.yellow));
        rows.push(totalRow(`TOTAL Equipment (${gstLabel})`, num(sectionWithGst(q.equipmentTotal, q.equipmentGstAmount)), C.yellow));
      }
      if (accItems.length) {
        rows.push({ cells: ['B', 'Accessories', '', '', '', '', '', ''], bold: true });
        accItems.forEach((item) => rows.push(lineCells(item)));
        rows.push(totalRow('Sub Total', [num(q.accessoriesSupplyTotal), num(q.accessoriesInstallTotal)]));
        rows.push(totalRow('TOTAL Accessories (Basic)', num(q.accessoriesTotal), C.yellow));
        rows.push(totalRow(`TOTAL Accessories (${gstLabel})`, num(sectionWithGst(q.accessoriesTotal, q.accessoriesGstAmount)), C.yellow));
      }
      if (!rows.length) rows.push({ cells: ['', 'No items on this quotation.', '', '', '', '', '', ''] });
      rows.push(totalRow('GRAND TOTAL (BASIC)', num(q.subtotal), C.yellow));
      rows.push(totalRow('GRAND TOTAL WITH GST', num(q.grandTotal), C.green));

      const cols = [
        { title: 'S No', width: 28, align: 'center' },
        { title: 'Description', width: perItemGst ? 150 : 168 },
        { title: 'Unit', width: 30, align: 'center' },
        { title: 'Qty', width: 28, align: 'center' },
        { title: '', sub: 'Supply', group: 'Unit Rate', groupStart: true, width: 54, align: 'right' },
        { title: '', sub: 'Installation', width: 54, align: 'right' },
        { title: '', sub: 'Supply', group: 'Amount', groupStart: true, width: 61, align: 'right' },
        { title: '', sub: 'Installation', width: 61, align: 'right' },
      ];
      if (perItemGst) cols.push({ title: 'GST %', width: 32, align: 'right' });
      itemTable(cols, rows, true);
    }

    signatureBlock();

    /* ================= PAGE 3 — TERMS ================= */
    newPage();
    greenBand('COMMERCIAL TERMS AND CONDITIONS.');

    const termCol = W * 0.45;
    const AMOUNT_W = 118; // wide enough for "₹ 1,35,792.00" on one line
    const termTextW = W - termCol - AMOUNT_W - 14;
    function termRow(label, lines) {
      const body = (Array.isArray(lines) ? lines : [lines]).filter((l) => hasText(l.text ?? l));
      if (!body.length) return;
      let h = 0;
      body.forEach((l) => {
        h += doc.font('R').fontSize(9).heightOfString(str(l.text ?? l), { width: termTextW }) + 2;
      });
      h = Math.max(h + 6, 18);
      ensure(h);
      const y = doc.y;
      doc.font('R').fontSize(9).fillColor(C.ink).text(label, L + 8, y + 3, { width: termCol - 16 });
      let ly = y + 3;
      body.forEach((l) => {
        const t = str(l.text ?? l);
        doc.font('R').fontSize(9).fillColor(C.ink).text(t, L + termCol, ly, { width: termTextW });
        const textBottom = doc.y; // the amount is shorter; the wrapped text sets the row height
        if (l.amount !== undefined && l.amount !== null) {
          doc.font('R').fontSize(9).fillColor(C.ink)
            .text(money(l.amount), RIGHT - AMOUNT_W - 8, ly, { width: AMOUNT_W, align: 'right' });
        }
        ly = textBottom + 2;
      });
      doc.y = Math.max(y + h, ly + 2);
    }

    const terms = Array.isArray(q.paymentTerms) ? q.paymentTerms : [];
    const paymentLines = [{ text: `For order has to be placed on '${coName}'.` }];
    if (terms.length) {
      terms.forEach((t) => {
        const pct = str(t.percentage).replace(/%$/, '').trim();
        const label = [pct ? `${pct}%` : '', str(t.label), hasText(t.triggerEvent) ? str(t.triggerEvent) : '', hasText(t.wording) ? `— ${str(t.wording)}` : '']
          .filter(Boolean).join(' ');
        const amount = pct !== '' && !Number.isNaN(Number(pct))
          ? (Number(q.grandTotal) || 0) * Number(pct) / 100
          : null;
        paymentLines.push({ text: label, amount });
      });
    } else {
      paymentLines.push({ text: '100% Advance along with work order.' });
    }

    termRow('TAXES', [{ text: 'GST as shown' }]);
    termRow('Payment', paymentLines);
    termRow('Offer Validity  :', [{ text: hasText(q.offerValidity) ? str(q.offerValidity) : '30 days' }]);
    if (hasText(q.delivery)) termRow('Delivery', [{ text: str(q.delivery) }]);
    if (hasText(q.notes)) termRow('Final Billing', [{ text: str(q.notes) }]);

    const bank = co.bankDetails || {};
    if (hasText(bank.bankName) || hasText(bank.accountNumber) || hasText(bank.ifscCode)) {
      greenBand('BANK DETAILS.');
      doc.font('R').fontSize(9).fillColor(C.ink);
      [
        `Bank : ${str(bank.bankName)}`,
        `Account Holder Name : ${str(bank.accountHolderName || co.displayName || co.name)}`,
        `Account Number: ${str(bank.accountNumber)}`,
        `IFSC Code : ${str(bank.ifscCode)}`,
        hasText(bank.branch) ? `Branch : ${str(bank.branch)}` : '',
      ].filter(Boolean).forEach((l) => {
        ensure(14);
        doc.font('R').fontSize(9).fillColor(C.ink).text(l, L + 8, doc.y + 1, { width: W - 16 });
      });
      doc.y += 4;
    }

    const excluded = (Array.isArray(q.excludedWorks) ? q.excludedWorks : []).filter(hasText);
    if (excluded.length) {
      greenBand('EXCLUDED WORKS.');
      excluded.forEach((w, i) => {
        const h = doc.font('R').fontSize(9).heightOfString(str(w), { width: W - 110 }) + 6;
        ensure(h);
        const y = doc.y + 2;
        doc.font('R').fontSize(9).fillColor(C.ink).text(String(i + 1), L + 26, y, { width: 16 });
        doc.font('R').fontSize(9).fillColor(C.ink).text(':', L + 56, y, { width: 10 });
        doc.font('R').fontSize(9).fillColor(C.ink).text(str(w), L + 96, y, { width: W - 110 });
        doc.y = y + h - 4;
      });
      doc.y += 4;
    }

    closeBox();

    /* ---------- Footer under the box on every page ---------- */
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
      doc.font('R').fontSize(7).fillColor(C.muted).text(
        `${ref}${ref ? ' · ' : ''}Page ${i + 1} of ${range.count}`,
        L, doc.page.height - savedBottom + 12, { width: W, align: 'center', lineBreak: false }
      );
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

module.exports = { buildQuotationPdf, imageBuffer };
