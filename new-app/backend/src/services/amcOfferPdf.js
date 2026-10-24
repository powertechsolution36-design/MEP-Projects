'use strict';

/**
 * AMC offer PDF — comprehensive and non-comprehensive (owner request,
 * 24 Oct 2026).
 *
 * WHY: the AMC document page used to print by writing its own HTML and
 * stylesheet into a pop-up window, so what was previewed, what came out of
 * the printer and what the client received were three different layouts —
 * and none of them matched the company's own sheets. This renders the one
 * document, on the server, the way the quotation and the AMC letter already
 * do.
 *
 * SOURCE: "AMC - Comp copy.xlsx" and "AMC - Non Comp.xlsx" (C:\Quotation) —
 * letterhead on every page; a SUMMARY page carrying the subject, the
 * introduction and the contract description; then the priced table with its
 * yellow TOTAL rows followed by the numbered (SPMS) service terms; then
 * COMMERCIAL TERMS AND CONDITIONS, BANK DETAILS and EXCLUDED WORKS.
 *
 * The wording is the company's AMC template (Company Profile → AMC
 * documents), so an edited template prints as edited; nothing is hardcoded
 * to one tenant. Pure function of its inputs — no database access here.
 * Fonts as the quotation: Bookman-compatible for the letterhead, Carlito for
 * text, Liberation Serif for the footer.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const C = {
  ink: '#000000',
  muted: '#444444',
  red: '#c00000',
  navy: '#002060',
  yellow: '#ffff00', // TOTAL rows, as in the workbook
  band: '#ccffcc', // COMMERCIAL TERMS / BANK DETAILS / EXCLUDED WORKS bands
  line: '#000000',
  footer: '#1f3864',
};

/** Sections with a fixed place; everything else becomes a numbered term. */
const FIXED = new Set([
  'subject', 'introduction', 'contract_description', 'spms_heading',
  'commercial_heading', 'taxes', 'payment', 'offer_validity', 'delivery',
  'final_billing', 'excluded_works',
]);

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

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

