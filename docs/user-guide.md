# User guide

App: **https://tamirgabgab.github.io/espp-and-rsu-report-generator/**

## 1. Export your sales from E*Trade

1. In E*Trade go to **Stock Plan → My Account → Gains & Losses**.
2. Pick the **Tax Year**.
3. Click **Download → Download Expanded**. You get `G&L_Expanded.xlsx`.
4. Upload this file to the app as-is. CSV exports work too.

Each `Sell` row in the file is one **lot**: a quantity bought on one date and
sold on one date. A single sale order that used shares from several purchase
dates appears as several rows, and each becomes its own form.

The execution **time** of a sale is not in this file. It is shown in E*Trade
under *View Order Details*, in New York time. You only need it if you want to
see the market rate at the exact moment of the sale (see step 3).

## 2. Import

- **Upload:** drag the file anywhere onto the page, or click the upload area to
  pick it.
- **Other options:** add a lot by hand with "הוספת עסקה ידנית", or try the demo
  with "טעינת דוגמה".
- **Headline numbers:** once there is at least one complete lot, these appear
  at the top:
  - the **real gain** after loss offset;
  - the **estimated tax**;
  - the **next advance payment** with its due date;
  - the number of lots.

  A bar with the gain, the tax and a download button stays pinned to the bottom
  of the screen.

## 3. Review the lots

Each lot is shown as a table row on a computer and as a card on a phone. Each
one has a status badge:
- **✓ תקין:** the calculation is complete and all rate sources agree;
- **⚠ חסר:** data is missing. Open it to see what;
- **⚠ שער:** ECB or Yahoo deviates unusually from the Bank of Israel rate
  (above 1% / 1.5%). Check the rate on the Bank of Israel website.

**"איך חושב?"** (how was it calculated?) opens a panel with:
- every step of the calculation. Each step shows the general formula and your
  numbers substituted into it, with the rate date used;
- which case of Circular 10/2025 applies (for example "gain, shekel
  strengthened");
- a rate cross-check table: Bank of Israel, ECB and Yahoo for the purchase and
  sale dates;
- the market rate at the sale minute, if you entered a sale time. This is
  information only and never goes on the form.

The **pencil** opens the edit drawer:
- missing or invalid fields show an error right under the field;
- **"הדבקה מ‑Order Details":** paste the execution line from E*Trade (for
  example `Executed 05/11/2026 10:35:12 AM ET`), and the sale date and time are
  filled in automatically;
- **"שערים ידניים (מתקדם)"** (manual rates, advanced): override the rates only
  if you have a reason to.

The **bin** deletes a lot. A message with **"ביטול"** (undo) lets you restore
it for a few seconds. "מחיקת הכל" (delete all) works the same way.

When the lots span more than one tax year, **year chips** ("כל השנים" for all
years, 2025, 2026, …) filter what you see:
- the list;
- the headline numbers;
- the summary;
- the chart;
- the downloads.

## 4. Summary and explanation

The summary cards show totals per half-year and per year:
- gains;
- losses offset against them;
- net real gain;
- estimated tax (25%).

Each half-year also shows the due date of its advance payment (31.7 / 31.1).

**"איך מחושב המס?"** (how is the tax calculated?) explains the general method,
with formulas, using your first lot as a worked example:
- the parameters;
- the conversion to shekels;
- the inflationary amount;
- the one-line rule for the real gain;
- capital-gains tax and loss offset;
- how capital-gains tax differs from the marginal tax on the employee benefit.

See [tax-calculation.md](tax-calculation.md) for the full rules.

## 5. Details and download

Fill in:
- your name;
- your ID number. The check digit is validated, and the number is written in
  the "מספר תיק" (file number) box;
- *שייכות* (relationship);
- the asset location;
- the date on the form;
- the default for section 102.

All of this is saved only in your browser.

Then:
- **תצוגה מקדימה** (preview) shows the exact PDF inside the page before you
  download it;
- **הורדת PDF** (download PDF) gives one official form 1399 page per lot, plus
  an appendix laid out like form 1325;
- **הורדת Excel** (download Excel) gives three sheets: lots, summary and rate
  control.

The chart shows the USD/ILS representative rate since 2020, with your purchase
dates (green) and sale dates (orange) marked.

## FAQ

**Is a form 1399 required for every sale?**
For traded securities sold through a foreign broker without Israeli
withholding, the law requires a semi-annual report with an advance payment.
The annual return then reports these sales on forms 1325/1322. The 1399 forms
here follow what the accountant asked for. See
[tax-calculation.md](tax-calculation.md#reporting-obligations).

**My plan is section 102 with a trustee. Do I need this?**
If the trustee already withheld the tax, the sale may not need a 1399 at all.
Ask your accountant.

**Why is the rate different from the one I used by hand?**
The app uses the Bank of Israel representative rate of the exact date. Check
the rate-control section: if ECB and Yahoo agree with the Bank of Israel rate,
the manual rate was probably taken from a different date.

**How do I delete my data?**
Click "מחיקת הכל" (delete all), or clear the site data in your browser
settings.

**The PDF button fails when I open `index.html` from my computer.**
Browsers block file loading from `file://`. Use the live link, or run a local
server (see [development.md](development.md)).
