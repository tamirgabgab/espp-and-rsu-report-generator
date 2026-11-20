# Improvement plan

Review date: 2026-11-20. Reviewed commit: `ce45d48` (branch `claude/gracious-gates-wpvl8e`; `main` is one
weekly data commit ahead).

This file lists what a full review of the repository found, grouped into five work rounds from the most
severe to the simplest. Nothing in the app was changed by the review. Each finding has an ID, so a round can
be started with a short prompt such as "implement S1-S7 from plan.md".

## How the review was done

- **Read in full:** `src/js/*.js` (10 files, 4,300 lines), `index.html`, `tools/update_rates.py`, both
  workflows, `package.json`, `manifest.webmanifest`, `vendor/README.md`.
- **Checked by pattern, not read in full:** `src/css/style.css` (tokens, unused classes, media queries) and
  `docs/*.md`.
- **Run:** the 37 unit tests (all pass); a Node script against `Core` for the logic suspicions; a Playwright
  run against a local server for load weight, render cost, bug reproductions, axe-core 4.10 (WCAG 2.2 AA) on
  all four tabs, and screenshots at 375 px and 1280 px in light and dark.
- **Skills used as lenses:** `ponytail` (smallest complete change, duplication, dead code), the VectorLab UX
  skills (`ux-audit` and its domain skills: viewports, typography, colour, forms, keyboard, surfaces),
  `frontend-design`, and `claude-api` (model and effort guidance below). "UI UX Pro Max" and "impeccable" are
  not installed in this session, so they were not used.

Status words used below:

| Status | Meaning |
|---|---|
| **Verified** | Reproduced in a browser or in Node during this review. |
| **Advisory** | The vendored version and the way it is called match a published advisory. No exploit was run. |
| **Read** | Found by reading the code. Not executed. |
| **Decision** | Needs a decision from the owner (often a tax question) before any code is written. |

## Rounds at a glance

| Round | Scope | Findings | Recommended model and effort | Cheaper option |
|---|---|---|---|---|
| 1 | Security and data integrity | S1-S7 | Opus 5.5, `high` | Sonnet 5.5, `high` (leave S7 for Opus) |
| 2 | Tax logic and the data pipeline | L1-L16, D1-D3 | Fable 5.2, `high` | Opus 5.5, `high` |
| 3 | Performance and duplicated code | P1-P8 | Opus 5.5, `medium` | Sonnet 5.5, `medium` |
| 4 | UX and UI | U1-U15 | Opus 5.5, `high` | Sonnet 5.5, `high` |
| 5 | Tests, CI, docs, hygiene | T1-T7 | Sonnet 5.5, `medium` | Haiku 5.5, `medium` for T3-T6 |

Notes on the choice:

- API list prices per million tokens (input / output), from the `claude-api` skill's table cached on
  2026-11-03: Fable 5.2 $8 / $40, Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50. On a
  subscription the same order holds for how fast each model uses the plan's limits.
- Round 2 is the only round where the most capable model earns its price: the findings are few lines of code
  each, but a wrong reading of the tax rule is expensive and tests cannot catch it. Rounds 1, 3 and 4 are
  well specified here and have checks (unit tests, the browser script), so a mid-tier model does them well.
- Effort above `high` is not worth it for any round. Lower effort mainly means fewer tool calls; `medium` is
  enough where the change is mechanical (round 3, round 5).
- To keep token use down: one round per fresh session, name the finding IDs in the prompt, and do not ask
  for a new review. Run `npm test` and the browser check from T1 at the end of each round.

---

## Round 1: security and data integrity

### S1. Stored XSS through a backup file (profile fields) · High · Verified

- **Where:** `src/js/formulas.js:165` writes `App.profile.marginalRate` and `App.profile.niRate` into
  `innerHTML` without escaping. The values arrive unchecked from `Core.parseBackup` (`src/js/core.js:537-538`)
  through `applyRestore` (`src/js/app.js:1149`, `1156`) and are then saved to `localStorage`.
- **Reproduced:** a backup with `"marginalRate": "<img src=x onerror=...>"` ran its script on restore, and
  again on every page load after that (the formulas view renders at start-up).
