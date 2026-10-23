'use strict';

/**
 * Service Report PDF (owner decision, 21 Oct 2026).
 *
 * A completed Service Call (Complaint or AMC/PM visit) is sent to the client
 * as a PDF: company letterhead + logo, call and customer details, the full
 * report with the tick/cross checklist, the amount, and the client's
 * signature. Rendered server-side with pdfkit; DejaVu Sans is bundled
 * (assets/fonts) because the PDF standard fonts have no ₹, ✓ or ✗ glyphs.
 *
 * Pure function of its inputs -- no database access here.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

const C = {
  navy: '#16202e',
  red: '#d92b2b',
  text: '#1c2733',
  muted: '#5b6b7c',
  line: '#e3e8ef',
  soft: '#f2f4f8',
  okBg: '#e2f6ec',
  okInk: '#137a47',
  badBg: '#fde8e8',
  badInk: '#b91c1c',
};

const CHECKLIST_KEYS = ['Cooling Testing', 'Gas Pressure', 'Filter Clean', 'Indoor Coil', 'Outdoor Coil', 'Body Cleaning'];

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
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toISOString().slice(0, 10);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `₹ ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function text(v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s || '—';
}

/**
 * @param {object} p
 * @param {object} p.company      Company document (displayName/name, logoBase64, address, city, phone, email, website, gstNumber, tagline, subtitle)
 * @param {object} p.serviceCall  ServiceCall document (Completed)
 * @param {string} [p.engineerName]
 * @returns {Promise<Buffer>}
 */
