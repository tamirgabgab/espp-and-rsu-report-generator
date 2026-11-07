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
- Static app: `index.html`, `src/`, `vendor/`, `assets/`, `data/` (see the layout table in README).
- `src/js/core.js` holds the calculation and parser. `src/js/pdf1399.js` holds the PDF
  filling, with field coordinates calibrated on the 2025 form.
- 13 unit tests (`npm test`). `tests/render_sample.js` renders a 3-lot sample
  to `out/` for visual checks.
- Workflows:
  - Daily rate refresh, which commits to `main`.
  - Tests on every push.
- Docs: `README.md`, `CLAUDE.md` (answer in Hebrew), and this file.

## Done (session 1, continued)

### Live site
- GitHub Pages is enabled from `main` / root.
- The site is live at https://tamirgabgab.github.io/espp-and-rsu-report-generator/.

### Rate sources
- `tools/update_rates.py` now downloads four sources:

  | Source | What | File | Role |
  |---|---|---|---|
  | BOI | representative rate | `data/rates/daily/boi.*` | the form |
  | ECB | via Frankfurter | `data/rates/daily/ecb.json` | cross-check |
  | Yahoo | `ILS=X` daily close | `data/rates/daily/yahoo.json` | cross-check |
  | Yahoo | 1m and 60m bars | `data/rates/intraday/` | rate at sale time, information only |

- ECB and Yahoo daily are bundled for the browser in `data/rates/daily/secondary.js`.
- If one source fails, the others still run. The run fails only if BOI fails.
- Yahoo limits:
  - 1-minute bars: last 30 days, at most 7 days per request;
  - hourly bars: about 730 days;
  - daily bars: full history.
- The weekly run keeps a permanent minute archive. It merges into the monthly
  files, so overlapping runs are harmless.
- Measured deviation from BOI, 2020–2026:

  | Source | Median | p99 | Max |
  |---|---|---|---|
  | ECB | 0.08% | 0.69% | 0.99% |
  | Yahoo | 0.22% | 1.37% | 3.37% |

  The warning thresholds are 1% for ECB and 1.5% for Yahoo (`CHECK_THRESHOLDS`
  in `src/js/core.js`).
- The workflow became weekly: Saturday 19:41 UTC, plus manual dispatch.

### Sale time and rate control
- New optional column for the sale time, in New York time.
- `Core.nyToUtcEpoch` converts it to UTC with DST handled.
- `Core.intradayAt` picks the bar whose close time is nearest to the sale
  moment. Yahoo stamps bars with their start time but stores the close price.
- New UI section "בקרת שערים":
  - shows BOI, ECB and Yahoo for every purchase and sale date;
  - shows the intraday rate at the sale time, its difference from the
    representative rate, and the effect on proceeds in ₪.
- The same data is in an Excel sheet. The intraday rate is information only:
  the form always uses the BOI rate.

### Decisions taken with the user
- The intraday rate is for control only.
- Cross-check against both ECB and Yahoo.
- Intraday data comes from Yahoo, kept in a weekly archive.
- All sources update weekly.

## Done (session 1, repository reorganisation)

- Files moved into folders, with history kept through `git mv`:

  | Old path | New path |
  |---|---|
  | `js/`, `css/` | `src/js/`, `src/css/` |
  | blank form | `assets/forms/` |
  | font + licenses | `assets/fonts/` |
  | vendor licenses | `vendor/licenses/` (plus `vendor/README.md`) |
  | daily rates | `data/rates/daily/{boi,ecb,yahoo}.json`, `boi.js`, `secondary.js` |
  | intraday rates | `data/rates/intraday/` |
  | updater script | `tools/update_rates.py` |
  | this file | `docs/HANDOFF.md` |

- `index.html` stays at the root, so the GitHub Pages settings are unchanged.
- The README is now short: app link, quick start, docs table and repository
  layout.
- Detailed docs moved to `docs/`: `user-guide.md`, `tax-calculation.md`,
  `exchange-rates.md` and `development.md`.

## Done (session 1, UX round: packages A + B + C)

### Package A: mobile and result first
- Headline tiles at the top: real gain, tax, next advance payment with its due
  date, and lot count.
- A sticky bottom bar with the gain, the tax and a download button.
- New page order: import → lots → summary/explanation → chart → details and
  download. Personal details moved to the last step.
- Lots are a compact table on desktop and cards below 760px. Editing moved to
  a `<dialog>` drawer.
- The chart sizes its viewBox to the container width, so labels stay readable
  on phones.

### Package B: trust and understanding
- Each lot has a "איך חושב?" (how was it calculated?) panel:
  - every formula with the numbers substituted;
  - the rate date used;
  - the Circular 10/2025 case (`Core.SCENARIO_TEXT`);
  - the rate cross-check table;
  - the intraday rate.
- The old separate "rate control" section is merged into this panel. Each row
  now has a status badge: ✓ / ⚠ missing data / ⚠ rate deviation.
- A general explainer ("איך מחושב המס?") covers:
  - the parameters P, C, F, R_b, R_s;
  - the formulas;
  - the closed-form rule `real = min/max(A, B)`;
  - capital-gains tax vs. marginal tax;
  - a substitution with the first lot's numbers.
