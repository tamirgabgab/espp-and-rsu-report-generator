# User guide

App: **https://tamirgabgab.github.io/espp-and-rsu-report-generator/**

**Colour theme:** the switch at the top of the page offers:
- **אוטומטי** (auto): follows your phone or computer setting;
- **בהיר** (light);
- **כהה** (dark).

The choice is remembered in this browser.

## 1. Export your sales from E*Trade

1. In E*Trade go to **Stock Plan → My Account → Gains & Losses**.
2. Pick the **Tax Year**.
3. Click **Download → Download Expanded**. You get `G&L_Expanded.xlsx`.
4. Upload this file to the app as-is. CSV exports work too.

**PDF or screenshot instead of Excel.** You can also upload a PDF or an image
(PNG/JPEG) of the Gains & Losses page, for example a screenshot with the sale
row expanded. The app reads the text in your browser (OCR for images and
scanned PDFs; nothing is uploaded), then shows a review window with every
field it found. Check them against the document, fix anything that is wrong,
and click "הוספת העסקה". Two cross-checks warn you when a value looks
misread:
- the cost per share should match the market price on the purchase or vest
  date;
- the ESPP purchase price should be 50%–100% of that market price.

A document that is not a Gains & Losses page, such as a trade confirmation,
can prefill a new lot with the sale date, quantity, proceeds and fees it
finds.

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

**"הצגת החישוב"** (show the calculation) opens a panel with:
- every step of the calculation. Each step shows the general formula and your
  numbers substituted into it, with the rate date used;
