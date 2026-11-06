# Development

A static site with no build step: plain HTML, CSS and JavaScript (classic
scripts, no bundler).

## Code structure

| File | Responsibility |
|---|---|
| `index.html` | The page and its sections. It loads vendor libraries, rate data and `src/js/*` in order. |
| `src/js/core.js` | Pure logic with no DOM, so it runs in the browser (`window.Core`) and in Node tests:<br>• date parsing<br>• rate lookup<br>• `computeLot` and `summarize`<br>• `crossCheck`, `nyToUtcEpoch` and `intradayAt`<br>• the E*Trade parser (`parseEtradeRows`, `COLUMN_ALIASES`) |
| `src/js/pdf1399.js` | Builds the PDF:<br>• copies page 1 of the blank form for each lot and draws the values at `FIELD_MAP` coordinates<br>• adds the summary pages<br>• works in the browser and in Node |
| `src/js/chart.js` | SVG chart of the representative rate with buy/sell markers and a hover tooltip |
| `src/js/app.js` | UI:<br>• state in localStorage<br>• year filter<br>• lot list: a table on desktop, cards below 760px<br>• edit drawer (`<dialog>`) with field validation and order-text paste<br>• the "how was it calculated" panel, with formula, substitution, rate cross-check and intraday rate<br>• headline tiles and sticky bar<br>• summary and general tax explanation<br>• chart<br>• PDF / Excel export and the pdf.js preview<br>• toasts with undo |
| `src/css/style.css` | Styles. The colour tokens on `:root` have a dark-mode variant. |
| `tools/update_rates.py` | Downloads all rate sources (see [exchange-rates.md](exchange-rates.md)) |

## Running locally

The PDF step loads the blank form and the font with `fetch`, which browsers
block on `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tests

The unit tests cover:
- Circular 10/2025 examples 1–4 and the edge cases;
- dates, money and E*Trade parsing;
- loss offset;
- the rate cross-check;
- New York → UTC conversion and intraday lookup.

Run them:

```bash
npm test
```

Render a 3-lot sample to `out/sample.pdf` and `out/sample-*.png` (the PNGs
need `pdftoppm`):

```bash
npm run sample
```

GitHub Actions runs both on every push (`.github/workflows/tests.yml`).

## PDF form filling

- **Coordinates.** `FIELD_MAP` in `src/js/pdf1399.js` holds every field
  position in **PDF points from the top-left corner** of the A4 page
  (595.28 × 841.89).
- **Hebrew text.** pdf-lib has no bidirectional text support.
  - `toVisual()` converts Hebrew strings to visual (left-to-right) order.
  - `ltrFontkit()` stops fontkit from reversing Hebrew a second time.

  Keep both, or the Hebrew comes out backwards.
- **Font.** Noto Sans Hebrew (`assets/fonts/`) covers Hebrew, Latin, digits, ₪
  and ×. It is embedded as a subset.

### Adding a new tax-year edition of the form

1. Download the new blank 1399 (י) PDF from the Tax Authority site and save it
   as `assets/forms/form-1399y-<year>-blank.pdf`.
2. In `src/js/app.js` (`onPdf`), choose the form file by the sale year.
3. Render the sample (`npm run sample`) with the new form, then compare
   `out/sample-1.png` against the blank form.
4. Adjust the `FIELD_MAP` coordinates if any boxes moved. One way to read
   exact positions:
   ```bash
   pdftotext -bbox -f 1 -l 1 assets/forms/<form>.pdf out.html
   ```
   It prints every word and checkbox glyph with its coordinates.

## E*Trade import

`parseEtradeRows` does the following:
- finds the header row, the first row that has *Date Sold* / *Date Acquired*;
- maps the columns through `COLUMN_ALIASES`;
- skips `Summary` and `Totals` rows;
- reads US dates (`MM/DD/YYYY`), Excel serial dates and money strings like
  `$1,234.56` or `(12.50)`.

If a real export uses different headers, add the normalised header name
(lower case, letters and digits only) to `COLUMN_ALIASES`.

## Vendor libraries

They are pinned and committed under `vendor/` (see `vendor/README.md`), so the
site has no runtime CDN dependency.

## Deploy

GitHub Pages serves the `main` branch root. It is configured under
Settings → Pages → Deploy from a branch → `main` / root, and `.nojekyll`
disables Jekyll processing. Every push to `main`, including the weekly rate
commit, redeploys the site within a minute or two.

## Conventions

- Code, comments, commit messages and docs are in English. The UI is in Hebrew
  (RTL).
- Never commit personal data. `.gitignore` excludes `G&L_*.xlsx/csv` and `out/`.
- Update [HANDOFF.md](HANDOFF.md) at the end of each work session.
