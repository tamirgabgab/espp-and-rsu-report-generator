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
| `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs` | [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist, `legacy/build`) | 4.10.38 | Apache-2.0 ([licenses/LICENSE-pdfjs](licenses/LICENSE-pdfjs)) |

No library loads with the page. Every library is loaded on first
use through `window.Lib` (`src/js/loader.js`): SheetJS when an Excel file is
imported or exported, pdf-lib and fontkit when the PDF is built, pdf.js for the
PDF preview and for reading uploaded PDFs, JSZip for the accountant package,
KaTeX for the explanation view, and Tesseract (about 7 MB with the English
model) only when a screenshot or a scanned PDF is uploaded. The browser picks
the SIMD build of the Tesseract core when it can.

pdf.js 4.x ships only as ES modules, so `Lib.pdfjs()` loads it with a dynamic
`import()` of an absolute URL. The `legacy` build is used for older Safari and
Chrome versions. pdf.js runs with `disableFontFace: true`, because the form's
embedded Hebrew CID fonts render garbled through the browser's FontFace path,
and with `isEvalSupported: false` as defence in depth (CVE-2024-4367 is fixed
from 4.2.67; uploaded PDFs are untrusted input). The server must serve `.mjs`
as JavaScript (GitHub Pages and `python3 -m http.server` do).

SheetJS 0.18.5 has two published advisories for reading crafted files
(CVE-2023-30533, CVE-2024-22363). The fixed release, 0.20.3, is published only
on `cdn.sheetjs.com`, not on npm: download
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` and replace
`xlsx.full.min.js` (plan.md, S3).

## Security advisories: check every quarter

Dependabot does not see files copied into `vendor/`, so check these pages
every three months (and before a release). If a version above is affected,
upgrade it as described below.

| Library | Advisories |
|---|---|
| pdf.js | https://github.com/mozilla/pdf.js/security/advisories |
| SheetJS | https://git.sheetjs.com/sheetjs/sheetjs/issues?labels=security and https://cdn.sheetjs.com/advisories/ |
| Tesseract.js | https://github.com/naptha/tesseract.js/security/advisories |
| KaTeX | https://github.com/KaTeX/KaTeX/security/advisories |
| JSZip | https://github.com/Stuk/jszip/security/advisories |
| pdf-lib / fontkit | https://github.com/Hopding/pdf-lib/security/advisories |

The GitHub advisory database also lists them by package name:
https://github.com/advisories?query=ecosystem%3Anpm+pdfjs-dist (replace the
package name: `xlsx`, `tesseract.js`, `katex`, `jszip`, `pdf-lib`).

## Upgrading

To upgrade, download the package with `npm pack <name>@<version>` and copy the
file from its `dist/` folder. Then run `npm test` and `npm run sample`.

The Hebrew font (Noto Sans Hebrew, SIL Open Font License) lives in
`assets/fonts/` together with its license.