- which case of Circular 10/2025 applies (for example "gain, shekel
  strengthened");
- a rate cross-check table: Bank of Israel, ECB and Yahoo for the purchase and
  sale dates;
- the market rate at the sale minute, if you entered a sale time. This is
  information only and never goes on the form.

The **pencil** opens the edit drawer. Required fields are marked with *, and
optional ones say (לא חובה):
- missing or invalid fields show an error right under the field;
- **"הדבקה מ‑Order Details":** paste the execution line from E*Trade (for
  example `Executed 05/11/2026 10:35:12 AM ET`), and the sale date and time are
  filled in automatically;
- **"שערים ידניים (מתקדם)"** (manual rates, advanced): override the rates only
  if you have a reason to;
- **drafts:** if you close the drawer without saving, what you typed is kept as
  a draft. The next time you open the same lot, you can choose "המשך מהטיוטה"
  (continue from the draft) or "מחיקת הטיוטה" (discard the draft). The draft
  never contains your ID number.

The **bin** deletes a lot right away. A message with **"ביטול"** (undo) lets
you restore it for a few seconds. "מחיקת הכל" (delete all) first asks for
confirmation, naming how many lots will go. The cancel button has the focus, so
Enter or Esc keeps the lots. After deleting, undo is offered as well.

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
- the default for section 102 with a trustee (see section 9);
- the estimated marginal tax rate for the work-income part of 102 lots
  (default 47%, plus 12% national insurance and health; untick it if your
  salary is above the national-insurance ceiling).

Everything except the ID number is saved only in your browser. The ID number
is never saved: type it again each time you download a form.

Then:
- **תצוגה מקדימה** (preview) shows the exact PDF inside the page before you
  download it;
- **הורדת PDF** (download PDF) gives one official form 1399 page per lot, plus
  an appendix laid out like form 1325;
- **הורדת Excel** (download Excel) gives three sheets: lots, summary and rate
  control.

The chart shows the USD/ILS representative rate since 2020, with your purchase
dates (green) and sale dates (orange) marked.

## 6. Package for the accountant

**"הורדת חבילה לרואה החשבון"** (download the package for the accountant)
creates one ZIP file with:
- `form-1399-<year>.pdf`: the forms and the summary appendix;
- `capital-gains-<year>.xlsx`: the full calculation;
- the original E*Trade file, if you uploaded it in this session (the file is
  kept only in memory and is never saved);
- `explanation.txt`: a short Hebrew explanation of the totals, each lot, the
  rate source, the calculation method and the assumptions;
- `backup.json`: a backup that can be loaded back into the app.

## 7. Backup and restore

- **"שמירת גיבוי"** (save backup) downloads a `.json` file with your lots, your
  simulator holdings and your details. The ID number is **never** included.
- **"טעינת גיבוי"** (load backup) reads such a file, for example on another
  computer or phone:
  - if the list is empty, the lots are loaded right away;
  - if the list already has lots, you choose between **"החלפת הרשימה"**
    (replace the list) and **"הוספה לרשימה"** (add to the list). When adding,
    exact duplicates are skipped.

  Either way, an undo button appears for a few seconds.

## 8. Install as an app

The app can be added to your home screen with its own icon. It still needs an
internet connection to work.

- **Android (Chrome):** use the "התקנה כאפליקציה" (install as an app) button at
  the bottom of the page when it appears, or menu ⋮ → "הוספה למסך הבית" (add to
  home screen).
- **iPhone (Safari):** tap Share, then "הוסף למסך הבית" (add to home screen).

## 9. RSU and section 102 with a trustee

Mark a lot "סעיף 102 עם נאמן" (or keep the default from step 4 in the app, "פרטים לטופס"). For ESPP and
RSU lots the app then splits the gain:
- **work income**, taxed at your marginal rate and withheld by the trustee:
  - ESPP: the discount, (market price on the purchase date − price paid) × qty.
    Fill in "סכום ששילמת" (the *Acquisition Cost* column in E*Trade). It is
    read from the G&L file when the column is there;
  - RSU: the average closing price of the 30 trading days before the **grant
    date** × qty. Fill in the grant date. The average is computed
    automatically for QCOM, or you can type the one from the trustee's report;
- **capital gain**, the rest, at 25%. It is computed as a real gain like any
  other lot and goes on form 1399, with the allocation date and the "102" box.

A sale **before 24 months** from the allocation (the grant for RSU, the
purchase for ESPP) leaves the track: the whole gain is work income, and there
is no form 1399 for it. It is marked "מס שולי" and appears in Excel.

Optionally type the tax the trustee withheld ("מס שהנאמן ניכה"). The "הצגת
החישוב" panel compares it with the estimate.

The full rules and open points are in
[tax-calculation.md](tax-calculation.md#section-102-capital-gains-track-with-a-trustee).

## 10. Sale simulator

The **"סימולטור מכירה"** (sale simulator) tab at the top estimates the tax on
shares you have not sold yet.

1. **Add your holdings:** "הוספת מנה ידנית" (add manually) for each ESPP
   purchase or RSU grant, or import E*Trade's *Holdings → By Benefit Type →
   Download Expanded* file. The import was built without a real sample file,
   so check every row. "טעינת דוגמה" loads an example.
2. **Set the assumptions:** the sale date, the USD rate (default: the latest
   representative rate), the share price (default: the latest close) and the
   marginal tax rate.
3. **Read the result:** for each holding you see the proceeds, the work income
   and its estimated tax (102), the real capital gain and its tax, and the net
   amount. You can sell part of a holding by changing "כמות למכירה" (quantity
   to sell).

- **Totals:** the capital-gains tax is offset against the sales of the same
  year that are already in the report.
- **Waiting:** for a 102 holding still inside its 24 months, the simulator also
  shows the result of selling on the first day after the period, at the same
  price and rate, and how much that would save.

Everything is an estimate: the future price and rate are unknown, and surtax
is not computed.

## 11. Formulas

The **"נוסחאות"** (formulas) tab is a live calculator for one sale:
- **Pick the case:** ESPP or RSU, on the section 102 trustee track or without
  a trustee.
- **Type the numbers:** quantity, dates, prices and what you paid. The
  representative rates and, for QCOM, the share prices fill in automatically.
  "מילוי מעסקה שלי" copies a lot from the report.
- **Read the result:** every step shows the general formula and then your
  numbers:
  - the work income and its marginal tax. On the trustee track the trustee
    withholds it at the sale; without a trustee it was withheld from your
    salary on the purchase or vest date (estimated here);
  - the capital gain, converted to shekels, with the inflationary amount and
    the real gain;
  - a stacked bar showing where the money from the sale goes: what you paid,
    fees, marginal tax, capital-gains tax and what is left.
- **All four cases:** a section at the bottom lists the formulas for each case
  side by side.

Open it directly with the `#formulas` link.

## FAQ

**Is a form 1399 required for every sale?**
For traded securities sold through a foreign broker without Israeli
withholding, the law requires a semi-annual report with an advance payment.
The annual return then reports these sales on forms 1325/1322. The 1399 forms
here follow what the accountant asked for. See
[tax-calculation.md](tax-calculation.md#reporting-obligations).

**My plan is section 102 with a trustee. Do I need this?**
The trustee withholds the tax at the sale, so the sale may not need a 1399 at
all. The app still prepares one for the capital part (as the accountant asked),
and helps you check the trustee's numbers. See section 9.

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