- **Impact:** a backup file received from someone else can run script in the app's origin: read the saved
  lots and name, and the ID number while it is typed.
- **Fix:** in `parseBackup`, coerce profile fields by type (`marginalRate`, `niRate` numbers clamped to
  0-100, `includeNi` / `sec102` booleans, `belonging` and `place` from their allowed lists, `name` a string
  with a length cap). Apply the same function to the profile read from `localStorage` (`app.js:32`). Escape
  at the sink too (`App.esc`, or use `rate()` which is already numeric).
- **Test:** unit test for `parseBackup` with hostile profile values.

### S2. pdf.js 3.11.174 on user-supplied PDFs (CVE-2024-4367) · High · Advisory

- **Where:** `vendor/pdfjs/` is 3.11.174. `src/js/docimport.js:165` and `src/js/app.js:1053` call
  `getDocument({ data, disableFontFace: true })`. With `disableFontFace` every glyph goes through pdf.js's
  compiled path generator, which is the code path of the advisory (arbitrary script from a crafted font,
  fixed in 4.2.67). `docimport.js:184` renders pages of uploaded PDFs when no single page image is found.
- **Impact:** a crafted PDF chosen in the upload box could run script in the app's origin. The user normally
  uploads their own E*Trade files, so the likelihood is low, but the fix is one option.
- **Fix now:** add `isEvalSupported: false` to both `getDocument` calls (the official mitigation), then check
  that the 1399 preview still draws the Hebrew glyphs.
- **Fix later:** upgrade pdf.js to 4.2.67 or newer. Version 4 ships as ES modules (`.mjs`), so the two loaders
  need to change; do it together with P3.

### S3. SheetJS 0.18.5 reads user spreadsheets · Medium · Advisory

- **Where:** `vendor/xlsx.full.min.js` is 0.18.5; `XLSX.read` runs on uploaded files (`app.js:716`,
  `sim.js:306`).
- **Advisories:** CVE-2023-30533 (prototype pollution when reading a crafted file, fixed in 0.19.3) and
  CVE-2024-22363 (regular-expression denial of service, fixed in 0.20.2).
- **Fix:** replace the file with 0.20.3 from `cdn.sheetjs.com` (newer versions are not published to npm) and
  update `vendor/README.md`. Run `npm test`, an XLSX import and an XLSX export.

### S4. Importing the same file twice doubles every sale · High · Verified

- **Where:** `src/js/app.js:725` (Excel / CSV) and `app.js:833` (PDF / screenshot) append with `concat`.
  `Core.mergeLots` (`core.js:546`) already skips exact duplicates but is used only for backup restore.
- **Reproduced:** the same `G&L` file imported twice gave 6 lots instead of 3, and the tax doubled.
- **Fix:** use `Core.mergeLots` in both imports and say how many duplicates were skipped.

### S5. An unsaved draft is offered on a different lot after a reload · Medium · Verified

- **Where:** `src/js/app.js:473` keys the draft by `lot-${editingId}`. Lot IDs are session counters assigned
  in load order (`app.js:36`), so the same number points at another lot after a reload.
- **Reproduced:** a draft typed on the QCOM lot showed "there is an unsaved draft" on a different lot after
  reload; "continue from the draft" would overwrite that lot's fields with QCOM's.
- **Fix:** key lot drafts by `Core.lotKey(lot)`, or drop non-`new` drafts at page load.

### S6. Stored and restored data is trusted as is · Medium · Verified

- **Where:** lots from `localStorage` go through `revive` (`app.js:35`) only; `Core.cleanLot`
  (`core.js:492`) exists but is neither exported nor used there. Manual rates are used without a range check
  (`core.js:149-152`, `284`).
- **Reproduced:** `rateBuy: "abc"` gives `ok: true` with `NaN` amounts; `rateSell: "-3"` gives negative
  proceeds; `"0"` passes the `min="0"` input and divides by zero.
- **Fix:** export `cleanLot`, use it when loading from `localStorage` (this also removes `revive`, see P3),
  and treat a manual rate that is not a number above 0 as a missing rate with a clear message.

### S7. No Content-Security-Policy · Medium · Read

