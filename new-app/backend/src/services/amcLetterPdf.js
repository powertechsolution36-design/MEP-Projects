'use strict';

/**
 * AMC Letter PDF (owner request, 22 Oct 2026).
 *
 * Sent to the client on WhatsApp once their AMC is marked paid. The layout
 * follows the company's own "AMC Letter.docx" (C:\Quotation): logo, the
 * underlined AMC LETTER heading, the client's name and site, the proposal
 * sentence with the amount and period in bold, the numbered terms (item 4
 * carries its own numbered list of routine-service points), Payment Terms,
 * Please Note, the red "contact details" block, Sign & Stamp, and the head
 * office line at the foot of every page.
 *
 * The wording comes from the company's AMC Letter template (Company Profile →
 * AMC documents), so an edited template prints as edited. Pure function of
 * its inputs — no database access here. Fonts as the quotation: Carlito
 * (Calibri-compatible) for text, Liberation Serif for the footer.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const C = {
  ink: '#000000',
  muted: '#444444',
  red: '#c00000',
  link: '#1f4e9a',
  footer: '#1f3864',
};

// Keys with a fixed place in the letter; every other section is a numbered term.
const FIXED = new Set(['heading', 'salutation', 'acknowledgement', 'proposal', 'terms_intro', 'payment_terms', 'please_note']);
// These sit under "The routine servicing will cover the following:".
const SUB_POINTS = ['service_quality', 'n_service_vrf', 'routine_service_points'];

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

/**
 * @param {object} p
 * @param {object} p.company   { name, subtitle, address, city, phone, email, website, gstNumber,
 *                              logoBase64, authorizedPerson, whatsappNumber }
 * @param {object} p.contract  { customer, site, phone, amount, startDate, endDate }
 * @param {Array}  p.sections  template sections, placeholders already filled
 * @returns {Promise<Buffer>}
 */
