/*
 * Read text from a PDF or an image, entirely in the browser.
 *
 * - A PDF with a text layer: pdf.js extracts the text, rebuilt into lines.
 * - A scanned PDF or an image (a screenshot): the page is upscaled, turned to
 *   grey with stretched contrast, and read with Tesseract.js (OCR, English).
 *
 * Nothing is uploaded. pdf.js and Tesseract (about 7 MB with the English model)
 * are loaded only the first time a document is read.
 */
(function () {
  'use strict';
  const TESS = 'vendor/tesseract/';
  const MAX_PAGES = 5;
  const TARGET_WIDTH = 3000; // pixels: small screenshots read far better when upscaled

  const abs = p => new URL(p, location.href).href;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function pdfjs() {
    if (!window.pdfjsLib) {
      await loadScript('vendor/pdfjs/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    }
    return window.pdfjsLib;
  }

  let workerPromise = null;
  let onProgress = null;
  async function tesseract() {
    if (!window.Tesseract) await loadScript(TESS + 'tesseract.min.js');
    if (!workerPromise) {
      // Paths must be absolute: the worker resolves them relative to its own URL.
      workerPromise = window.Tesseract.createWorker('eng', 1, {
        workerPath: abs(TESS + 'worker.min.js'), corePath: abs(TESS), langPath: abs(TESS + 'lang'), gzip: true,
        logger: m => { if (onProgress) onProgress(m); },
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /**
   * Upscale, convert to grey, stretch the contrast (1st..99th percentile) and
   * optionally sharpen. Small screenshots read far better this way.
   */
  function prepare(source, w, h, scale, sharpen) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = g; hist[g]++;
    }
    const total = d.length / 4;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    if (sharpen) {
      // Unsharp mask with a 3x3 box blur: v + 0.8 * (v - blur).
      const W = c.width, H = c.height, src = new Uint8ClampedArray(d);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = (y * W + x) * 4;
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[i + (dy * W + dx) * 4];
          const v = src[i] + 0.8 * (src[i] - sum / 9);
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /**
   * OCR a picture several times with different scaling and return all the
   * texts; the caller keeps the best reading (Core.bestGainsParse).
   */
  async function ocrPasses(source, w, h, page, pages, progress) {
    // Three readings at different sizes: OCR errors on small text differ between them,
    // and Core.bestGainsParse keeps, field by field, the values that pass the cross-checks.
    const sc = target => Math.max(1, Math.min(4, target / w));
    const passes = [[sc(2600), true], [sc(3100), true], [sc(4200), false]];
    const texts = [];
    for (let k = 0; k < passes.length; k++) {
      const [scale, sharpen] = passes[k];
      texts.push(await ocr(prepare(source, w, h, scale, sharpen), page, pages, progress && (p => progress({ ...p, pass: k + 1, passes: passes.length }))));
    }
    return texts;
  }

  /** The single image a scanned PDF page is made of, at its own resolution (or null). */
  async function pageImage(lib, page) {
    try {
      const ops = await page.getOperatorList();
      const names = [];
      ops.fnArray.forEach((fn, i) => { if (fn === lib.OPS.paintImageXObject) names.push(ops.argsArray[i][0]); });
      if (names.length !== 1) return null;
      const img = await new Promise(resolve => page.objs.get(names[0], resolve));
      if (!img || !img.width) return null;
      if (img.bitmap) return { source: img.bitmap, w: img.width, h: img.height };
      if (!img.data) return null;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      const out = ctx.createImageData(img.width, img.height);
      const px = img.width * img.height;
      const ch = img.data.length / px; // 1 = grey, 3 = RGB, 4 = RGBA
      if (![1, 3, 4].includes(ch)) return null;
      for (let i = 0; i < px; i++) {
        const r = img.data[i * ch], g = ch === 1 ? r : img.data[i * ch + 1], b = ch === 1 ? r : img.data[i * ch + 2];
        out.data[i * 4] = r; out.data[i * 4 + 1] = g; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return { source: c, w: c.width, h: c.height };
    } catch { return null; }
  }

  async function ocr(canvas, page, pages, progress) {
    onProgress = m => {
      if (!progress) return;
      if (m.status === 'recognizing text') progress({ step: 'ocr', page, pages, pct: Math.round(m.progress * 100) });
      else progress({ step: 'load' });
    };
    progress && progress({ step: 'load' });
    const worker = await tesseract();
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  }

  /** Rebuild lines from pdf.js text items (same baseline = same line, sorted left to right). */
  function linesFromItems(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
  }

  async function readPdf(buf, progress) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), disableFontFace: true }).promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const texts = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      texts.push(linesFromItems((await page.getTextContent()).items));
    }
    const text = texts.join('\n');
    if (text.replace(/\s/g, '').length > 40) return { texts: [text], method: 'pdf-text', pages };
    // No text layer (a scan or a saved screenshot): OCR the page image.
    const perPage = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      let img = await pageImage(lib, page);
      if (!img) {
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.max(1, Math.min(4, 1000 / base.width)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        img = { source: c, w: c.width, h: c.height };
      }
      perPage.push(await ocrPasses(img.source, img.w, img.h, n, pages, progress));
    }
    // Pass k of every page, joined: one candidate text per pass.
    return { texts: perPage[0].map((_, k) => perPage.map(t => t[k]).join('\n')), method: 'ocr', pages };
  }

  async function readImage(file, progress) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch {
      throw Object.assign(new Error('unsupported image'), { userMessage: 'הדפדפן לא מצליח לפתוח את התמונה הזו. אפשר לשמור אותה כ‑PNG או JPEG ולנסות שוב.' });
    }
    return { texts: await ocrPasses(bmp, bmp.width, bmp.height, 1, 1, progress), method: 'ocr', pages: 1 };
  }

  const isDocument = file => /\.(pdf|png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name) || /^(image\/|application\/pdf)/.test(file.type);

  /**
   * @param {File} file
   * @param {(p:{step:'load'|'ocr', page?, pages?, pct?}) => void} progress
   * @returns {Promise<{texts:string[], method:'pdf-text'|'ocr', pages:number}>} one or more candidate readings
   */
  async function read(file, progress) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (isPdf) return readPdf(await file.arrayBuffer(), progress);
    return readImage(file, progress);
  }

  window.DocImport = { read, isDocument };
})();