- **Where:** `index.html` has no CSP `<meta>`. Almost all rendering is `innerHTML` with manual escaping
  (40 call sites), so one missed escape is a script injection (see S1).
- **Fix:** add `<meta http-equiv="Content-Security-Policy">` with `default-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self' 'unsafe-inline'` (KaTeX and the money bar use
  inline styles), `img-src 'self' data: blob:`, `worker-src 'self' blob:`, `connect-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Move the inline theme script in the `<head>`
  to a small file. Needs S2 first (pdf.js must not need `eval`).
- **Check carefully:** the Tesseract worker (it starts from a blob URL by default; `workerBlobURL: false` may
  be needed), the pdf.js worker, KaTeX, JSZip, and downloads through blob URLs.
- **Related note for the README:** all sites under `tamirgabgab.github.io` share one origin, so another
  Pages project of the same account can read this app's `localStorage`. A custom domain removes that.

---

## Round 2: tax logic and the data pipeline

### L1. A loss from one year is not carried into the next · High · Verified

- **Where:** `Core.summarize` (`src/js/core.js:345-351`) computes each year alone and only reports
  `carryLoss`. The headline tiles add the years up (`src/js/app.js:368-369`).
- **Reproduced:** a 2025 loss of 14,512 and a 2026 gain of 11,820 give "net real gain (2,692), tax 2,955,
  after loss offset". With the carry-forward the 2026 tax is 0.
- **Fix:** carry `carryLoss` from each year into the next year's `net` inside `summarize`, show it as its own
  line on the year card and the PDF summary, and add an optional "loss carried from earlier years" input for
  losses that are not in the tool. Make the headline show tax per year when more than one year is in view.
- **Decision:** confirm with the accountant that the carried loss should be applied automatically.

### L2. The "what if" chart deducts fees twice · Medium · Verified

- **Where:** `whatIfLots` sets `proceedsUsd = price × qty − fees` (`core.js:809`), and `computeLot` then
  subtracts the fees again. `evaluateLot` shows `salePerShare = (proceeds + fees) / qty` (`core.js:772`).
- **Reproduced:** with fees of $50 the actual net is 2,166 and the "same price" variant is 2,057; the actual
  sale price shows 234.64 instead of 231.70. No effect when fees are 0 (the import default).
- **Fix:** `proceedsUsd = round2(price × qty)` and `salePerShare = proceeds / qty`. Add a unit test with fees.

### L3. "Left in hand" means three different things · Medium · Verified

- **Where:** the simulator returns proceeds minus taxes (`core.js:1044`); the "what if" table and the
  formulas tab also subtract what was paid and the fees (`core.js:767`, `formulas.js:183`). All three use the
  label "נשאר ביד". The formulas tab has its own copy of the calculation (`formulas.js:81-115`).
- **Fix:** one definition in `Core.evaluateLot`, used by all three views, and two distinct labels if both
  numbers are wanted ("cash from the sale after tax" and "net profit").

### L4. Tax withheld by the trustee is not reflected in what is due · High · Decision

- **Where:** `renderHero` (`app.js:377-388`) shows the full 25% capital tax as the next advance, also for
  section 102 lots where the trustee withholds at the sale. `withheldIls` is only compared in a note
  (`app.js:253-256`).
- **Fix:** show "withheld by the trustee" and "still to pay" for 102 lots. Needs a decision on how to split
  one withheld amount between the work-income part and the capital part.

### L5. ESPP under section 102: value of the benefit · Medium · Decision

- **Where:** `computeLot102` (`core.js:280-283`) takes the purchase-date market value as the benefit value
  for ESPP, and the 30-trading-day average only for RSU.
- **Why it matters:** for a listed company the section 102 capital-track rule is the average of the 30
  trading days before the allocation. Which date counts as the allocation in an ESPP is plan-specific.
- **Fix:** compare with one real trustee statement, then either keep the current rule or add an optional
  "benefit value per share" field for ESPP lots. Until then, say in the panel which rule was used.

### L6. Default marginal rate: 47% plus 12% national insurance · Low · Decision

- **Where:** `WORK_DEFAULTS` (`core.js:239`).
- **Why:** income in the 47% bracket is at or above the national-insurance ceiling, so 59% overstates the
  estimate for most users of that bracket.
- **Fix:** default `includeNi` to off, or default to a lower bracket with it on, and explain the choice in
  the field's note.

### L7. The second half-year advance ignores a first-half loss · Low · Decision

- **Where:** `summarize` treats each half as its own group (`core.js:338-342`).
- **Fix:** ask the accountant whether a January-June loss reduces the July-December advance; if yes, carry
  it inside the year.

### L8. "Today" is taken in UTC · Low · Read

- **Where:** `app.js:20` (`toISOString`), `pdf1399.js:186`, and the draft stamp at `app.js:488`.
- **Effect:** between midnight and 02:00 or 03:00 Israel time the default signing date, the backup file name
  and the advance due-date comparison use yesterday.
- **Fix:** build the date from local parts (one helper, used in the three places).

### L9. Unknown plan types are changed silently · Low · Verified

- **Where:** the review dialog for documents builds a `<select>` from four options (`app.js:760`); a plan the
  list does not have becomes "ESPP". In the editor (`index.html:405`) it becomes empty.
- **Reproduced:** a lot with plan "SAR" opened in the editor with an empty plan.
- **Fix:** add the lot's own plan as an option when it is not in the list.

### L10. Restore edge cases · Low · Read

- `app.js:1156`: "add to the list" overwrites a `false` profile value (`sec102`, `includeNi`) with the
  backup's value, because it tests `!profile[k]`.
- `app.js:1150`: "replace the list" keeps the old simulator holdings when the backup has none.

### L11. Notes in the PDF and in `explanation.txt` describe the regular track only · Low · Read

- **Where:** `pdf1399.js:279` (note 4) and `app.js:1227` always say the cost is the Adjusted Cost Basis.
  For 102 lots the cost is what was paid plus the work income, at the allocation-date rate.
- **Fix:** add the 102 sentence when the report contains 102 lots (the text file already has one at
  `app.js:1229-1232`; the PDF has none).

### L12. RSU under 102: dragging the vest point changes nothing · Low · Read

- **Where:** `computeLot102` uses the grant date for RSU and never reads `dateAcquired`
  (`core.js:264-312`); `whatif.js` still offers the "vest" handle.
- **Fix:** hide the handle for RSU 102 lots, or replace it with a grant-date handle that moves the 30-day
  average.

### L13. "Fill from my lot" shows numbers that differ from the report · Low · Verified

- **Where:** `formulas.js:266` converts totals to per-share values rounded to 4 decimals, so the formulas tab
  shows 2,145.91 paid and 378.76 work income where the report shows 2,145.97 and 378.70.
- **Fix:** keep the lot's totals when filling from a lot.

### L14. PDF summary page can overflow · Low · Read

- `pdf1399.js:249-272` starts a new page only before the period table, not inside it. More than about eight
  periods (four years) run off the page.

### L15. A date typed as `11.5.2026` is read as 5 November · Low · Verified

- `Core.parseDate` (`core.js:52-57`) defaults to the US order for every separator. The app itself prints
  dates as `d.m.yyyy`. Only matters for a hand-edited CSV; treat dots as day-first.

### L16. Surtax is not calculated · Known gap

- Stated in the UI. Listed here so it stays on the list: 3% plus the extra 2% on capital income above the
  yearly threshold.

### D1. The weekly update can shrink or change the rate history unnoticed · Medium · Read

- **Where:** `tools/update_rates.py`: `fetch_boi` (line 78) only requires 10 rows, and line 235 overwrites
  `boi.json` / `boi.js` with whatever came back.
- **Risk:** a partial answer from the Bank of Israel API would be committed and old lots would lose their
  rates; a changed historic value would silently change past results.
- **Fix:** before writing, compare with the existing file: fail if the count dropped or the first date moved
  forward, and list any existing date whose value changed. Keep rates between 2 and 5 only.

### D2. Failures of the secondary sources are silent · Low · Read

- **Where:** `update_rates.py:270` returns 0 unless the Bank of Israel source failed, so ECB, Yahoo and stock
  prices can be stale for weeks.
- **Fix:** print a GitHub warning annotation (`::warning::`) per failed source, and show in the app when the
  stock prices were last updated (the rate chart already shows the last rate date).

### D3. Stock closes are split-adjusted · Low · Read

- After a stock split Yahoo rewrites the whole history, so a 30-day average for an old grant changes while
  the lot's share count does not. Add a note next to the automatic average, and prefer the trustee's figure.

---

## Round 3: performance and duplicated code

### P1. 2.2 MB of libraries load before the page can be used · High · Verified

- **Measured:** first load is 17 requests and 2.71 MB uncompressed. `xlsx` (882 KB), `fontkit` (758 KB) and
  `pdf-lib` (525 KB) are 80% of it and are loaded with blocking `<script>` tags (`index.html:609-611`).
- **Fix:** load `pdf-lib` and `fontkit` when a PDF is built, and `xlsx` on import or export, with the lazy
  loader that already exists. Add `defer` to the remaining scripts. `pdf1399.js` already reads the libraries
  at call time.

### P2. Every change redraws everything · Medium · Verified

- **Measured:** with 200 lots one `render()` takes 107 ms and the page holds 12,031 DOM nodes.
- **Where:** `render()` (`app.js:103-115`) builds both the desktop table and the mobile cards for every lot
  (`app.js:158-197`), redraws the 1,700-point rate chart, and writes `localStorage`. It runs on every tab
  switch (`app.js:1362`) and on every keystroke in the tax-rate fields (`app.js:940`). `visibleItems()`
  recomputes all lots again inside `renderHero` (`app.js:391`), and the rate cross-check is computed three
  times per lot (`app.js:70`, `282`, `1109`).
- **Fix:** build only the layout that is showing (`matchMedia`), compute the items once per render and pass
  them down, redraw the chart only when the lots or the year filter changed, and call `persist()` from the
  places that change data.

### P3. Duplicated code · Medium · Read

| What | Where | Replace with |
|---|---|---|
| Script loader | `app.js:1026`, `docimport.js:19`, `explain.js:13` | one `App.loadScript` (also loads the stylesheet for KaTeX) |
| pdf.js loader and worker path | `app.js:1047-1050`, `docimport.js:27-33` | one function |
| Radio-group keyboard handler | `app.js:1419-1431` repeats `radioKeys` (`app.js:1306`) | call `radioKeys` |
| Close a dialog on backdrop or `[data-close]` | `app.js:619-623`, `843`, `1473`, `1486`, `sim.js:342` | one `bindDialogClose(dialog)` |
| Edit and delete icons | `app.js:138-139`, `sim.js:66-67` | export from `App` |
| Number revival for stored lots | `app.js:35` (`revive`) vs `core.js:492` (`cleanLot`) | `cleanLot` (see S6) |
| "Is this lot 102" | `sim.js:19` vs `app.js:55` | `App.sec102Of` |
| Allocation date | `sim.js:71` vs `Core.allocationDate` | `Core.allocationDate` |
| Net amount after tax | `core.js:1036-1049`, `core.js:751-774`, `formulas.js:81-115`, `180-190` | `Core.evaluateLot` (see L3) |
| "Use the last rate for a future date" | `core.js:754`, `formulas.js:42` | one helper in `Core` |
| Marginal-tax fields | three copies in `index.html` (`207-217`, `270-280`, `329-339`) | one copy in a shared place, or a `<template>` |
| The four-case formula list | `formulas.js:202-217` | remove; the explanation tab (`explain.js`) covers it |
| Lot editor and holding editor | `app.js:445-592`, `sim.js:205-282` | leave as is unless a third editor appears |

### P4. Dead or confusing code · Low · Verified

- `docimport.js:15` `TARGET_WIDTH` and `whatif.js:14` `NS` are never used.
- `app.js:419` is a section header with nothing under it.
- `style.css:249-250` `.explain-all` has no element.
- `app.js:1189` declares a local `L` that hides the `L()` helper from `app.js:26`.
- `whatif.js:36` changes the shared `POINTS.buy.label` on every mount; pass the label instead.
- `formulas.js:265-274` is indented two levels too deep.

### P5. `app.js` is one 1,500-line function · Low · Read

- Split only if it keeps growing: import (Excel and documents), export (PDF, Excel, ZIP, backup), and the
  editor are natural files. Not needed for any other finding here.

### P6. Data files are stored twice and rewritten whole every week · Low · Read

- Each source exists as `.json` and inside a `.js` bundle (`boi.json` + `boi.js`, `ecb.json` + `yahoo.json`
  + `secondary.js`, `QCOM.json` + `prices.js`), all on one line, so each weekly commit stores about 0.5 MB
  again. The repository is 13 MB after two weeks of history.
- **Fix:** keep one copy per source, and write one date per line so git stores only the new lines.

### P7. OCR always reads the picture three times · Low · Read

- `docimport.js:97-108` runs three passes for every image. Run the second and third only when the first
  parse found no sale or failed a cross-check (`Core.lotProblems`). About two thirds less waiting on a phone.

### P8. No offline support · Optional

- The app can be installed (`manifest.webmanifest`) but has no service worker, so it does not open without a
  network. A small cache-first worker for the app shell would fix that. Add only if wanted.

---

## Round 4: UX and UI

Screens were judged from screenshots at 375 px and 1280 px, light and dark, with the built-in examples.
What passes today: no page-level horizontal overflow, 44 px targets, a 12 / 14 / 16 / 20 type scale with two
weights, visible focus, named destructive confirmations, blur-first validation, dark-mode tokens.

### U1. The calculation table is cut off on a phone · High · Verified

- At 375 px the `$ | rate | ₪` table (`app.js:258-260`) does not fit: the ₪ column is hidden behind a
  sideways scroll (only "8" of "11,458" shows) and the row labels wrap one word per line. Three nested boxes
  (card, lot card, panel) use about 80 px of the 375.
- **Fix:** on narrow screens show each row as label + ₪ amount with the `$ × rate` on a second small line,
  and drop the panel's own border and padding inside a lot card.

### U2. Point labels collide in the "what if" chart on a phone · Medium · Verified

- "תחילת התקופה" is clipped at the chart's left edge and overlaps "רכישה" and the axis numbers; seven date
  ticks are squeezed into 280 px (`whatif.js:96-118`).
- **Fix:** below 480 px use three or four ticks, keep labels inside the plot area, and when two labels
  overlap move one below its point.

### U3. The calculation panel is too long · Medium · Verified

- One open lot is about 1,700 px tall on a desktop and about 3,500 px on a phone: table, results, notes,
  chart, three date fields, a comparison table, the rate check and the intraday note.
- **Fix:** keep the table and results open, and put "what if" and "rate check" in closed `<details>`. Show
  the comparison table only after a point is moved; before that it repeats the ten numbers above it.

### U4. Desktop: the comparison table sits at the far left · Low · Verified

- The date fields align to the right and the table under them to the left, with an empty gap. Make
  `.wi-table` full width or align it to the start.

### U5. Accent colour fails contrast in the light theme · Medium · Verified

- `--accent: #2a78d6` (`style.css:11`) gives 4.3:1 to 4.4:1 against the light surfaces; WCAG AA needs 4.5:1.
  It affects the primary buttons, text links, the `<summary>` lines, and the simulator's net amount
  (19 elements flagged). The dark theme passes.
