# ESPP & RSU report generator (Israeli form 1399)

A small static web app that turns E*Trade stock-plan sales (ESPP / RSU) into a
filled **Israeli Tax Authority form 1399 (י)** — "הודעה על מכירת נכס וחישוב המס
המגיע" — plus a summary appendix, ready to send to your accountant.

**Live app:** https://tamirgabgab.github.io/espp-and-rsu-report-generator/
(available once GitHub Pages is enabled, see [Deploy](#deploy)).

Everything runs in the browser. No data is uploaded anywhere; personal details
(name, ID number) and transactions are kept only in the browser's localStorage.

## What it does

1. **Import** the E*Trade *Gains & Losses* export (`G&L_Expanded.xlsx` or CSV),
   or type transactions by hand. Every `Sell` row is one **lot** (a quantity
   bought on one date and sold on one date). A single sale order that consumed
   shares from several purchase dates becomes several lots.
2. **Convert to ILS** with the official Bank of Israel representative rate
   (שער יציג) on the purchase date and on the sale date. When no rate was
   published that day (weekend / holiday) the last rate published before it is
   used. Any rate can be overridden manually.
3. **Compute the real capital gain** according to Income Tax Circular 10/2025
   (the *Mozes* ruling), where the exchange rate acts as the index:
   - nominal gain = proceeds × sale rate − cost × purchase rate − fees
   - inflationary amount = ILS cost × (sale rate / purchase rate − 1)
   - gain: the inflationary amount (when positive, capped at the gain) is exempt;
     when the shekel strengthened there is no inflationary amount and the whole
     nominal gain is real.
   - loss: allowed in full when the shekel weakened; when the shekel
     strengthened, the part of the loss caused by the exchange rate is not
     deductible. A USD gain that is an ILS loss is neither gain nor loss.
   - tax estimate: 25% of the real gain.
4. **Summarise** per half-year (for the semi-annual report and advance payment
   due 31.7 / 31.1) and per year, offsetting losses against gains.
5. **Download**
   - a PDF with one filled form 1399 page per lot, drawn on top of the official
     blank form, followed by a summary appendix laid out like form 1325;
   - an Excel workbook with the full calculation.

The USD/ILS chart shows the representative rate since 2020 with the purchase
and sale dates of your lots.

### Cost basis

The cost is E*Trade's **Adjusted Cost Basis**: the fair market value on the
ESPP purchase date / RSU vest date. This assumes the ESPP discount / RSU value
was already taxed as employment income through payroll. Change the per-row
cost if your situation differs.

## Project layout

```
index.html                 the app (RTL Hebrew UI)
css/style.css              styles (light + dark)
js/core.js                 pure logic: dates, rates lookup, tax calc, E*Trade parser
js/pdf1399.js              fills the official PDF form (pdf-lib) + summary pages
js/chart.js                SVG rate chart
js/app.js                  UI glue
data/usd_ils_rates.json    BOI representative rates since Dec 2019 (+ .js twin)
assets/form-1399y-2025-blank.pdf   official blank form 1399 (י) for tax year 2025
assets/NotoSansHebrew_400Regular.ttf  font embedded in the PDF (OFL)
vendor/                    pdf-lib, fontkit, SheetJS (pinned, MIT/Apache)
scripts/update_rates.py    refreshes data/usd_ils_rates.*
tests/core.test.js         unit tests (Circular 10/2025 examples, parser, dates)
tests/render_sample.js     renders out/sample.pdf (+ PNGs) to check field positions
.github/workflows/         daily rate refresh + tests
```

## Running locally

The PDF step loads the blank form and font with `fetch`, so serve the folder
instead of opening `index.html` from disk:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Tests (Node 18+):

```bash
npm test
```

Refresh the exchange rates (needs access to `edge.boi.gov.il`):

```bash
python3 scripts/update_rates.py
```

## Deploy

GitHub Pages, no build step:
Settings → Pages → *Build and deployment* → Source: **Deploy from a branch**,
branch **main**, folder **/ (root)**.

The `Update USD/ILS rates` workflow commits fresh rates to `main` every
weekday, so the live site stays current.

## Disclaimer

This is a personal helper, not tax advice. Check the output with your
accountant. For sales through a foreign broker without Israeli withholding, the
law requires a semi-annual report with an advance payment, and the annual
return reports them on forms 1325/1322. The 1399 forms produced here follow the
format the accountant asked for.
