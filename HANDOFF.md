# Handoff

State of the project and how to continue. Keep this file updated at the end of
each work session.

## Done (session 1, 2026-11-06)

### Research
- Analysed the user's samples: an E*Trade screenshot (QCOM ESPP sale, 17
  shares, bought 31.1.2024, sold 11.5.2026) and the hand-filled form 1399 for it.
- **Rate mistake in the hand-filled sample:** the BOI rate for 31.1.2024 is
  **3.635**, but the sample used 3.647, which is the rate for 3.1.2024 or
  31.12.2024. The sample also contains an arithmetic slip:
  3939 × 2.909 = 11,458, not 11,455.
- The correct figures are: proceeds 11,458, cost 9,177, real gain 2,281, tax 570.
- Tax rules come from Income Tax Circular 10/2025, read from gov.il. Examples
  1–4 in the circular are implemented and tested.
- Reporting rules for foreign-broker sales of traded securities:
  - The 30-day 1399 notice does not strictly apply. Instead there is a
    semi-annual report with an advance payment, due 31.7 and 31.1.
  - The annual return reports these sales on 1325/1322, attached to 1301.
  - The user still wants a 1399 per lot for the accountant. The app produces
    those, plus a 1325-style appendix.
- Bank of Israel API: SDMX endpoint
  `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startPeriod=...&endPeriod=...&format=csv`.
  It returns 404 when an `Origin` header from another site is sent, so browsers
  cannot call it. The rates are bundled in the repo instead and refreshed by a
  GitHub Action.

### Decisions taken with the user
- **Output:** one 1399 page per lot, plus a summary appendix with half-year and
  year totals and loss offset.
- **Input:** upload of the E*Trade G&L export, with manual editing.
- **Rates:** BOI representative rate, with a manual override per row.
- **Output format:** the official PDF form, filled.
- **Cost:** E*Trade *Adjusted Cost Basis*.
- **Section 102 checkbox:** defaults to "yes" (the plan is 102 with a trustee).
  It can be changed per row.
- **Rates for the sample:** use the official rates, not the ones from the
  user's hand-filled sample.
- **Privacy:** the ID number and name are entered in the UI and kept in
  localStorage. They are never committed.

### Built
- Static app: `index.html`, `css/`, `js/`, `vendor/`, `assets/`, `data/`.
- `js/core.js` holds the calculation and parser. `js/pdf1399.js` holds the PDF
  filling, with field coordinates calibrated on the 2025 form.
- 13 unit tests (`npm test`). `tests/render_sample.js` renders a 3-lot sample
  to `out/` for visual checks.
- Workflows:
  - Daily rate refresh, which commits to `main`.
  - Tests on every push.
- Docs: `README.md`, `CLAUDE.md` (answer in Hebrew), and this file.

## Known gaps / next steps
1. **Real E*Trade file.** The parser was tested on a synthetic file shaped like
   `G&L_Expanded.xlsx`. Run it against a real export, then adjust
   `COLUMN_ALIASES` in `js/core.js` if headers differ. Things to check:
   - the "Adjusted Cost Basis" column for RSU rows;
   - whether "Total Proceeds" is net of fees.
2. **Enable GitHub Pages** (Settings → Pages → main / root) after merging. Then
   check the live link in README.
3. **Form edition per tax year.** Only the 2025 form (`1399y-2025`) is bundled.
   When the 2026 form is published:
   - add it under `assets/`;
   - let the app pick the form by sale year;
   - re-calibrate `FIELD_MAP` in `js/pdf1399.js` with `node tests/render_sample.js`.
4. **Section 102 trustee sales.** If the trustee already withheld tax, a 1399
   may not be needed at all. Consider a per-row "tax withheld" field that is
   excluded from the advance-payment totals.
5. **Surtax.** The 3% + 2% surtax on capital income above ₪721,560 is not
   calculated; only a flat 25% is. Possibly add a warning when the yearly gain is large.
6. **Other currencies.** Only USD is supported.
7. **Page 2 of the form** ("פרטים נוספים") is not included. It is not needed
   for simple share sales.

## How to continue
- Read `CLAUDE.md` first: always answer the user in Hebrew.
- Run `npm test` and `node tests/render_sample.js`, then look at `out/sample-1.png`.
- Field positions are in PDF points from the top-left corner (`FIELD_MAP`).
- Hebrew in the PDF:
  - `toVisual()` converts Hebrew to visual order.
  - fontkit's own RTL reversal is disabled by `ltrFontkit()`. Keep both, or
    Hebrew comes out reversed.