- **Fix:** darken the light-theme token slightly (for example `#2570cc`) and re-run axe.

### U6. Smaller accessibility findings · Low · Verified

- Three tables have an empty first header cell (`app.js:259`, `286`; `whatif.js:158`): add visually hidden
  text.
- Regions that scroll sideways cannot be reached by keyboard: `.table-scroll` and `.ex-math` (9 formulas on
  a phone). Add `tabindex="0"`, `role="region"` and a label.
- The sticky bar (`index.html:371`) is outside any landmark: make it part of `<main>` or give it a role.

### U7. The form details are at the bottom, the download at the top · Medium · Read

- Step 4 "details for the form" (`index.html:170`) sits under the rate chart, and its hint sends the user
  back up to download.
- **Fix:** move step 4 above the chart and add a download button inside it, or ask for the name and ID
  number when "download PDF" is pressed.

### U8. Two primary buttons on screen at once · Low · Verified

- On a desktop the sticky bar shows "הורדת PDF" while the toolbar with the same button is still visible.
  Show the sticky bar only after the toolbar scrolls out of view (`IntersectionObserver`).

### U9. The page header takes 300 px on a phone · Low · Verified

- Title on two lines, the theme switch on its own row, a four-line introduction, and tabs that wrap onto two
  lines. Move the theme switch to the footer, shorten the introduction on narrow screens, and let the tab
  row scroll sideways instead of wrapping.

