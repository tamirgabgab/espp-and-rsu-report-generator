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
  payments) and per year.
- **Loss carry-forward:** a net loss of one year is carried into the next year
  in the list, and so on. A loss from January–June reduces the July–December
  advance. A loss from years that are not in the tool can be typed in the
  summary ("הפסד מועבר משנים קודמות"); it is offset against the first year in
  the list. Each card shows the carried loss, the taxable amount
  (`max(net + carry, 0)`) and the loss left to carry on. Confirm the carry with
  the accountant: it assumes no other capital gains used the loss.
- **Tax already withheld:** tax the trustee withheld on the capital gain
  (102 lots) is subtracted from the estimated tax; the card shows what is left
  to pay or the balance in your favour.
- **Not calculated:**
  - the surtax: 3% plus another 2% on capital income, above ₪721,560 a year;
  - offsetting losses against dividends or interest;
  - foreign tax credits.

## Marginal tax vs. capital-gains tax

| Part of the value | Type | Rate | How it is paid |
|---|---|---|---|
| ESPP discount = (FMV on purchase date − price paid) × qty | Employment income | marginal brackets, 10%–47% plus surtax | through payroll |
| RSU value at vest (no trustee) | Employment income | marginal | through payroll |
| 102 capital-gains track: the discount (ESPP) or the 30-trading-day average before the grant (RSU) | Employment income | marginal, plus national insurance and health | withheld by the trustee at sale |
| Change in value after the purchase / vest (or above the 102 average) | **Capital gain** | **25%** flat (30% for a substantial shareholder) | this report and the advance payments |

Because the benefit is already taxed as salary, the capital-gain cost is the
FMV on the purchase / vest date (E*Trade's Adjusted Cost Basis). Using the
price actually paid would tax the discount twice.

## Cost basis

**Regular track** (no trustee, the benefit was taxed through payroll): the
app uses E*Trade's **Adjusted Cost Basis**, the fair market value on the ESPP
purchase date or the RSU vest date.

**Section 102 with a trustee:** see the next section. The cost of the capital
part is what you paid plus the work-income part, dated at the allocation to
the trustee.

## Section 102, capital-gains track with a trustee

Applies to lots marked "סעיף 102 עם נאמן" (the default in step 4) whose plan is
ESPP or RSU. The tax on the benefit is not paid through payroll. The trustee
withholds it at the sale, and the gain is split in two:

| Symbol | Meaning |
|---|---|
| `V` | Value of the benefit. **ESPP:** the lower of the market price at the start of the offering period and on the purchase date, × qty (see below), or the "benefit value per share" from the trustee's report when it is typed in the lot. **RSU:** the average closing price of the **30 trading days before the grant date** × qty. |
| `Cp` | What you paid. ESPP: the discounted purchase price × qty (E*Trade's *Acquisition Cost*). RSU: 0. |
| `P`, `F` | Proceeds and fees in USD |
| `alloc` | The allocation to the trustee: the grant date for RSU, the purchase date for ESPP |

- **Work income** (marginal tax): `W = min(V, P − F) − Cp`, never below 0. For
  ESPP this is the discount, and for RSU the 30-day average. It is converted at
  the **sale-date** representative rate, as the trustee does when it withholds.
- **Capital gain** (25%): the rest. It is computed as a **real** gain with the
  same Circular 10/2025 rules as any other lot, with cost `C = Cp + W` at the
  **allocation-date** rate. On form 1399 the cost line shows `C` and the
  allocation date (note 12.5 of the form), and the "102" box is checked.
- **Holding period:** a sale before 24 months from the allocation leaves the
  capital-gains track. The whole gain `P − F − Cp` is then work income, there is
  no capital gain, and the lot gets no form 1399 (it appears in Excel only).
  The app treats a sale as qualifying only from the day after the 24-month
  anniversary, to be safe.
- **Sold below the average:** the work income is capped at the actual gain, so
  the capital part is 0.
- **Estimated marginal tax:** `W(₪) × (marginal rate + national insurance and
  health)`, with the rates set in step 4 (default 35% + 12% for new users;
  a saved profile keeps its own rates). This is for
  control only. Above the national-insurance ceiling the real rate is lower.
- **Trustee withholding:** two fields per lot: the tax withheld on the
  work income and the tax withheld on the capital gain. The capital part is
  subtracted from the 25% tax in the summary; the work part is compared with
  the marginal-tax estimate (the panel notes a difference above 5%).
- **Cash after tax and net profit:** the simulator, the "what if" table and
  the formulas tab use one definition (`Core.evaluateLot`):
  `cash = proceeds − fees − capital tax − work tax withheld by the trustee`
  (in the regular track the work tax was paid through payroll, so it is not
  subtracted here), and `net profit = cash − amount paid − payroll work tax`.

Open points, which are not settled by an official source:
- **Real or nominal.** Trustees usually compute the capital part nominally (all
  at the sale-date rate). Some accountants argue for a real computation. The
  app computes it as **real**, by the user's decision.
- **ESPP benefit value (owner's decision, 2026-11-20).** Per share, the lower
  of the price at the start of the offering period (`S0`) and on the purchase
  date (`S1`), so the work income is the plan discount and a rise during the
  offering period is capital gain. Sources, in order:
  - `S1`: E*Trade's purchase-date FMV (Adjusted Cost Basis / qty), else the close.
  - `S0`: E*Trade's "Grant Date FMV" (lot field `offerFmv`, read from G&L and
    from PDF imports), else the close on the offering start date.
  - No offering start date: `paid per share / (1 − discount)` when the discount
    is typed in the lot (never above `S1`), else `S1`.
  - A "benefit value per share" typed from the trustee's report overrides all.
  The panel names the rule and the source used. Not checked against a real
  trustee report yet.
- **24 months:** counted from the allocation date (the grant for RSU, the
  purchase for ESPP). Check your plan's rules.

The 30-day average comes from Yahoo Finance daily closes in `data/stocks/`
(split-adjusted, not dividend-adjusted). If the trustee's report shows a
different average, type it into the lot.

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