function buildServiceReportPdf({ company, serviceCall, engineerName }) {
  return new Promise((resolve, reject) => {
    const co = company || {};
    const sc = serviceCall || {};
    const r = sc.report || {};
    const checklist = r.checklistResults instanceof Map ? Object.fromEntries(r.checklistResults) : r.checklistResults || {};
    const psc = `PSC-${sc.complaintNumber}`;

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 40, bottom: 50, left: 42, right: 42 },
      info: { Title: `Service Report ${psc}`, Author: co.displayName || co.name || '', Subject: 'Service Report' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('R', FONT_REGULAR);
    doc.registerFont('B', FONT_BOLD);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 20;
    const ensure = (h) => {
      if (doc.y + h > bottomLimit()) doc.addPage();
    };

    /* ---------- Letterhead ---------- */
    const top = doc.y;
    let textX = L;
    const logo = imageBuffer(co.logoBase64);
    if (logo) {
      try {
        doc.image(logo, L, top, { fit: [64, 64] });
        textX = L + 76;
      } catch {
        textX = L;
      }
    }
    const headW = W * 0.62 - (textX - L);
    doc.font('B').fontSize(15).fillColor(C.navy).text(co.displayName || co.name || '', textX, top, { width: headW });
    const sub = co.subtitle || co.tagline;
    if (sub) doc.font('R').fontSize(8.5).fillColor(C.muted).text(sub, textX, doc.y + 1, { width: headW });
    const addr = [co.address, co.city].filter(Boolean).join(', ');
    const contact = [co.phone, co.email, co.website].filter(Boolean).join('  ·  ');
    doc.font('R').fontSize(8.5).fillColor(C.text);
    if (addr) doc.text(addr, textX, doc.y + 2, { width: headW });
    if (contact) doc.text(contact, textX, doc.y + 1, { width: headW });
    if (co.gstNumber) doc.text(`GSTIN: ${co.gstNumber}`, textX, doc.y + 1, { width: headW });
    const leftBottom = doc.y;

    const rx = L + W * 0.62;
    const rw = W * 0.38;
    doc.font('B').fontSize(17).fillColor(C.red).text('SERVICE REPORT', rx, top, { width: rw, align: 'right' });
    doc.font('B').fontSize(11).fillColor(C.navy).text(psc, rx, doc.y + 2, { width: rw, align: 'right' });
    doc.font('R').fontSize(8.5).fillColor(C.muted)
      .text(`${sc.type === 'PM' ? 'AMC service visit' : 'Complaint service'}`, rx, doc.y + 2, { width: rw, align: 'right' })
      .text(`Completed: ${fmtDate(sc.completedAt || sc.updatedAt)}`, rx, doc.y + 1, { width: rw, align: 'right' });
    const rightBottom = doc.y;

    doc.y = Math.max(leftBottom, rightBottom, top + (logo ? 64 : 0)) + 10;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(2).strokeColor(C.red).stroke();
    doc.y += 12;

    /* ---------- helpers ---------- */
    function section(title) {
      ensure(40);
      doc.font('B').fontSize(10.5).fillColor(C.navy).text(title.toUpperCase(), L, doc.y, { width: W, characterSpacing: 0.5 });
      doc.y += 4;
    }

    function grid(rows, cols = 2) {
      const colW = W / cols;
      for (let i = 0; i < rows.length; i += cols) {
        const slice = rows.slice(i, i + cols);
        const heights = slice.map(([, v]) => doc.font('R').fontSize(9.5).heightOfString(text(v), { width: colW - 12 }) + 14);
        const h = Math.max(...heights);
        ensure(h + 4);
        const y = doc.y;
        slice.forEach(([k, v], j) => {
          const x = L + j * colW;
          doc.font('B').fontSize(7.5).fillColor(C.muted).text(k.toUpperCase(), x, y, { width: colW - 12, characterSpacing: 0.3 });
          doc.font('R').fontSize(9.5).fillColor(C.text).text(text(v), x, y + 11, { width: colW - 12 });
        });
        doc.y = y + h;
      }
      doc.y += 6;
    }

    function block(label, value) {
      const v = text(value);
      const h = doc.font('R').fontSize(9.5).heightOfString(v, { width: W - 20 }) + 16;
      ensure(h + 16);
      if (label) doc.font('B').fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), L, doc.y, { width: W });
      const y = doc.y + 3;
      doc.roundedRect(L, y, W, h, 4).fillColor(C.soft).fill();
      doc.font('R').fontSize(9.5).fillColor(C.text).text(v, L + 10, y + 8, { width: W - 20 });
      doc.y = y + h + 8;
    }

    /* ---------- Call & customer ---------- */
    section('Customer & call details');
    grid([
      ['Customer', sc.customer],
      ['Phone', sc.phone],
      ['Site', sc.site],
      ['Call number', psc],
      ['Call type', sc.type === 'PM' ? 'AMC service visit' : 'Complaint'],
      ['Registered', fmtDate(sc.registeredDate)],
      ['Appointment', [fmtDate(sc.appointmentDate), sc.appointmentTime].filter((x) => x && x !== '—').join(' ') || '—'],
      ['Engineer', engineerName],
    ]);
    if (sc.type !== 'PM' && sc.complaintDescription) block('Complaint', sc.complaintDescription);

    /* ---------- Equipment ---------- */
    section('Equipment');
    grid([
      ['Make', r.make],
      ['Model', r.model],
      ['Capacity', r.capacity],
      ['Unit type', r.type],
      ['Material used', r.materialUsed],
      ['Service type', r.serviceType],
    ], 3);

    /* ---------- Work done ---------- */
    section('Service done');
    block(null, r.serviceDescription);

    /* ---------- Checklist ---------- */
    section('Checklist');
    {
      const rowH = 22;
      ensure(rowH * 3 + 10);
      const half = Math.ceil(CHECKLIST_KEYS.length / 2);
      const colW = (W - 12) / 2;
      const y0 = doc.y;
      CHECKLIST_KEYS.forEach((key, i) => {
        const col = i < half ? 0 : 1;
        const row = i < half ? i : i - half;
        const x = L + col * (colW + 12);
        const y = y0 + row * (rowH + 4);
        const v = checklist[key];
        doc.roundedRect(x, y, colW, rowH, 4).lineWidth(0.8).strokeColor(C.line).stroke();
        doc.font('R').fontSize(9.5).fillColor(C.text).text(key, x + 10, y + 6, { width: colW - 110 });
        let label = text(v);
        let bg = C.soft;
        let ink = C.muted;
        if (v === 'Done') { label = '✓  Done'; bg = C.okBg; ink = C.okInk; }
        if (v === 'Not done') { label = '✗  Not done'; bg = C.badBg; ink = C.badInk; }
        doc.roundedRect(x + colW - 92, y + 4, 84, rowH - 8, 7).fillColor(bg).fill();
        doc.font('B').fontSize(8.5).fillColor(ink).text(label, x + colW - 92, y + 7, { width: 84, align: 'center' });
      });
      doc.y = y0 + half * (rowH + 4) + 8;
    }

    /* ---------- Parts & gas (owner request, 22 Oct 2026) ---------- */
    const parts = Array.isArray(r.partsWork) ? r.partsWork.filter((p) => p && p.part) : [];
    if (parts.length) {
      section('Parts');
      const rowH = 20;
      parts.forEach((p) => {
        const remarkH = p.remark ? doc.font('R').fontSize(8.5).heightOfString(String(p.remark), { width: W - 200 }) : 0;
        const h = Math.max(rowH, remarkH + 10);
        ensure(h + 4);
        const y = doc.y;
        doc.roundedRect(L, y, W, h, 4).lineWidth(0.8).strokeColor(C.line).stroke();
        doc.font('R').fontSize(9.5).fillColor(C.text).text(String(p.part), L + 10, y + 5, { width: 170 });
        const replaced = p.action === 'Replaced';
        doc.roundedRect(L + 186, y + 3, 70, rowH - 6, 7).fillColor(replaced ? C.badBg : C.okBg).fill();
        doc.font('B').fontSize(8.5).fillColor(replaced ? C.badInk : C.okInk)
          .text(String(p.action || ''), L + 186, y + 6, { width: 70, align: 'center' });
        if (p.remark) doc.font('R').fontSize(8.5).fillColor(C.muted).text(String(p.remark), L + 266, y + 5, { width: W - 276 });
        doc.y = y + h + 4;
      });
      doc.y += 4;
    }
    if (r.gasFilled) {
      section('Gas filling');
      grid([
        ['Gas filled', 'Yes'],
        ['Gas type', r.gasType],
        ['Quantity', Number(r.gasQtyKg) > 0 ? `${r.gasQtyKg} kg` : '—'],
      ], 3);
    }

    /* ---------- Remarks ---------- */
    if ((r.engineerRemark && String(r.engineerRemark).trim()) || (r.customerRemark && String(r.customerRemark).trim())) {
      section('Remarks');
      grid([
        ['Engineer remark', r.engineerRemark],
        ['Customer remark', r.customerRemark],
      ]);
    }

    /* ---------- Amount ---------- */
    section('Charges');
    {
      ensure(34);
      const y = doc.y;
      let label;
      if (r.serviceType === 'Chargeable') label = Number(r.amount) > 0 ? fmtMoney(r.amount) : 'No charge';
      else if (r.serviceType === 'AMC') label = 'Covered under AMC';
      else if (r.serviceType === 'Warranty') label = 'Covered under warranty';
      else label = Number(r.amount) > 0 ? fmtMoney(r.amount) : 'No charge';
      doc.roundedRect(L, y, W, 28, 4).fillColor(C.soft).fill();
      doc.font('R').fontSize(9.5).fillColor(C.muted).text('Service charges', L + 10, y + 8, { width: W / 2 });
      doc.font('B').fontSize(11).fillColor(C.navy).text(label, L + W / 2, y + 7, { width: W / 2 - 10, align: 'right' });
      doc.y = y + 40;
    }

    /* ---------- Signatures ---------- */
    ensure(120);
    {
      const y = doc.y;
      const boxW = (W - 20) / 2;
      const sig = imageBuffer(sc.clientSignatureImage);
      doc.roundedRect(L, y, boxW, 80, 4).lineWidth(0.8).strokeColor(C.line).stroke();
      if (sig) {
        try { doc.image(sig, L + 8, y + 6, { fit: [boxW - 16, 68], align: 'center', valign: 'center' }); } catch { /* unreadable image: leave the box empty */ }
      }
      doc.font('B').fontSize(8.5).fillColor(C.text).text('Client signature', L, y + 86, { width: boxW });
      doc.font('R').fontSize(8).fillColor(C.muted).text(`${text(sc.customer)} · ${fmtDate(sc.completedAt || sc.updatedAt)}`, L, doc.y + 1, { width: boxW });

      const x2 = L + boxW + 20;
      doc.roundedRect(x2, y, boxW, 80, 4).lineWidth(0.8).strokeColor(C.line).stroke();
      doc.font('R').fontSize(9).fillColor(C.muted).text('Service attended by', x2 + 10, y + 26, { width: boxW - 20, align: 'center' });
      doc.font('B').fontSize(11).fillColor(C.navy).text(text(engineerName), x2 + 10, y + 40, { width: boxW - 20, align: 'center' });
      doc.font('B').fontSize(8.5).fillColor(C.text).text(`For ${co.displayName || co.name || ''}`, x2, y + 86, { width: boxW });
      doc.y = y + 118;
    }

    /* ---------- Footer on every page ---------- */
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
      const fy = doc.page.height - savedBottom + 14;
      doc.font('R').fontSize(7.5).fillColor(C.muted).text(
        `${psc} · This is a computer-generated service report signed by the client on site.   Page ${i + 1} of ${range.count}`,
        L, fy, { width: W, align: 'center', lineBreak: false }
      );
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

module.exports = { buildServiceReportPdf, imageBuffer };