function buildAmcLetterPdf({ company, contract, sections }) {
  return new Promise((resolve, reject) => {
    const co = company || {};
    const ct = contract || {};
    const person = co.authorizedPerson || {};
    const list = (Array.isArray(sections) ? sections : []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const byKey = new Map(list.map((s) => [s.key, s]));
    const text = (key) => str(byKey.get(key) && byKey.get(key).content).trim();

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 40, bottom: 78, left: 56, right: 56 },
      info: { Title: `AMC Letter — ${str(ct.customer) || str(ct.site)}`, Author: str(co.name), Subject: 'AMC Letter' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('R', path.join(FONT_DIR, 'Carlito-Regular.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'Carlito-Bold.ttf'));
    doc.registerFont('S', path.join(FONT_DIR, 'LiberationSerif-Bold.ttf'));

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const logo = imageBuffer(co.logoBase64);

    function pageHeader() {
      if (logo) {
        try { doc.image(logo, L, 26, { fit: [190, 44] }); } catch { /* unreadable logo: skip */ }
      } else if (co.name) {
        doc.font('B').fontSize(16).fillColor(C.red).text(str(co.name).toUpperCase(), L, 34, { width: W * 0.6 });
      }
      doc.y = 92;
    }
    doc.on('pageAdded', pageHeader);
    pageHeader();

    function ensure(h) {
      if (doc.y + h > bottom()) doc.addPage();
    }

    function para(t, { font = 'R', size = 10.5, gap = 8, color = C.ink, indent = 0 } = {}) {
      const v = str(t).trim();
      if (!v) return;
      const h = doc.font(font).fontSize(size).heightOfString(v, { width: W - indent });
      ensure(h + gap);
      doc.font(font).fontSize(size).fillColor(color).text(v, L + indent, doc.y, { width: W - indent });
      doc.y += gap;
    }

    /** A paragraph where the listed substrings are set in bold (amount, dates). */
    function richPara(t, boldParts, { size = 10.5, gap = 8 } = {}) {
      const v = str(t).trim();
      if (!v) return;
      const parts = boldParts.filter(Boolean);
      const h = doc.font('R').fontSize(size).heightOfString(v, { width: W }) + 4;
      ensure(h + gap);
      if (!parts.length) { para(v, { size, gap }); return; }
      const pattern = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
      const runs = v.split(pattern).filter((r) => r !== '');
      doc.x = L;
      runs.forEach((run, i) => {
        doc.font(parts.includes(run) ? 'B' : 'R').fontSize(size).fillColor(C.ink)
          .text(run, { width: W, continued: i < runs.length - 1 });
      });
      doc.y += gap;
    }

    function numbered(n, t, { indent = 0, size = 10.5, gap = 3 } = {}) {
      const v = str(t).trim();
      if (!v) return;
      const numW = 22;
      const h = doc.font('R').fontSize(size).heightOfString(v, { width: W - indent - numW });
      ensure(h + gap);
      const y = doc.y;
      doc.font('B').fontSize(size).fillColor(C.ink).text(`${n})`, L + indent, y, { width: numW });
      doc.font('R').fontSize(size).fillColor(C.ink).text(v, L + indent + numW, y, { width: W - indent - numW });
      doc.y = Math.max(doc.y, y + h) + gap;
    }

    function subNumbered(n, t) {
      const v = str(t).trim();
      if (!v) return;
      const indent = 44;
      const h = doc.font('R').fontSize(10.5).heightOfString(v, { width: W - indent - 18 });
      ensure(h + 2);
      const y = doc.y;
      doc.font('R').fontSize(10.5).fillColor(C.ink).text(`${n}.`, L + indent - 2, y, { width: 18 });
      doc.font('R').fontSize(10.5).fillColor(C.ink).text(v, L + indent + 16, y, { width: W - indent - 16 });
      doc.y = Math.max(doc.y, y + h) + 2;
    }

    /* ---------- Heading ---------- */
    const heading = text('heading') || 'AMC LETTER';
    doc.font('B').fontSize(13).fillColor(C.ink).text(heading, L, doc.y + 6, { width: W, align: 'center', underline: true });
    doc.y += 14;

    para(text('salutation') || 'Dear Sir/ Madam,', { gap: 8 });

    /* ---------- Client ---------- */
    if (ct.customer) para(`${str(ct.customer).replace(/,\s*$/, '')},`, { font: 'B', size: 11.5, gap: 1 });
    if (ct.site) para(str(ct.site), { font: 'B', size: 11.5, gap: 10 });
    else doc.y += 9;

    para(text('acknowledgement'), { gap: 8 });

    /* ---------- Proposal, amount and period in bold ---------- */
    const proposal = text('proposal');
    const amountMatch = proposal.match(/₹\s?[\d,]+(?:\.\d+)?/);
    const periodMatch = proposal.match(/\(Date\s*[–-][^)]*\)\.?/);
    const yearsMatch = proposal.match(/\bfor\s+(\d+\s+(?:Year|Years|Month|Months))\b/);
    richPara(proposal, [amountMatch && amountMatch[0], periodMatch && periodMatch[0], yearsMatch && yearsMatch[1]], { gap: 8 });

    para(text('terms_intro'), { gap: 8 });

    /* ---------- Numbered terms; the routine-servicing item carries sub-points ---------- */
    let n = 0;
    list.forEach((s) => {
      if (FIXED.has(s.key) || SUB_POINTS.includes(s.key)) return;
      n += 1;
      numbered(n, s.content);
      if (s.key === 'routine_servicing_intro') {
        let m = 0;
        SUB_POINTS.forEach((k) => {
          const sec = byKey.get(k);
          if (!sec) return;
          str(sec.content).split('\n').map((x) => x.trim()).filter(Boolean).forEach((line) => {
            m += 1;
            subNumbered(m, line);
          });
        });
        doc.y += 2;
      }
    });
    doc.y += 8;

    /* ---------- Payment terms / Please note ---------- */
    if (text('payment_terms')) {
      para('Payment Terms –', { font: 'B', gap: 3 });
      para(text('payment_terms'), { gap: 10 });
    }
    if (text('please_note')) {
      para('Please Note –', { font: 'B', gap: 3 });
      para(text('please_note'), { gap: 14 });
    }

    /* ---------- Contact details ---------- */
    const office = str(co.whatsappNumber || co.phone);
    const leftLines = [
      str(person.name),
      person.designation ? `(${person.designation})` : '',
      [str(person.contactPhone), str(person.contactEmail || co.email)].filter(Boolean).join(' / '),
    ].filter(Boolean);
    const rightLines = [
      str(co.name),
      office ? '(Complaint Registration at)' : '',
      office ? `Office - ${office}` : '',
    ].filter(Boolean);
    if (leftLines.length || rightLines.length) {
      ensure(80);
      para('Our contact details for your reference –', { font: 'B', color: C.red, gap: 6 });
      const y0 = doc.y;
      const half = W / 2;
      doc.font('B').fontSize(10.5).fillColor(C.red);
      leftLines.forEach((l, i) => doc.text(l, L, y0 + i * 15, { width: half - 10 }));
      rightLines.forEach((l, i) => doc.text(l, L + half, y0 + i * 15, { width: half, align: 'center' }));
      doc.y = y0 + Math.max(leftLines.length, rightLines.length) * 15 + 18;
    }

    /* ---------- Sign & stamp ---------- */
    const sig = imageBuffer(person.signatureBase64);
    const stamp = imageBuffer(person.stampBase64);
    ensure(sig || stamp ? 110 : 40);
    doc.font('B').fontSize(10.5).fillColor(C.ink).text('Sign & Stamp –', L, doc.y, { underline: true });
    doc.y += 8;
    if (stamp) {
      try { doc.image(stamp, L, doc.y, { fit: [110, 80] }); } catch { /* skip */ }
    }
    if (sig) {
      try { doc.image(sig, L + (stamp ? 70 : 0), doc.y + 10, { fit: [130, 60] }); } catch { /* skip */ }
    }
    if (sig || stamp) doc.y += 86;

    /* ---------- Footer on every page ---------- */
    const addr = [co.address, co.city].filter(Boolean).join(', ');
    const line1 = `Head Office – ${str(co.name).toUpperCase()}${addr ? `,  ${addr}` : ''}`;
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
      const fy = doc.page.height - saved + 22;
      doc.font('S').fontSize(9).fillColor(C.ink).text(line1, L, fy, { width: W, align: 'center', lineBreak: false });
      doc.moveTo(L - 16, fy + 14).lineTo(L + W + 16, fy + 14).lineWidth(0.6).strokeColor('#8eaadb').stroke();
      doc.font('S').fontSize(8.5).fillColor(C.footer).text(line2, L - 16, fy + 19, { width: W + 32, align: 'center', lineBreak: false });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

module.exports = { buildAmcLetterPdf };
