# Vendor libraries

Pinned copies of third-party libraries, loaded by `index.html` and by the Node
tests. They are committed so the site does not depend on a CDN.

| File | Package | Version | License |
|---|---|---|---|
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT ([licenses/LICENSE-pdf-lib.md](licenses/LICENSE-pdf-lib.md)) |
| `fontkit.umd.min.js` | [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT |
| `xlsx.full.min.js` | [SheetJS Community Edition (xlsx)](https://sheetjs.com) | 0.18.5 | Apache-2.0 ([licenses/LICENSE-xlsx](licenses/LICENSE-xlsx)) |
| `jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT or GPLv3, used under MIT ([licenses/LICENSE-jszip.md](licenses/LICENSE-jszip.md)) |
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | [Tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache-2.0 ([licenses/LICENSE-tesseract.js.md](licenses/LICENSE-tesseract.js.md)) |
| `tesseract/tesseract-core-simd-lstm.wasm.js`, `tesseract/tesseract-core-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Apache-2.0 ([licenses/LICENSE-tesseract.js-core](licenses/LICENSE-tesseract.js-core)) |
| `tesseract/lang/eng.traineddata.gz` | [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) (`4.0.0_best_int`) | 1.0.0 | MIT (model from tesseract-ocr/tessdata, Apache-2.0) |
| `katex/katex.min.js`, `katex/katex.min.css`, `katex/fonts/*.woff2` | [KaTeX](https://katex.org) | 0.19.1 | MIT ([licenses/LICENSE-katex](licenses/LICENSE-katex)) |
| `pdfjs/pdf.min.js`, `pdfjs/pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | 3.11.174 | Apache-2.0 ([licenses/LICENSE-pdfjs](licenses/LICENSE-pdfjs)) |

pdf.js, JSZip and Tesseract are loaded lazily: pdf.js for the PDF preview and
for reading uploaded PDFs, JSZip for the accountant package, and Tesseract
(about 7 MB with the English model) only when a screenshot or a scanned PDF is
uploaded. The browser picks the SIMD build of the Tesseract core when it can. pdf.js It runs with
`disableFontFace: true`, because the form's embedded Hebrew CID fonts render
garbled through the browser's FontFace path.

To upgrade, download the package with `npm pack <name>@<version>` and copy the
file from its `dist/` folder. Then run `npm test` and `npm run sample`.

The Hebrew font (Noto Sans Hebrew, SIL Open Font License) lives in
`assets/fonts/` together with its license.
