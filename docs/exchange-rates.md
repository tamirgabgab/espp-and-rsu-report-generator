# Exchange rates

## Sources

| Source | Role | File(s) | History |
|---|---|---|---|
| **Bank of Israel** representative rate (שער יציג), series `RER_USD_ILS` | **Used on the form** | `data/rates/daily/boi.json`, `boi.js` | daily since Dec 2019 |
| **ECB** reference rate via [Frankfurter](https://frankfurter.dev) (USD→ILS cross) | Cross-check | `data/rates/daily/ecb.json` | daily since Dec 2019 |
| **Yahoo Finance** `ILS=X` daily close (London end of day) | Cross-check | `data/rates/daily/yahoo.json` | daily since Dec 2019 |
| **Yahoo Finance** `ILS=X` 1-minute bars | Rate at the sale time (information only) | `data/rates/intraday/minute/YYYY-MM.json` | archive from Oct 2026, grows weekly |
| **Yahoo Finance** `ILS=X` 1-hour bars | Rate at the sale time when no minute data exists | `data/rates/intraday/hourly/YYYY.json` | from Nov 2024 |

- **Employer stock prices** (not an exchange rate, but refreshed by the same
  script): Yahoo Finance daily closes in USD, split-adjusted, since 2018, for
  the tickers in `data/stocks/tickers.json` (currently `["QCOM"]`). They are
  written to `data/stocks/<TICKER>.json` (same format as the daily rate files)
  and bundled for the browser in `data/stocks/prices.js`. Each file also has
  `high` and `low` maps (the day's range, used by the "what if" chart)
  (`window.STOCK_PRICES`). They are used for the 30-trading-day average before
  an RSU grant (section 102) and for the current price in the simulator. To
  add a ticker, add it to `tickers.json` and run
  `python3 tools/update_rates.py --sources stocks`.
- **Browser bundles:** `data/rates/daily/secondary.js` bundles the ECB and
  Yahoo daily rates for the browser. The `.js` twins let the page work even
  when opened from `file://`.
- **Intraday index:** `data/rates/intraday/index.json` lists the available
  minute and hourly files.

## Why the rates are stored in the repo

The Bank of Israel API rejects requests from other websites (CORS). It returns
404 when a browser on another origin calls it. The other sources do the same or
are rate-limited. So `tools/update_rates.py` downloads all sources, and the app
reads the files.

## Weekly update

The [`Update USD/ILS rates (weekly)`](../.github/workflows/update-rates.yml)
GitHub Action runs every **Saturday at 19:41 UTC** (Saturday night in Israel):

1. Runs `python3 tools/update_rates.py`.
2. Commits any changed files under `data/` to `main`. GitHub Pages then
   redeploys the site automatically.

If one source fails, the others still update. The run is marked failed only
when the Bank of Israel download fails, because that is the rate the form
depends on.

To update immediately: **GitHub → Actions → Update USD/ILS rates (weekly) →
Run workflow**.

Locally, all sources (needs network access to them):

```bash
python3 tools/update_rates.py
```

Locally, selected sources only:

```bash
python3 tools/update_rates.py --sources boi,ecb
```

## Cross-check thresholds

Measured deviation from the Bank of Israel rate, 2020–2026:

| Source | Median | 99th percentile | Max | App warns above |
|---|---|---|---|---|
| ECB | 0.08% | 0.69% | 0.99% | **1.0%** |
| Yahoo daily close | 0.22% | 1.37% | 3.37% | **1.5%** |

The differences are expected: each source fixes its rate at a different time
of day. The Bank of Israel rate is set around 15:30 Israel time, and ECB around
16:00 CET. A warning above these thresholds usually means a data problem or a
wrong date. The thresholds are `CHECK_THRESHOLDS` in `src/js/core.js`.

## Rate at the exact sale time (minute / hour)

> The tax form must use the **daily** representative rate. A minute or hour
> rate is shown only so you can see how far the market was from the official
> rate at the moment you sold.

- **Yahoo's limits.** Yahoo serves **1-minute** bars for only the **last 30
  days** (at most 7 days per request) and **1-hour** bars for about 2 years.
  The weekly run fetches the last 29 days of minute bars and merges them into
  the monthly files. This builds a permanent minute archive, and overlapping
  runs are harmless. Missing up to three weekly runs in a row loses no data.
- **How a lot's sale time is looked up:**
  1. The time you enter (New York time, as shown in E*Trade) is converted to
     UTC, including daylight saving (`Core.nyToUtcEpoch`).
  2. Yahoo bars are stamped with their **start** time but hold the **close**
     price. The app uses the bar whose close time is nearest to the sale
     moment (`Core.intradayAt`). Minute data is tried first, then hourly data.
  3. The app shows the rate, its precision, the time it is valid for (UTC), the
     difference from the representative rate, and the effect on proceeds in ₪.
- **Older sales:** for minute data from before the archive started, a paid
  provider with an API key would be needed, for example Twelve Data or
  Polygon. The key would be stored as a GitHub Actions secret.

## File formats

**Daily files:**

```json
{"source": "...", "series": "...", "first": "2019-12-02", "last": "2026-11-06", "count": 1700,
 "rates": {"2019-12-02": 3.474, "...": 0}}
```

**Intraday files** (compact):

```json
{"symbol": "ILS=X", "source": "Yahoo Finance", "tz": "UTC", "interval": 60,
 "t0": 1791000000, "t": [0, 1, 2, 5], "c": [3.0912, 3.0915, 3.091, 3.0908]}
```

- `interval`: the bar length in seconds.
- `t0`: the start of the first bar, as epoch seconds.
- `t`: each bar's offset from `t0`, in units of `interval`.
- `c`: the close price of each bar.

A bar starts at epoch `t0 + t[i] × interval` and closes at `interval` seconds
later.
