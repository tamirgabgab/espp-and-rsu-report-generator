/*
 * Fills the official form 1399 (י) PDF and appends a summary page.
 *
 * pdf-lib draws glyphs left-to-right with no bidi support, so Hebrew strings
 * are converted to visual order by toVisual() before drawing.
 *
 * All coordinates in FIELD_MAP are PDF points measured from the TOP-LEFT of
 * the A4 page (595.28 x 841.89) - converted to pdf-lib's bottom-left origin in
 * draw helpers. They were calibrated against the 2025 edition of the form
 * (assets/form-1399y-2025-blank.pdf). A new yearly edition may need re-calibration:
 * run `node tests/render_sample.js` and compare the PNG output.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pdf1399 = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const getLibs = () => {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return { PDFLib: require('../vendor/pdf-lib.min.js'), fontkit: require('../vendor/fontkit.umd.min.js'), Core: require('./core.js') };
    }
    return { PDFLib: root.PDFLib, fontkit: root.fontkit, Core: root.Core };
  };

  const PAGE_H = 841.89;

  // ------------------------------------------------------------- field map

  const FIELD_MAP = {
    // Header grey box: single digit written inside each box.
    belonging: { x: 531.4, y: 88 },        // שייכות (0 / 2 / 3)
    substantialHdr: { x: 464.0, y: 88 },   // בעל מניות מהותי
    expropriationHdr: { x: 406.0, y: 88 }, // הפקעה
    abroadHdr: { x: 367.5, y: 88 },        // הנכס בחו"ל
    spreadHdr: { x: 311.0, y: 89.5 },      // פריסה

    sellerName: { xRight: 536, y: 164 },
    fileNumber: { xLeft: 340, y: 164, pitch: 10.4 },

    // Check boxes: centre of the printed box.
    cb: {
      sellerSubstantialYes: [324.2, 151], sellerSubstantialNo: [301.25, 151],
      sec102Yes: [185.55, 151], sec102No: [162.65, 151],
      spreadYes: [131.35, 151], spreadNo: [101.75, 151],
      exproYes: [69.95, 151], exproNo: [50.35, 151],
      ownerMine: [286.95, 173.7], ownerSpouse: [251.2, 173.7],
      premaritalYes: [232.7, 185.7], premaritalNo: [213.1, 185.7],
      placeIsrael: [365.6, 186.2], placeAbroad: [332.7, 186.2],
      ceasedYes: [411.25, 188.7], ceasedNo: [388.7, 188.7],
      relatedYes: [83.05, 188.6], relatedNo: [60.15, 188.6],
    },
    buyerName: { xCenter: 152, y: 192 },
    assetDetails: { xRight: 536, y: 193 },

    amountRight: 399, // right edge of the ש"ח column
    dateCenter: 259,
    line1: { y: 233, dateY: 237 },   // code 15 - proceeds
    line2: { y: 263, dateY: 267 },   // code 20 - cost
    line9: { y: 421 },               // original cost balance (sum of lines 2-8)
    line10: { y: 444 },              // code 55 - sale expenses
    line17: { xRight: 212, y: 469 }, // inflationary amount
    line18: { xCenter: 62, y: 469 }, // capital gain / loss
    line24: { xCenter: 246, y: 591 }, // total real capital gain
    line27: { xCenter: 179, y: 651 }, // real gain after the 2012 "change date"
    line33: { xCenter: 187, y: 742 }, // tax at 25% (30%/25% column)
    signDate: { xRight: 545, y: 810 },
  };

  // ------------------------------------------------------------- bidi

  const isHeb = ch => /[֐-׿יִ-ﭏ]/.test(ch);
  const isLtr = ch => /[A-Za-z0-9À-ɏ]/.test(ch);
  const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '{': '}', '}': '{' };

  /** Convert a logical-order string with Hebrew to visual (left-to-right) order. */
  function toVisual(str) {
    const s = String(str).replace(/[\u200E\u200F]/g, '');
    if (![...s].some(isHeb)) return s;
    const chars = [...s];
    const types = chars.map(c => (isHeb(c) ? 'R' : isLtr(c) ? 'L' : 'N'));
    // Resolve neutrals: between two runs of the same type -> that type, otherwise RTL base.
    for (let i = 0; i < types.length; i++) {
      if (types[i] !== 'N') continue;
      let j = i;
      while (j < types.length && types[j] === 'N') j++;
      const before = i > 0 ? types[i - 1] : 'R';
      const after = j < types.length ? types[j] : 'R';
      const t = before === after ? before : 'R';
      for (let k = i; k < j; k++) types[k] = t;
      i = j - 1;
    }
    const runs = [];
    for (let i = 0; i < chars.length; i++) {
      if (runs.length && runs[runs.length - 1].t === types[i]) runs[runs.length - 1].s.push(chars[i]);
      else runs.push({ t: types[i], s: [chars[i]] });
    }
    return runs.reverse().map(r => (r.t === 'R' ? r.s.reverse().map(c => MIRROR[c] || c).join('') : r.s.join(''))).join('');
  }

  // ------------------------------------------------------------- helpers

  const fmt = n => (n < 0 ? `(${Math.abs(n).toLocaleString('en-US')})` : n.toLocaleString('en-US'));
  const fmtUsd = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function makeDrawer(page, font, rgb) {
    const color = rgb(0.05, 0.15, 0.55);
    const text = (t, x, y, size) => page.drawText(t, { x, y: PAGE_H - y, size, font, color });
    return {
      right(t, xRight, y, size = 10) { const v = toVisual(t); text(v, xRight - font.widthOfTextAtSize(v, size), y, size); },
      left(t, x, y, size = 10) { text(toVisual(t), x, y, size); },
      center(t, xc, y, size = 10) { const v = toVisual(t); text(v, xc - font.widthOfTextAtSize(v, size) / 2, y, size); },
      /** Text that must fit between xLeft and xRight: shrink the font if needed. */
      fit(t, xLeft, xRight, y, size = 10, align = 'right') {
        const v = toVisual(t);
        let s = size;
        while (s > 5 && font.widthOfTextAtSize(v, s) > xRight - xLeft) s -= 0.25;
        const w = font.widthOfTextAtSize(v, s);
        const x = align === 'center' ? (xLeft + xRight - w) / 2 : align === 'left' ? xLeft : xRight - w;
        text(v, x, y, s);
      },
      cross([xc, yc], size = 6.5) {
        const h = size / 2;
        page.drawLine({ start: { x: xc - h, y: PAGE_H - yc - h }, end: { x: xc + h, y: PAGE_H - yc + h }, thickness: 1.2, color });
        page.drawLine({ start: { x: xc - h, y: PAGE_H - yc + h }, end: { x: xc + h, y: PAGE_H - yc - h }, thickness: 1.2, color });
      },
      spaced(t, xLeft, y, pitch, size = 11) {
        [...String(t)].forEach((ch, i) => {
          const w = font.widthOfTextAtSize(ch, size);
          text(ch, xLeft + i * pitch + (pitch - w) / 2, y, size);
        });
      },
    };
  }

  // ------------------------------------------------------------- form page

  function fillFormPage(page, font, rgb, Core, profile, item) {
    const F = FIELD_MAP;
    const d = makeDrawer(page, font, rgb);
    const { lot, calc } = item;
    const yes = v => v === true || v === 'yes';

    // Header digits.
    d.center(String(profile.belonging ?? '0'), F.belonging.x, F.belonging.y, 10);
    d.center('0', F.substantialHdr.x, F.substantialHdr.y, 10);
    d.center('0', F.expropriationHdr.x, F.expropriationHdr.y, 10);
    d.center(profile.place === 'abroad' ? '1' : '0', F.abroadHdr.x, F.abroadHdr.y, 10);
    d.center('0', F.spreadHdr.x, F.spreadHdr.y, 10);

    // Seller.
    if (profile.name) d.fit(profile.name, 440, F.sellerName.xRight, F.sellerName.y, 12);
    const fileNo = String(profile.idNumber || '').replace(/\D/g, '');
    if (fileNo) d.spaced(fileNo, F.fileNumber.xLeft, F.fileNumber.y, F.fileNumber.pitch, 11);

    d.cross(F.cb.sellerSubstantialNo);
    d.cross(yes(lot.sec102 ?? profile.sec102) ? F.cb.sec102Yes : F.cb.sec102No);
    d.cross(F.cb.spreadNo);
    d.cross(F.cb.exproNo);
    d.cross(F.cb.ownerMine);
    d.cross(profile.place === 'abroad' ? F.cb.placeAbroad : F.cb.placeIsrael);
    d.cross(F.cb.ceasedNo);
    d.cross(F.cb.relatedNo);

    const plan = lot.planType || 'מניות';
    d.fit(`מימוש ${plan} מניות`, 96, 208, F.buyerName.y, 11, 'center');
    const qty = isFinite(lot.qty) ? `${lot.qty} ` : '';
    d.fit(`${qty}מניות ${lot.symbol || ''} ${lot.planType || ''}`.replace(/\s+/g, ' ').trim(), 446, F.assetDetails.xRight, F.assetDetails.y, 8.5);

    // Calculation.
    const ar = F.amountRight;
    d.fit(`${fmtUsd(lot.proceedsUsd)}*${calc.sell.rate}=${fmt(calc.proceedsIls)}`, 300, ar, F.line1.y, 10.5);
    d.center(Core.formatDateIL(lot.dateSold), F.dateCenter, F.line1.dateY, 11);
    d.fit(`${fmtUsd(lot.costUsd)}*${calc.buy.rate}=${fmt(calc.costIls)}`, 300, ar, F.line2.y, 10.5);
    d.center(Core.formatDateIL(lot.dateAcquired), F.dateCenter, F.line2.dateY, 11);
    d.fit(fmt(calc.costIls), 300, ar, F.line9.y, 10.5);
    if (calc.feesIls) d.fit(fmt(calc.feesIls), 300, ar, F.line10.y, 10.5);
    if (calc.inflationary) d.fit(fmt(calc.inflationary), 167, F.line17.xRight, F.line17.y, 10);
    d.fit(fmt(calc.nominal), 32, 92, F.line18.y, 12, 'center');
    d.fit(fmt(calc.real), 208, 284, F.line24.y, 12, 'center');
    if (calc.real > 0) {
      d.fit(fmt(calc.real), 142, 216, F.line27.y, 11, 'center');
      d.fit(`${fmt(calc.real)}*25%=${fmt(calc.tax)}`, 141, 233, F.line33.y, 11, 'center');
    }
    d.right(Core.formatDateIL(profile.signDate || new Date().toISOString().slice(0, 10)), F.signDate.xRight, F.signDate.y, 12);
  }

  // ------------------------------------------------------------- summary pages

  function drawSummary(pdfDoc, font, rgb, Core, profile, items, summary) {
    const W = 841.89, H = 595.28, M = 28;
    const ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.4, 0.4, 0.4), line = rgb(0.75, 0.75, 0.75), band = rgb(0.94, 0.95, 0.97);
    const cols = [
      { h: '#', w: 18, v: (it, i) => String(i + 1) },
      { h: 'נייר', w: 38, v: it => it.lot.symbol || '' },
      { h: 'תוכנית', w: 36, v: it => it.lot.planType || '' },
      { h: 'כמות', w: 34, v: it => (isFinite(it.lot.qty) ? String(it.lot.qty) : '') },
      { h: 'ת. רכישה', w: 52, v: it => Core.formatDateIL(it.lot.dateAcquired) },
      { h: 'ת. מכירה', w: 52, v: it => Core.formatDateIL(it.lot.dateSold) },
      { h: 'שער רכישה', w: 46, v: it => String(it.calc.buy.rate) },
      { h: 'שער מכירה', w: 46, v: it => String(it.calc.sell.rate) },
      { h: 'תמורה $', w: 58, v: it => fmtUsd(it.lot.proceedsUsd) },
      { h: 'עלות $', w: 58, v: it => fmtUsd(it.lot.costUsd) },
      { h: 'תמורה ₪', w: 56, v: it => fmt(it.calc.proceedsIls) },
      { h: 'עלות+הוצאות ₪', w: 62, v: it => fmt(it.calc.costIls + it.calc.feesIls) },
      { h: 'רווח נומינלי ₪', w: 62, v: it => fmt(it.calc.nominal) },
      { h: 'סכום אינפלציוני ₪', w: 70, v: it => fmt(it.calc.inflationary) },
      { h: 'רווח/הפסד ריאלי ₪', w: 70, v: it => fmt(it.calc.real) },
    ];
    const tableW = cols.reduce((a, c) => a + c.w, 0);
    const xRight0 = W - M - (W - 2 * M - tableW) / 2;
    const rowH = 15, size = 7.6;

    let page, y;
    const newPage = (title) => {
      page = pdfDoc.addPage([W, H]);
      const T = (t, x, yy, s, c = ink, al = 'right') => {
        const v = toVisual(t); const w = font.widthOfTextAtSize(v, s);
        page.drawText(v, { x: al === 'right' ? x - w : al === 'center' ? x - w / 2 : x, y: H - yy, size: s, font, color: c });
      };
      T(title, W - M, M + 10, 14);
      const who = [profile.name, profile.idNumber ? `ת.ז. ${profile.idNumber}` : ''].filter(Boolean).join(' · ');
      if (who) T(who, W - M, M + 26, 9, muted);
      T('שערים: שער יציג של בנק ישראל (USD/ILS). חישוב לפי חוזר מס הכנסה 10/2025.', M, M + 10, 7.5, muted, 'left');
      y = M + 44;
      return { T };
    };

    const drawHeader = (T) => {
      let x = xRight0;
      page.drawRectangle({ x: x - tableW, y: H - y - 10, width: tableW, height: rowH, color: band });
      for (const c of cols) { T(c.h, x - c.w / 2, y + 6, size, ink, 'center'); x -= c.w; }
      y += rowH;
    };

    let ctx = newPage('נספח לטופס 1399 - פירוט מכירות ניירות ערך (מבנה טופס 1325)');
    drawHeader(ctx.T);
    items.forEach((it, i) => {
      if (y > H - M - 30) { ctx = newPage('נספח לטופס 1399 - המשך'); drawHeader(ctx.T); }
      let x = xRight0;
      for (const c of cols) { ctx.T(c.v(it, i), x - c.w / 2, y + 6, size, ink, 'center'); x -= c.w; }
      page.drawLine({ start: { x: xRight0 - tableW, y: H - y - 10 }, end: { x: xRight0, y: H - y - 10 }, thickness: 0.4, color: line });
      y += rowH;
    });

    // Totals by half-year and year.
    y += 14;
    if (y > H - M - 120) ctx = newPage('נספח לטופס 1399 - סיכום');
    ctx.T('סיכום לפי תקופה (קיזוז הפסדים מול רווחים באותה תקופה)', xRight0, y, 11);
    y += 12;
    const sCols = [
      { h: 'תקופה', w: 110, v: g => g.label },
      { h: 'מכירות', w: 50, v: g => String(g.count) },
      { h: 'תמורה ₪', w: 80, v: g => fmt(g.proceedsIls) },
      { h: 'סכום אינפלציוני ₪', w: 90, v: g => fmt(g.inflationary) },
      { h: 'רווחים ריאליים ₪', w: 90, v: g => fmt(g.gains) },
      { h: 'הפסדים לקיזוז ₪', w: 90, v: g => fmt(g.losses) },
      { h: 'רווח ריאלי נטו ₪', w: 90, v: g => fmt(g.net) },
      { h: 'מס 25% ₪', w: 80, v: g => fmt(g.tax) },
    ];
    const sW = sCols.reduce((a, c) => a + c.w, 0);
    let x = xRight0;
    page.drawRectangle({ x: x - sW, y: H - y - 10, width: sW, height: rowH, color: band });
    for (const c of sCols) { ctx.T(c.h, x - c.w / 2, y + 6, size + 0.4, ink, 'center'); x -= c.w; }
    y += rowH;
    for (const g of summary) {
      x = xRight0;
      if (g.isYear) page.drawRectangle({ x: x - sW, y: H - y - 10, width: sW, height: rowH, color: rgb(0.97, 0.97, 0.94) });
      for (const c of sCols) { ctx.T(c.v(g), x - c.w / 2, y + 6, size + 0.4, ink, 'center'); x -= c.w; }
      y += rowH;
    }
    y += 10;
    const notes = [
      'הערות:',
      '‏1. תמורה ועלות הומרו לשקלים לפי השער היציג ביום המכירה וביום הרכישה; ביום ללא פרסום נלקח השער האחרון שפורסם לפניו.',
      '‏2. סכום אינפלציוני = עלות בשקלים × (שער מכירה / שער רכישה − 1). כשהשקל התחזק - אין סכום אינפלציוני, וכל הרווח הנומינלי ריאלי.',
      '‏3. הפסד שנובע מהתחזקות השקל אינו בר קיזוז (הלכת מוזס); מוצג רק החלק המותר בקיזוז.',
      '‏4. עלות = Adjusted Cost Basis לפי E*Trade (שווי ביום הרכישה/ההבשלה). המס הוא הערכה בלבד - יש לאמת מול רואה החשבון.',
    ];
    for (const n of notes) { ctx.T(n, xRight0, y, 7.8, muted); y += 11; }
  }

  /**
   * fontkit auto-detects the script of a string and reverses Hebrew runs on its own,
   * which would undo toVisual(). Force a plain left-to-right layout instead so that
   * the visual order we compute is exactly what gets drawn.
   */
  function ltrFontkit(fontkit) {
    return {
      create(...args) {
        const f = fontkit.create(...args);
        const layout = f.layout.bind(f);
        f.layout = (str, features) => layout(str, features, 'latn', undefined, 'ltr');
        return f;
      },
    };
  }

  // ------------------------------------------------------------- main

  /**
   * @param {object} opts
   *  formBytes: ArrayBuffer|Uint8Array of the blank form
   *  fontBytes: ArrayBuffer|Uint8Array of a TTF with Hebrew glyphs
   *  profile:   {name, idNumber, belonging, sec102, place, signDate}
   *  items:     [{lot, calc}] - only items with calc.ok are rendered
   *  includeSummary: boolean
   * @returns {Promise<Uint8Array>}
   */
  async function buildPdf({ formBytes, fontBytes, profile, items, includeSummary = true }) {
    const { PDFLib, fontkit, Core } = getLibs();
    const { PDFDocument, rgb } = PDFLib;
    const out = await PDFDocument.create();
    out.registerFontkit(ltrFontkit(fontkit));
    const font = await out.embedFont(fontBytes, { subset: true });
    const form = await PDFDocument.load(formBytes);
    const ready = items.filter(it => it.calc && it.calc.ok);
    for (const item of ready) {
      const [page] = await out.copyPages(form, [0]);
      out.addPage(page);
      fillFormPage(page, font, rgb, Core, profile, item);
    }
    if (includeSummary && ready.length) {
      drawSummary(out, font, rgb, Core, profile, ready, Core.summarize(ready));
    }
    out.setTitle('Form 1399 - capital gains report');
    out.setCreator('espp-and-rsu-report-generator');
    return out.save();
  }

  return { buildPdf, toVisual, FIELD_MAP };
});
