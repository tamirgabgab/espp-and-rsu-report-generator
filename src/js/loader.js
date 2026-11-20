/*
 * Loads the vendored libraries when they are first needed, so the page does
 * not wait for about 2 MB of code it may never use:
 *   Lib.xlsx()   SheetJS, for Excel import and export
 *   Lib.pdfLib() pdf-lib and fontkit, to build the form
 *   Lib.pdfjs()  pdf.js (an ES module), to read and preview PDFs
 *   Lib.script() / Lib.css() for anything else (JSZip, Tesseract, KaTeX)
 * Each file is requested once; a failed load can be retried.
 */
(function (root) {
  'use strict';
  const cache = new Map();
  const abs = p => new URL(p, document.baseURI).href;

  function load(key, make) {
    if (!cache.has(key)) cache.set(key, make().catch(e => { cache.delete(key); throw e; }));
    return cache.get(key);
  }

  const script = src => load(src, () => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => { s.remove(); reject(new Error(`load ${src}`)); };
    document.head.appendChild(s);
  }));

  const css = href => load(href, () => new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.onload = resolve; l.onerror = () => { l.remove(); reject(new Error(`load ${href}`)); };
    document.head.appendChild(l);
  }));

  const xlsx = () => (root.XLSX ? Promise.resolve(root.XLSX) : script('vendor/xlsx.full.min.js').then(() => root.XLSX));

  const pdfLib = () => Promise.all([
    root.PDFLib || script('vendor/pdf-lib.min.js'),
    root.fontkit || script('vendor/fontkit.umd.min.js'),
  ]).then(() => ({ PDFLib: root.PDFLib, fontkit: root.fontkit }));

  // pdf.js 4 ships as an ES module. A classic script can still import() it;
  // the path is made absolute because import() resolves against this file.
  const pdfjs = () => load('pdfjs', () => import(abs('vendor/pdfjs/pdf.min.mjs')).then(m => {
    m.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.mjs');
    root.pdfjsLib = m;
    return m;
  }));

  root.Lib = { script, css, xlsx, pdfLib, pdfjs, abs };
})(window);
