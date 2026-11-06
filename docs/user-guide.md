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
see the market rate at the exact moment of the sale (step 4).

## 2. Personal details

Fill in:
- your name;
- your ID number. It is written in the "מספר תיק" (file number) box of the form;
- *שייכות* (relationship);
- the asset location;
- the date printed on the form;
- whether the shares are under **section 102**. This is the default for every
  row, and you can change it per row.

These details are saved **only in your browser** (localStorage) for next time.
They are never uploaded.

## 3. Import and review

- **Import:** upload the file. You can also add rows by hand ("הוספת שורה
  ידנית"), or load the demo ("טעינת דוגמה").
- **Table columns:** each row shows the symbol, plan type, quantity, purchase
  date, sale date, optional sale time, proceeds $, cost $ (E*Trade *Adjusted
  Cost Basis*), fees $ and section 102.
- **Rates:** the purchase and sale rates are filled in automatically from the
  Bank of Israel. If the field shows a `*`, no rate was published that day, so
  the last earlier rate is used. To override a rate, type a value in the field.
- **Calculated columns:**
  - proceeds ₪ and cost ₪;
  - nominal gain;
  - inflationary amount;
  - real gain or loss;
  - estimated tax.
- **Missing data:** rows with missing or invalid data are highlighted, with an
  explanation under the row. They are left out of the PDF.

## 4. Rate control (בקרת שערים)

For every purchase and sale date, this section shows:
- the Bank of Israel rate (the one used on the form);
- the ECB rate and the Yahoo Finance close, with their deviation from the Bank
  of Israel rate. A date is highlighted when the deviation is unusual (ECB
  above 1%, Yahoo above 1.5%). If you see one, check the rate on the Bank of
  Israel website;
- if you entered a sale time: the market rate at that minute or hour, its
  difference from the official rate, and the effect on the proceeds in ₪.
  This is **information only** and never goes on the form.

## 5. Summary

The summary shows totals per half-year and per year:
- gains;
- losses offset against them;
- net real gain;
- estimated tax (25%).

Each half-year shows the due date for the semi-annual report and advance
payment (31.7 for January–June, 31.1 of the next year for July–December).

## 6. Download

- **PDF:**
  - one official form 1399 page per lot;
  - an appendix laid out like form 1325, with every lot plus half-year and
    year totals.
- **Excel:** three sheets: lots, summary and rate control.

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
Click "מחיקת כל העסקאות" (delete all transactions), or clear the site data in
your browser settings.

**The PDF button fails when I open `index.html` from my computer.**
Browsers block file loading from `file://`. Use the live link, or run a local
server (see [development.md](development.md)).
