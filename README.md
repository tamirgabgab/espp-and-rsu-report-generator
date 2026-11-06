# ESPP & RSU → Israeli tax form 1399

### ▶ [Open the app](https://tamirgabgab.github.io/espp-and-rsu-report-generator/)

**https://tamirgabgab.github.io/espp-and-rsu-report-generator/**

Turn your E*Trade stock-plan sales (ESPP / RSU) into a filled **Israeli Tax
Authority form 1399 (י)** ("הודעה על מכירת נכס וחישוב המס המגיע"), with a
summary appendix and an Excel workbook, ready to send to your accountant.

- Runs entirely in your browser: nothing is uploaded and there is no server.
- Your name, ID number and transactions are stored only in your own browser
  (localStorage) and never in this repository.
- Works on desktop and mobile.

---

## Contents

- [Quick start](#quick-start)
- [Getting the file from E*Trade](#getting-the-file-from-etrade)
- [What you get](#what-you-get)
- [How the tax is calculated](#how-the-tax-is-calculated)
- [Exchange-rate sources](#exchange-rate-sources)
- [Rate at the exact sale time (hour / minute)](#rate-at-the-exact-sale-time-hour--minute)
- [FAQ](#faq)
- [For developers](#for-developers)
- [Disclaimer](#disclaimer)

---

## Quick start

1. Open the [app](https://tamirgabgab.github.io/espp-and-rsu-report-generator/).
2. **Personal details:** enter your name and ID number. These are kept in your
   browser for next time.
3. **Import:** upload the E*Trade *Gains & Losses* file. You can also type rows
   by hand, or click **"טעינת דוגמה"** (load example) to try it out.
4. **Review the table:**
   - every row is one *lot*: shares bought on one date and sold on one date;
   - rates are filled in automatically;
   - rows with missing data are highlighted.
5. *(Optional)* enter the **sale time** (New York time) from E*Trade's order
   details to see the market rate at that exact minute in the rate-control
   section.
6. **Download** the PDF (one form 1399 per lot + summary) and/or the Excel file.

## Getting the file from E*Trade

1. In E*Trade go to **Stock Plan → My Account → Gains & Losses**.
2. Pick the **Tax Year**, then **Download → Download Expanded**.
3. You get `G&L_Expanded.xlsx`. Upload it as-is; CSV works too.

A sale order that used shares from several purchase dates appears as several
`Sell` rows, and the app treats each one as its own lot. The execution time is
not in this file. It is shown under *View Order Details* if you want to enter it.

## What you get

| Output | Contents |
|---|---|
| **PDF** | One page of the official form 1399 (2025 edition) per lot, filled in on top of the blank form. It is followed by an appendix laid out like form 1325: every lot, plus half-year and year totals with losses offset against gains. |
| **Excel** | Sheets for lots, summary, and rate control (all sources side by side). |
| **On screen** | Live calculation, summary per half-year with the advance-payment due date (31.7 / 31.1), rate control table, and a USD/ILS chart since 2020 with your buy/sell dates marked. |

## How the tax is calculated

The calculation follows **Income Tax Circular 10/2025** (the *Mozes* ruling).
For an Israeli individual holding a security bought in dollars, the exchange
rate acts as the "index".

- **Proceeds (₪)** = proceeds $ × Bank of Israel rate on the sale date
- **Cost (₪)** = cost $ × Bank of Israel rate on the purchase date
- **Nominal gain** = proceeds ₪ − cost ₪ − fees ₪
- **Inflationary amount** = cost ₪ × (sale rate ÷ purchase rate − 1)

| Case | Result |
|---|---|
| Gain, shekel weakened | The inflationary part is exempt (capped at the gain); the rest is real gain. |
| Gain, shekel strengthened | No inflationary amount; the whole nominal gain is real gain. |
| Loss, shekel weakened | The whole nominal loss can be offset. |
| Loss, shekel strengthened | The part of the loss caused by the exchange rate cannot be offset; only the rest is allowed. |
| Gain in $, loss in ₪ | No gain and no loss. |

- **Tax estimate:** 25% of the real gain. Losses are offset against gains of the
  same half-year / year.
- **Cost basis:** E*Trade's **Adjusted Cost Basis**, meaning the market value on
  the ESPP purchase date or the RSU vest date. This assumes the discount / RSU
  value was already taxed as salary. You can edit any row.
- **Rate date:** if no rate was published on a date (weekend or holiday), the
  last rate published before it is used. Any rate can be overridden by typing a
  value in the row.

**Worked example (the bundled demo):** 17 QCOM ESPP shares, bought 31.1.2024
(rate 3.635), sold 11.5.2026 (rate 2.909).

- Proceeds: $3,938.96 × 2.909 = ₪11,458
- Cost: $2,524.67 × 3.635 = ₪9,177
- Real gain: ₪2,281
- Tax: ₪570

## Exchange-rate sources

| Source | Used for | Data | Update |
|---|---|---|---|
| **Bank of Israel** representative rate (שער יציג, `RER_USD_ILS`) | **The form.** This is the rate the law requires. | Daily since Dec 2019 | Weekly |
| **ECB** reference rate (via Frankfurter, USD→ILS cross) | Cross-check | Daily since Dec 2019 | Weekly |
| **Yahoo Finance** `ILS=X` daily close | Cross-check | Daily since Dec 2019 | Weekly |
| **Yahoo Finance** `ILS=X` 1-minute and 1-hour bars | Rate at the exact sale time (information only) | Minutes: archive growing weekly. Hours: about 2 years back. | Weekly |

The rate-control section in the app shows all sources for each purchase and
sale date and **flags a date in yellow** when a source deviates unusually from
the Bank of Israel rate:

- **ECB:** flagged above 1%. Historically the median deviation is 0.08% and the
  maximum 0.99%.
- **Yahoo:** flagged above 1.5%. Historically the median deviation is 0.22%.

The browser cannot call these APIs directly because of CORS, so the rates are
stored in [`data/`](data) and refreshed every Saturday night by the
[`Update USD/ILS rates (weekly)`](.github/workflows/update-rates.yml) GitHub
Action. To refresh immediately: **Actions → Update USD/ILS rates (weekly) → Run
workflow**.

## Rate at the exact sale time (hour / minute)

The tax form must use the **daily** Bank of Israel representative rate,
published once a day at around 15:30 Israel time. A rate by hour or minute is
**not accepted on the form**. The app shows it only so you can see how far the
real market rate at the moment of your sale was from the official one, and what
that means in shekels.

How it works:

- Yahoo Finance serves **1-minute** USD/ILS bars for only the last 30 days and
  **1-hour** bars for about 2 years.
- The weekly Action saves the 1-minute bars into
  `data/intraday/minute/YYYY-MM.json`, so a **permanent minute-level archive**
  builds up from October 2026 onward. Hourly bars are kept in
  `data/intraday/hourly/YYYY.json`.
- For a sale with a time, the app:
  1. converts New York time to UTC, including daylight saving;
  2. looks up the minute archive, falling back to hourly bars;
  3. shows the rate, its precision (minute / hour), the difference from the
     representative rate and the effect on proceeds in ₪.
- For sales before the minute archive started and more than ~2 years ago, there
  is no intraday data. For minute data that far back you would need a paid data
  provider (for example Twelve Data or Polygon) with an API key.

## FAQ

**Is a form 1399 required for every sale?**
For traded securities sold through a foreign broker without Israeli
withholding, the law requires a **semi-annual report with an advance payment**
(by 31.7 and 31.1). The annual return reports these sales on forms 1325/1322.
The app produces 1399 forms per lot because the accountant asked for them, and
the appendix gives the 1325-style breakdown and half-year totals. Check with
your accountant what they need.

**Section 102 / trustee plans?**
The "102" box is ticked by default (configurable in personal details and per
row). If the trustee already withheld the tax, the sale may not need a 1399 at
all. Ask your accountant.

**Is my data safe?**
Nothing leaves your browser. To clear it, use "מחיקת כל העסקאות" or clear the
site data in the browser.

**The PDF button fails when I open `index.html` from my computer.**
Browsers block file loading from `file://`. Use the live link, or run a local
server (see below).

## For developers

```
index.html                 the app (RTL Hebrew UI)
css/style.css              styles (light + dark)
js/core.js                 pure logic: dates, rate lookup, tax calc, cross-check, intraday, E*Trade parser
js/pdf1399.js              fills the official PDF form (pdf-lib) + summary pages
js/chart.js                SVG rate chart
js/app.js                  UI glue
data/usd_ils_rates.*       Bank of Israel daily rates (.json + .js for file://)
data/usd_ils_ecb.json      ECB daily rates
data/usd_ils_yahoo.json    Yahoo daily close
data/usd_ils_secondary.js  ECB + Yahoo bundled for the browser
data/intraday/             Yahoo 1-minute (by month) and 1-hour (by year) bars + index.json
assets/                    blank form 1399 (2025) + Hebrew font (OFL)
vendor/                    pdf-lib, fontkit, SheetJS (pinned)
scripts/update_rates.py    downloads all rate sources
tests/core.test.js         unit tests (Circular 10/2025 examples, parser, dates, intraday)
tests/render_sample.js     renders out/sample.pdf (+ PNGs) to check field positions
.github/workflows/         weekly rate update + tests on push
```

Run locally:

```bash
python3 -m http.server 8000
```

Run the tests (Node 18+):

```bash
npm test
```

Render a sample PDF:

```bash
node tests/render_sample.js
```

Refresh rates (needs network access to the sources):

```bash
python3 scripts/update_rates.py
```

The site is served by GitHub Pages from the `main` branch root
(Settings → Pages → Deploy from a branch → `main` / root). See
[`HANDOFF.md`](HANDOFF.md) for project status and next steps.

## Disclaimer

This is a personal helper, not tax advice. Always have the output checked by
your accountant.