### U10. Wording is not consistent · Low · Read

- "נשאר ביד" (see L3); "עסקה", "מכירה", "lot" and "מנה" for neighbouring ideas; "מס משוער" in one place and
  "מס רווח הון" in another for the same number. Pick one term per idea.

### U11. Undo disappears after 7 seconds · Low · Read

- `app.js:98`. Keep a toast that carries "undo" until it is dismissed. Status badges explain themselves only
  through `title`, which does not exist on touch; the panel should carry the same sentence.

### U12. The rate chart always shows 2020 onwards · Low · Read

- `chart.js:23`. Sales before 2020 are not marked, and with one or two lots most of the chart is unrelated
  history. Start the range three months before the earliest purchase, or close the card by default.

### U13. Date fields follow the browser's language · Low · Verified

- On an English-language phone they show `05/11/2026` while the app prints `11.5.2026`. Print the app's
  format next to each date field in the "what if" block.

### U14. Formulas wrap in the middle of an equation on a phone · Low · Verified

- For example `(3,938.96 − 2,524.67 − 0.00) × 2.909 =` / `4,114 ₪`. Break before the `=` or let the line
  scroll.

### U15. Deleting a lot has no confirmation, deleting all has one · Low · Read

- Both have undo. This is consistent with the "undo over confirm" rule; listed only so the choice is
  recorded.