function money(n) {
  const v = Number(n) || 0;
  return `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB');
}

/** Lines that look like "1. …", "2. …" — the workbook's sub-point lists. */
function isSubPointList(content) {
  const lines = str(content).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every((l) => /^\d+[.)]\s/.test(l));
}

/**
 * @param {object} p
 * @param {object} p.company       Company Profile fields (see amcLetterPdf)
 * @param {object} p.contract      { customer, site, phone, capacity, amcType, amount, startDate, endDate }
 * @param {Array}  p.sections      template sections, placeholders already filled
 * @param {string} p.documentType  'comprehensive' | 'non-comprehensive'
 * @returns {Promise<Buffer>}
 */
function buildAmcOfferPdf({ company, contract, sections, documentType }) {
  return new Promise((resolve, reject) => {
    const co = company || {};
    const ct = contract || {};
    const person = co.authorizedPerson || {};
    const comprehensive = documentType !== 'non-comprehensive';
    const coverLabel = comprehensive ? 'Comprehensive' : 'Non Comprehensive';

    const list = (Array.isArray(sections) ? sections : [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const byKey = new Map(list.map((s) => [s.key, s]));
    const text = (key) => str(byKey.get(key) && byKey.get(key).content).trim();

    const amount = Number(ct.amount) || 0;
    const gstPct = 18;
    const withGst = Math.round(amount * (1 + gstPct / 100) * 100) / 100;

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 40, bottom: 72, left: 46, right: 46 },
      info: {
        Title: `${coverLabel} AMC — ${str(ct.customer) || str(ct.site)}`,
        Author: str(co.name),
        Subject: `${coverLabel} Maintenance Contract`,
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('R', path.join(FONT_DIR, 'Carlito-Regular.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'Carlito-Bold.ttf'));
    doc.registerFont('H', path.join(FONT_DIR, 'texgyrebonum-bold.otf'));
    doc.registerFont('S', path.join(FONT_DIR, 'LiberationSerif-Bold.ttf'));

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const logo = imageBuffer(co.logoBase64);

    /* ---------- Letterhead, repeated on every page ---------- */
    function letterhead() {
      const top = 26;
      if (logo) {
        try { doc.image(logo, L, top, { fit: [180, 42] }); } catch { /* unreadable logo: skip */ }
      }
      const nameX = L + 190;
      const nameW = W - 190;
      doc.font('H').fontSize(15).fillColor(C.red)
        .text(str(co.name).toUpperCase(), nameX, top + 2, { width: nameW, align: 'center' });
      if (co.subtitle) {
        doc.font('H').fontSize(11).fillColor(C.red)
          .text(str(co.subtitle), nameX, doc.y, { width: nameW, align: 'center' });
      }
      const addr = [co.address, co.city].filter(Boolean).join(', ');
      const contact = [addr, co.email, co.website].filter(Boolean).join('\n');
      if (contact) {
        doc.font('B').fontSize(8.5).fillColor(C.ink)
          .text(contact, nameX, doc.y + 1, { width: nameW, align: 'center' });
      }
      if (co.tagline) {
        doc.font('S').fontSize(9).fillColor(C.navy)
          .text(`"${str(co.tagline)}"`, L, top + 46, { width: 180, align: 'center' });
      }
      doc.y = Math.max(doc.y + 6, 104);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.8).strokeColor(C.line).stroke();
      doc.y += 8;
      doc.font('B').fontSize(9).fillColor(C.ink)
        .text(fmtDate(new Date()), L, doc.y, { width: W, align: 'right' });
      doc.y += 6;
    }
    doc.on('pageAdded', letterhead);
    letterhead();

    function ensure(h) {
      if (doc.y + h > bottom()) doc.addPage();
    }

    function band(label) {
      ensure(26);
      doc.rect(L, doc.y, W, 16).fill(C.band);
      doc.font('B').fontSize(10).fillColor(C.ink).text(label, L + 6, doc.y + 3.5, { width: W - 12 });
      doc.y += 22;
    }

    function centreBand(label) {
      ensure(26);
      doc.font('B').fontSize(10.5).fillColor(C.ink).text(label, L, doc.y, { width: W, align: 'center' });
      doc.y += 16;
    }

    function para(t, { font = 'R', size = 10, gap = 7, color = C.ink, indent = 0, align } = {}) {
      const v = str(t).trim();
      if (!v) return;
      const h = doc.font(font).fontSize(size).heightOfString(v, { width: W - indent });
      ensure(h + gap);
      doc.font(font).fontSize(size).fillColor(color)
        .text(v, L + indent, doc.y, { width: W - indent, align });
      doc.y += gap;
    }

    function numbered(n, t) {
      const v = str(t).trim();
      if (!v) return;
      const numW = 22;
      const h = doc.font('B').fontSize(10).heightOfString(v, { width: W - numW });
      ensure(h + 4);
      const y = doc.y;
      doc.font('B').fontSize(10).fillColor(C.ink).text(`${n})`, L, y, { width: numW });
      doc.font('B').fontSize(10).fillColor(C.ink).text(v, L + numW, y, { width: W - numW });
      doc.y = Math.max(doc.y, y + h) + 4;
    }

    function subPoint(t) {
      const v = str(t).trim();
      if (!v) return;
      const indent = 34;
      const h = doc.font('B').fontSize(10).heightOfString(v, { width: W - indent });
      ensure(h + 2);
      doc.font('B').fontSize(10).fillColor(C.ink).text(v, L + indent, doc.y, { width: W - indent });
      doc.y += 2;
    }

    /* ================= Page 1 — SUMMARY ================= */
    centreBand('SUMMARY');

    const quoteLines = [str(ct.customer).replace(/,\s*$/, ''), str(ct.site)].filter(Boolean);
    if (quoteLines.length) {
      ensure(40);
      const y = doc.y;
      doc.font('B').fontSize(10).fillColor(C.ink).text('Quote To -', L, y, { width: 70 });
      doc.font('R').fontSize(10).fillColor(C.ink)
        .text(quoteLines.join('\n'), L + 76, y, { width: W - 76 });
      doc.y = Math.max(doc.y, y) + 10;
    }

    para(text('subject'), { font: 'B', size: 10.5, gap: 10 });
    para(text('introduction'), { gap: 10 });
    para(text('contract_description'), { gap: 14 });

    /* "Yours truly" block */
    ensure(70);
    para('Yours truly,', { gap: 2 });
    para(`For ${str(co.name).toUpperCase()}`, { font: 'B', gap: 6 });
    if (person.name) para(str(person.name), { gap: 1 });
    if (person.contactPhone || co.phone) para(`Mob: ${str(person.contactPhone || co.phone)}`, { gap: 2 });

    /* ================= Page 2 — the priced table ================= */
    doc.addPage();
    centreBand('SUPPLY & INSTALLATION OF HVAC SYSTEM');

    // Column layout, following the workbook: S No | Description | Unit | Qty |
    // Unit Rate (Supply / Installation) | Amount (Supply / Installation).
    const colW = [34, W - 34 - 44 - 36 - 72 - 72 - 76, 44, 36, 72, 72, 76];
    const xs = [];
    colW.reduce((x, w) => { xs.push(x); return x + w; }, L);

    function cellText(t, i, y, h, { font = 'R', size = 9, align = 'center' } = {}) {
      const v = str(t);
      if (!v) return;
      const th = doc.font(font).fontSize(size).heightOfString(v, { width: colW[i] - 8 });
      doc.font(font).fontSize(size).fillColor(C.ink)
        .text(v, xs[i] + 4, y + Math.max(2, (h - th) / 2), { width: colW[i] - 8, align });
    }

    function row(cells, { h, font = 'R', fill = null, align = 'center', descAlign = 'left' } = {}) {
      const descH = doc.font(font).fontSize(9).heightOfString(str(cells[1]), { width: colW[1] - 8 });
      const rowH = h || Math.max(18, descH + 8);
      ensure(rowH);
      const y = doc.y;
      if (fill) doc.rect(L, y, W, rowH).fill(fill);
      doc.lineWidth(0.5).strokeColor(C.line);
      let x = L;
      colW.forEach((w) => { doc.moveTo(x, y).lineTo(x, y + rowH).stroke(); x += w; });
      doc.moveTo(L + W, y).lineTo(L + W, y + rowH).stroke();
      doc.moveTo(L, y).lineTo(L + W, y).stroke();
      doc.moveTo(L, y + rowH).lineTo(L + W, y + rowH).stroke();
      cells.forEach((c, i) => cellText(c, i, y, rowH, { font, align: i === 1 ? descAlign : align }));
      doc.y = y + rowH;
    }

    // Header, two bands as in the workbook.
    const hy = doc.y;
    const headH = 30;
    ensure(headH);
    doc.lineWidth(0.5).strokeColor(C.line);
    // Full-height cells: S No, Description, Unit, Qty and Amount. "Unit Rate"
    // spans two columns across the top half only, with Supply / Installation
    // beneath it — so no divider is drawn through the "Unit Rate" label.
    [0, 1, 2, 3, 6].forEach((i) => doc.rect(xs[i], hy, colW[i], headH).stroke());
    doc.rect(xs[4], hy, colW[4] + colW[5], headH / 2).stroke();
    doc.rect(xs[4], hy + headH / 2, colW[4], headH / 2).stroke();
    doc.rect(xs[5], hy + headH / 2, colW[5], headH / 2).stroke();
    const hdr = (t, i, y, h, w) => doc.font('B').fontSize(9).fillColor(C.ink)
      .text(t, xs[i] + 3, y + (h - 10) / 2, { width: (w || colW[i]) - 6, align: 'center' });
    hdr('S No', 0, hy, headH);
    hdr('Description', 1, hy, headH);
    hdr('Unit', 2, hy, headH);
    hdr('Qty', 3, hy, headH);
    hdr('Unit Rate', 4, hy, headH / 2, colW[4] + colW[5]);
    hdr('Supply', 4, hy + headH / 2, headH / 2);
    hdr('Installation', 5, hy + headH / 2, headH / 2);
    hdr('Amount', 6, hy, headH);
    doc.y = hy + headH;

    // The contract itself: a numbered line naming the cover, then the system.
    row(['1', `${coverLabel} Maintenance Contract for ${str(ct.site) || str(ct.customer)}`, '', '', '', '', ''], { font: 'B' });
    const systemLine = [str(ct.capacity), 'System AMC'].filter(Boolean).join(' ');
    row(['', systemLine, 'Lot', '1', '', money(amount), money(amount)], { font: 'B' });
    row(['', 'Sub Total', '', '', '', '', money(amount)], { font: 'B' });
    row(['', 'TOTAL (Basic)', '', '', '', '', money(amount)], { font: 'B', fill: C.yellow });
    row(['', `TOTAL (with ${gstPct}% GST)`, '', '', '', '', money(withGst)], { font: 'B', fill: C.yellow });
    doc.y += 14;

    /* ---------- (SPMS) numbered service terms ---------- */
    para(text('spms_heading'), { font: 'R', gap: 8 });
    let n = 0;
    list.forEach((s) => {
      if (FIXED.has(s.key)) return;
      n += 1;
      if (isSubPointList(s.content)) {
        numbered(n, 'The routine servicing will cover the following:');
        str(s.content).split('\n').map((x) => x.trim()).filter(Boolean).forEach(subPoint);
        doc.y += 4;
      } else {
        numbered(n, s.content);
      }
    });

    /* ================= Page 3 — commercial terms ================= */
    doc.addPage();
    band(text('commercial_heading') || 'COMMERCIAL TERMS AND CONDITIONS.');

    function termRow(label, value) {
      const v = str(value).trim();
      if (!v) return;
      const h = doc.font('R').fontSize(10).heightOfString(v, { width: W - 130 });
      ensure(h + 8);
      const y = doc.y;
      doc.font('R').fontSize(10).fillColor(C.ink).text(label, L, y, { width: 120 });
      doc.font('B').fontSize(10).fillColor(C.ink).text(v, L + 130, y, { width: W - 130 });
      doc.y = Math.max(doc.y, y + h) + 8;
    }
    termRow('TAXES', text('taxes') || 'GST as shown');
    termRow('Payment', text('payment'));
    termRow('Offer Validity  :', text('offer_validity') || '30 days');
    termRow('Delivery', text('delivery'));
    termRow('Final Billing', text('final_billing'));
    doc.y += 6;

    /* ---------- Bank details ---------- */
    const bank = co.bankDetails || {};
    const bankRows = [
      ['Bank :', bank.bankName],
      ['Account Holder Name :', bank.accountHolder || co.name],
      ['Account Number:', bank.accountNumber],
      ['IFSC Code :', bank.ifsc || bank.ifscCode],
      ['Branch :', bank.branch],
    ].filter(([, v]) => str(v).trim());
    if (bankRows.length) {
      band(text('bank_heading') || 'BANK DETAILS.');
      bankRows.forEach(([k, v]) => {
        ensure(16);
        const y = doc.y;
        doc.font('R').fontSize(10).fillColor(C.ink).text(k, L, y, { width: 150 });
        doc.font('B').fontSize(10).fillColor(C.ink).text(str(v), L + 155, y, { width: W - 155 });
        doc.y = y + 15;
      });
      doc.y += 6;
    }

    /* ---------- Excluded works ---------- */
    const excluded = str(text('excluded_works')).split('\n').map((x) => x.trim()).filter(Boolean);
    if (excluded.length) {
      band('EXCLUDED WORKS.');
      excluded.forEach((line, i) => {
        // The template already numbers these ("1. …"); keep its own numbering.
        const m = /^(\d+)[.)]\s*(.*)$/.exec(line);
        const no = m ? m[1] : String(i + 1);
        const body = m ? m[2] : line;
        const h = doc.font('R').fontSize(10).heightOfString(body, { width: W - 60 });
        ensure(h + 6);
        const y = doc.y;
        doc.font('R').fontSize(10).fillColor(C.ink).text(no, L + 10, y, { width: 20 });
        doc.font('R').fontSize(10).fillColor(C.ink).text(':', L + 34, y, { width: 10 });
        doc.font('R').fontSize(10).fillColor(C.ink).text(body, L + 50, y, { width: W - 60 });
        doc.y = Math.max(doc.y, y + h) + 6;
      });
    }

    /* ---------- Footer on every page ---------- */
    const office = str(co.whatsappNumber || co.phone);
    const addrLine = [co.address, co.city].filter(Boolean).join(', ');
    const line1 = `Head Office – ${str(co.name).toUpperCase()}${addrLine ? `,  ${addrLine}` : ''}`;
    const line2 = [
      co.email ? `Email :- ${co.email}` : '',
      co.website ? `Website :- ${co.website}` : '',
      office ? `Ph No :- ${office}` : '',
      co.gstNumber ? `GSTIN – ${co.gstNumber}` : '',
    ].filter(Boolean).join('   ');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - saved + 18;
      doc.font('S').fontSize(8.5).fillColor(C.ink)
        .text(line1, L, fy, { width: W, align: 'center', lineBreak: false });
      doc.moveTo(L, fy + 13).lineTo(L + W, fy + 13).lineWidth(0.6).strokeColor('#8eaadb').stroke();
      doc.font('S').fontSize(8).fillColor(C.footer)
        .text(line2, L, fy + 17, { width: W, align: 'center', lineBreak: false });
      doc.font('R').fontSize(7.5).fillColor(C.muted)
        .text(`${coverLabel} AMC · Page ${i - range.start + 1} of ${range.count}`,
          L, fy + 29, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

module.exports = { buildAmcOfferPdf };
