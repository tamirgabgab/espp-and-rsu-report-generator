# Tax calculation

The calculation is in `src/js/core.js` (`computeLot`, `summarize`) and is
covered by `tests/core.test.js`.

## Legal basis

- **Income Tax Ordinance**, sections 88 (definitions, "inflationary amount")
  and 91 (tax rates).
- **Income Tax Circular 10/2025** (offsetting capital losses), which applies
  the Supreme Court's **Mozes ruling** (ע"א 3555/15). For an individual holding
  a security bought in foreign currency, the **exchange rate acts as the
  index**. Examples 1–4 in the circular are reproduced as unit tests.
  [Circular PDF](https://www.gov.il/BlobFolder/policy/professional-directives-271125-1/he/IncomeTax_professional-directives-271125-1.pdf)

## Formulas (per lot)

| Item | Formula |
|---|---|
| Proceeds ₪ | proceeds $ × BOI rate on the sale date |
| Cost ₪ | cost $ × BOI rate on the purchase date |
| Fees ₪ | fees $ × BOI rate on the sale date |
| Nominal gain | proceeds ₪ − cost ₪ − fees ₪ |
| Inflationary amount (raw) | cost ₪ × (sale rate ÷ purchase rate − 1) |

ILS amounts are rounded to whole shekels, as on the paper form.

## The whole rule in one line

Let:
- **A** = (P$ − C$ − F$) × R<sub>s</sub>: the dollar result, converted at the
  sale rate;
- **B** = P$×R<sub>s</sub> − C$×R<sub>b</sub> − F$×R<sub>s</sub>: the nominal
  ILS result.

Then:

**real = min(A, B)** if both are gains · **max(A, B)** if both are losses ·
**0** if their signs differ.

In other words, take the result that is smaller in absolute value. This is
algebraically the same as the step-by-step rules below:
- when the shekel weakened, B − inflationary = A;
- when it strengthened, the inflationary amount is ignored and B is used.

`Core.closedFormReal` implements it, and a unit test checks that it agrees with
`computeLot` on 2,000 random lots. The app uses it in the "how was it
calculated?" panel.

## Cases

| Case | Inflationary amount | Real gain / loss |
|---|---|---|
| Gain, shekel weakened (circular example 1) | raw amount, capped at the nominal gain | nominal − inflationary |
| Gain entirely from the exchange rate (example 2, second variant) | = nominal gain | 0 |
| Gain, shekel strengthened (example 3) | 0 | the whole nominal gain |
| Loss, shekel weakened (example 2) | 0 | the whole nominal loss is allowed for offset |
| Loss, shekel strengthened (example 4) | negative: the part caused by the exchange rate | nominal − raw amount. Only this smaller loss can be offset. |
| Gain in $, loss in ₪ | = nominal loss | 0 (no gain, no loss) |

## Tax and loss offset

- **Rate:** 25% of the real gain. This applies to an individual who is not a
  substantial shareholder, for gains accrued after 1.1.2012.
- **Loss offset:** losses (negative real results) are offset against gains of
  the same period. The app shows totals per half-year (for the advance
  payments) and per year. A net yearly loss is shown as a loss to carry forward.
- **Not calculated:**
  - the surtax: 3% plus another 2% on capital income, above ₪721,560 a year;
  - offsetting losses against dividends or interest;
  - foreign tax credits.

## Marginal tax vs. capital-gains tax

| Part of the value | Type | Rate | How it is paid |
|---|---|---|---|
| ESPP discount = (FMV on purchase date − price paid) × qty | Employment income | marginal brackets, 10%–47% plus surtax | through payroll |
| RSU value at vest (no trustee) | Employment income | marginal | through payroll |
| 102 capital-gains track: value up to the 30-trading-day average before the grant | Employment income | marginal | withheld by the trustee at sale |
| Change in value after the purchase / vest (or above the 102 average) | **Capital gain** | **25%** flat (30% for a substantial shareholder) | this report and the advance payments |

Because the benefit is already taxed as salary, the capital-gain cost is the
FMV on the purchase / vest date (E*Trade's Adjusted Cost Basis). Using the
price actually paid would tax the discount twice.

## Cost basis

The app uses E*Trade's **Adjusted Cost Basis**: the fair market value on the
ESPP purchase date or the RSU vest date. This is correct when the ESPP discount
or the RSU value was already taxed as employment income through payroll. For
other arrangements (for example the 102 capital-gains track, where the work
income is based on the 30-day average before the grant), edit the cost per row
after checking with your accountant.

## Rates

- **The form** always uses the **Bank of Israel representative rate** (שער
  יציג) of the exact date.
- **Weekends and holidays:** if no rate was published that day, the last rate
  published before it is used.
- **Dates past the bundled data:** a date after the last rate in the data
  needs a manual rate.
- **Other sources:** ECB, Yahoo and the minute/hour rates are only for
  control. See [exchange-rates.md](exchange-rates.md).

## Reporting obligations

- **Foreign broker, no Israeli withholding** (E*Trade). Traded securities sold
  this way are reported in a **semi-annual report with an advance payment**:
  - by **31 July** for January–June;
  - by **31 January** of the next year for July–December.

  The annual return (1301) reports each sale on **form 1325** (Appendix C(1)),
  summarised on **form 1322**.
- **Form 1399** is the general 30-day notice of an asset sale. It is produced
  here, one per lot, because that is the format the accountant asked for. The
  appendix provides the 1325-style breakdown.
- **Section 102 with a trustee:** when the trustee withholds the tax at sale,
  the separate reporting duty may not apply.

## Worked example (the bundled demo)

**The sale:** 17 QCOM ESPP shares, bought 31.1.2024, sold 11.5.2026.

- **Proceeds:** $3,938.96 at the sale rate 2.909 = **₪11,458**.
- **Cost:** $2,524.67 (adjusted basis) at the purchase rate 3.635 = **₪9,177**.
- **Gain:**
  - the shekel strengthened (3.635 → 2.909), so the inflationary amount is 0;
  - real gain = **₪2,281**;
  - tax at 25% = **₪570**.

**Comparison with the original hand-filled form:**

| Item | Hand-filled form | Correct value |
|---|---|---|
| Purchase rate | 3.647 (the rate of 3.1.2024 / 31.12.2024) | 3.635 (31.1.2024) |
| Proceeds | ₪11,455 | ₪11,458 |
| Gain | ₪2,247 | ₪2,281 |