---

## Round 5: tests, CI, docs, hygiene

### T1. The browser checks are not in the repository · Medium · Read

- The Playwright scripts used during development live in a scratch folder and are lost with the session.
  Commit one smoke test (`tests/e2e.js`: import, open a panel, the three downloads, the four tabs at two
  widths and two themes, no console errors) and run it in `tests.yml`.

### T2. Add a regression test with each fix · Medium

- At least: S1 (hostile backup), S4 (double import), S6 (bad manual rate), L1 (loss carry-forward), L2 (fees
  in "what if"), L8 (local date), D1 (shrinking rate file).

### T3. Workflow hardening · Low · Read

- `tests.yml` has no `permissions:` block; add `contents: read`.
- Optional: pin the actions by commit hash, and add `node --check src/js/*.js` as a free syntax gate.

### T4. Vendored libraries have no update alerts · Low · Read

- Dependabot does not see files copied into `vendor/`. Add a short "check every quarter" list to
  `vendor/README.md` with the advisory pages of pdf.js, SheetJS, Tesseract.js, KaTeX and JSZip.

### T5. Docs · Low · Read

- `vendor/README.md` has a broken sentence ("pdf.js It runs with ...").
- After each round update `docs/HANDOFF.md`; after round 2 update `docs/tax-calculation.md`.

### T6. Privacy note · Low · Read

- Add the shared-origin note from S7 to the README's privacy section.

### T7. Still open from earlier sessions

- The 2026 edition of form 1399 (coordinates in `pdf1399.js` are calibrated for 2025).
- Real samples of a trade confirmation and a trustee report (needed for L4 and L5 too).
- A test with real E*Trade Holdings and G&L files.
- Surtax (L16).

---

## What was not checked

- No real E*Trade file, trustee report or filled form was compared with the output.
- The tax rules in L4-L7 were checked against the code and general knowledge of section 102, not against a
  professional source. They are marked **Decision** for that reason.
- S2 and S3 rest on the published advisories and the vendored version numbers; no exploit was attempted.
- `src/css/style.css` and `docs/*.md` were checked by pattern, not read line by line.
- Screen readers and real phones were not used; accessibility results come from axe-core and screenshots.
