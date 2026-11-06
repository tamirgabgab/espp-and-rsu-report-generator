# Vendor libraries

Pinned copies of third-party libraries, loaded by `index.html` and by the Node
tests. They are committed so the site does not depend on a CDN.

| File | Package | Version | License |
|---|---|---|---|
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT ([licenses/LICENSE-pdf-lib.md](licenses/LICENSE-pdf-lib.md)) |
| `fontkit.umd.min.js` | [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT |
| `xlsx.full.min.js` | [SheetJS Community Edition (xlsx)](https://sheetjs.com) | 0.18.5 | Apache-2.0 ([licenses/LICENSE-xlsx](licenses/LICENSE-xlsx)) |
| `pdfjs/pdf.min.js`, `pdfjs/pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | 3.11.174 | Apache-2.0 ([licenses/LICENSE-pdfjs](licenses/LICENSE-pdfjs)) |

pdf.js is loaded lazily, only when the user opens the PDF preview. It runs with
`disableFontFace: true`, because the form's embedded Hebrew CID fonts render
garbled through the browser's FontFace path.

To upgrade, download the package with `npm pack <name>@<version>` and copy the
file from its `dist/` folder. Then run `npm test` and `npm run sample`.

The Hebrew font (Noto Sans Hebrew, SIL Open Font License) lives in
`assets/fonts/` together with its license.