- `Core.closedFormReal` gives the closed form. A test checks it against
  `computeLot` on 2,000 random lots, within ±3 ₪ of rounding.
- Field-level validation in the edit drawer: on blur and on save, with
  `aria-invalid` and error text under the field.
- PDF preview in a dialog, using pdf.js 3.11.174 (lazy-loaded). It needs
  `disableFontFace: true`, otherwise the form's Hebrew CID fonts render garbled.

### Package C: import and editing comfort
- Drop zone for the file; dropping anywhere on the page also works.
- Delete and delete-all show a toast with undo, instead of `confirm()`.
- Israeli ID check-digit validation (`Core.isValidIsraeliId`). An invalid ID
  blocks export, while an empty ID is allowed with a reminder.
- Pasting the "Order Details" text fills the sale date and time
  (`Core.parseOrderText`, AM/PM aware).
- Year chips filter the list, tiles, summary, chart and exports when the lots
  span more than one year.

### Requested by the user in this round
- A general explanation of how the tax is calculated: a general formula that
  depends on all the parameters (including the exchange rate), then the
  specific numbers substituted.
- An explanation of marginal tax vs. capital-gains tax.
- Both are done: see above and `docs/tax-calculation.md`.

## Done (session 1, UX audit, priority 1: hard-rule fixes)

A UX audit ran against the 19 VectorLab skills. Priority 1 fixes:

- **`[hidden]` bug:** `[hidden]{display:none!important}`. The year chips and
  "delete all" no longer show on an empty list.
- **Focus management:**
  - after saving, focus returns to the lot's edit button;
  - after a delete, it moves to the next lot (or the list heading);
  - after undo, it moves to the restored lot.
  - Helper: `focusLot()`.
- **ID number is never persisted.** `persist()` strips `idNumber`, and old
  stored values are dropped on load. Decided with the user.
- **Delete-all confirmation:** an `alertdialog` that names the count, with
  Cancel focused, and the confirm button saying "מחיקת N עסקאות". An undo toast
  follows. Single-lot delete stays instant with undo, a deliberate exception
  agreed with the user.
- **Hit targets:** every control is at least 44px (buttons, chips, links,
  summaries, inputs, footer link, toast action). Measured.
- **Year chips:** a real radiogroup with a roving tabindex. Arrow keys (RTL:
  Left = next), Home and End select and focus.
- **Tooltips:** icon buttons use `data-tip` CSS tooltips, shown on hover and on
  focus-visible, instead of `title`. `aria-label` matches the tooltip text.
- **Errors:**
  - no raw `e.message` in the UI;
  - messages are short, without blame, and offer recovery ("ניסיון חוזר",
    "בחירת קובץ אחר") plus "העתקת פרטי השגיאה" (copy error details);
  - helper: `setMsg(el, text, kind, {actions, details})`.
- **Reduced motion:** `scrollToEl()` uses instant scroll when
  `prefers-reduced-motion: reduce` is set.

## Known gaps / next steps
1. **Real E*Trade file.** The parser was tested on a synthetic file shaped like
   `G&L_Expanded.xlsx`. Run it against a real export, then adjust
   `COLUMN_ALIASES` in `src/js/core.js` if headers differ. Things to check:
   - the "Adjusted Cost Basis" column for RSU rows;
   - whether "Total Proceeds" is net of fees.
2. **Minute archive coverage.** The minute archive starts in October 2026; earlier
   sales have hourly data back to about November 2024, and nothing intraday
   before that. Getting minute data further back needs a paid API key
   (Twelve Data / Polygon) stored as a GitHub secret.
   - If Yahoo blocks GitHub runners (HTTP 429), the weekly run logs it and
     continues; the next run catches up as long as it is within 30 days.
3. **Form edition per tax year.** Only the 2025 form (`1399y-2025`) is bundled.
   When the 2026 form is published:
   - add it under `assets/forms/`;
   - let the app pick the form by sale year;
   - re-calibrate `FIELD_MAP` in `src/js/pdf1399.js` with `npm run sample`.
4. **UX package D (not started):**
   - backup/restore of all data to a file;
   - a ZIP for the accountant (PDF + Excel + source file);
   - PWA installation and offline use;
   - a manual light/dark theme toggle.
5. **Section 102 trustee sales.** If the trustee already withheld tax, a 1399
   may not be needed at all. Consider a per-row "tax withheld" field that is
   excluded from the advance-payment totals.
6. **Surtax.** The 3% + 2% surtax on capital income above ₪721,560 is not
   calculated; only a flat 25% is. Possibly add a warning when the yearly gain is large.
7. **Other currencies.** Only USD is supported.
8. **Page 2 of the form** ("פרטים נוספים") is not included. It is not needed
   for simple share sales.

## How to continue
- Read `CLAUDE.md` first: always answer the user in Hebrew.
- Run `npm test` and `node tests/render_sample.js`, then look at `out/sample-1.png`.
- Field positions are in PDF points from the top-left corner (`FIELD_MAP`).
- Hebrew in the PDF:
  - `toVisual()` converts Hebrew to visual order.
  - fontkit's own RTL reversal is disabled by `ltrFontkit()`. Keep both, or
    Hebrew comes out reversed.
