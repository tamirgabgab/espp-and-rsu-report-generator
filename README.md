# ESPP & RSU → Israeli tax form 1399

### ▶ [Open the app](https://tamirgabgab.github.io/espp-and-rsu-report-generator/)

**https://tamirgabgab.github.io/espp-and-rsu-report-generator/**

Turn your E*Trade stock-plan sales (ESPP / RSU) into a filled **Israeli Tax
Authority form 1399 (י)** ("הודעה על מכירת נכס וחישוב המס המגיע"). You also get
a summary appendix and an Excel workbook, ready to send to your accountant.

- **One form per lot.** Each lot is a set of shares bought on one date and sold
  on one date. Multiple sales and multiple purchase dates are handled
  automatically.
- **Official rates.** Amounts are converted with the official Bank of Israel
  representative rate (שער יציג). Two independent sources (ECB, Yahoo Finance)
  cross-check it.
- **Real-gain calculation** per Income Tax Circular 10/2025, with losses offset
  per half-year and per year.
- **Step-by-step explanation.** Every lot shows the general formula with your
  own numbers substituted in. A built-in explainer also covers capital-gains tax
  vs. marginal (salary) tax.
- **Optional rate at the exact sale time** (minute / hour), for your
  information only.
- **Private.** Everything runs in your browser and nothing is uploaded. Your
  ID number is never saved, not even in the browser.

## Quick start

1. Open the [app](https://tamirgabgab.github.io/espp-and-rsu-report-generator/).
2. **Import.** Drag E*Trade's **Gains & Losses → Download Expanded** file onto
   the page. You can also click **"טעינת דוגמה"** (load example) to try it out.
3. **Check the headline numbers.** Real gain, estimated tax and the next
   advance payment appear at the top right away.
4. **Review each lot.** Open **"איך חושב?"** (how was it calculated?) to see
   the formula with your numbers and the rate cross-check. Fix anything marked
   ⚠ with the edit button.
5. **Download.** Enter your name and ID number, preview the PDF, then download
   it (forms + summary) and/or the Excel file.

The step-by-step guide is in [docs/user-guide.md](docs/user-guide.md).

## Documentation

| Document | What's inside |
|---|---|
| [User guide](docs/user-guide.md) | Exporting from E*Trade, using the app, outputs, FAQ |
| [Tax calculation](docs/tax-calculation.md) | Rules, every gain/loss case, worked example, reporting obligations |
| [Exchange rates](docs/exchange-rates.md) | The four rate sources, cross-check, minute/hour rates, weekly update |
| [Development](docs/development.md) | Code structure, tests, PDF field calibration, new tax-year form, deploy |
| [Handoff](docs/HANDOFF.md) | Project status, decisions taken and next steps |

## Repository layout

| Path | Contents |
|---|---|
| `index.html` | The app's single page. It stays at the root because GitHub Pages serves from there. |
| `src/js/` | App code: `core.js` (calculation logic), `pdf1399.js` (PDF form filling), `chart.js`, `app.js` (UI) |
| `src/css/` | Styles (light and dark) |
| `assets/forms/` | Official blank form 1399 (י), 2025 edition |
| `assets/fonts/` | Hebrew font embedded in the PDF, with its license |
| `data/rates/daily/` | Daily USD/ILS rates: Bank of Israel, ECB and Yahoo (`.json`, plus `.js` for the browser) |
| `data/rates/intraday/` | Yahoo 1-minute (by month) and 1-hour (by year) rates |
| `vendor/` | Third-party libraries (pdf-lib, fontkit, SheetJS, pdf.js for the preview) and their licenses |
| `tools/` | `update_rates.py`, which downloads all rate sources |
| `tests/` | Unit tests and a sample PDF renderer |
| `docs/` | Documentation |
| `.github/workflows/` | Weekly rate update and tests on every push |

## For developers

Serve the site locally:

```bash
python3 -m http.server 8000
```

Run the unit tests (Node 18+):

```bash
npm test
```

Render a sample PDF to `out/`:

```bash
npm run sample
```

Download the latest exchange rates:

```bash
npm run rates
```

More in [docs/development.md](docs/development.md).

## Disclaimer

This is a personal helper, not tax advice. Always have the output checked by
your accountant.
