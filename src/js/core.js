/*
 * Core logic for the 1399 report generator: dates, Bank of Israel rates,
 * capital-gain computation and E*Trade import parsing.
 *
 * Pure functions only (no DOM), so the same file runs in the browser
 * (window.Core) and in Node tests (module.exports).
 *
 * Tax computation follows Israeli Income Tax Circular 10/2025 (the Mozes
 * ruling, examples 1-4): for an individual holding a security denominated in
 * foreign currency, the USD/ILS representative rate acts as the "index".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAX_RATE = 0.25; // Individual, non-substantial shareholder, real gain after 1.1.2012.
  const MAX_RATE_LOOKBACK_DAYS = 14;

  // ---------------------------------------------------------------- dates

  function pad2(n) { return String(n).padStart(2, '0'); }

  function isoFromParts(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  /**
   * Parse a date coming from E*Trade (US "MM/DD/YYYY"), from an <input type=date>
   * ("YYYY-MM-DD"), from a JS Date or from an Excel serial number.
   * Returns an ISO "YYYY-MM-DD" string or null.
   */
  function parseDate(value, { usFormat = true } = {}) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value)) {
      // SheetJS builds dates in local time; use local parts to avoid TZ drift.
      return isoFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === 'number' && isFinite(value)) {
      // Excel serial date (1900 system).
      const ms = Math.round((value - 25569) * 86400000);
      const d = new Date(ms);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoFromParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      const a = +m[1], b = +m[2];
      return usFormat ? isoFromParts(y, a, b) : isoFromParts(y, b, a);
    }
    return null;
  }

  /** "2026-05-11" -> "11.5.2026" (the style used on the paper form). */
  function formatDateIL(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d}.${m}.${y}`;
  }

  function addDays(iso, delta) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /** Same day N months later (clamped to the month's last day). */
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return isoFromParts(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
  }

  function halfOfYear(iso) {
    const [y, m] = iso.split('-').map(Number);
    return { year: y, half: m <= 6 ? 1 : 2, key: `${y}-H${m <= 6 ? 1 : 2}` };
  }

  // ---------------------------------------------------------------- numbers

  /** Parse "$1,234.56", "(12.50)", "-12.5", 12.5 -> number (NaN if invalid). */
  function parseMoney(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;
    let s = String(value).trim();
    if (s === '' || s === '--') return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s₪]/g, '');
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /** Round to whole shekels, half away from zero. */
  function roundILS(n) { return n < 0 ? -Math.round(-n) : Math.round(n); }

  // ---------------------------------------------------------------- rates

  /**
   * Find the Bank of Israel representative rate for a date. When no rate was
   * published that day (weekend / holiday) the last rate published before it
   * is the one in force.
   * @returns {{rate:number, date:string, exact:boolean}|null}
   */
  const lastDateCache = new WeakMap();
  function lastDate(rates) {
    if (!lastDateCache.has(rates)) lastDateCache.set(rates, Object.keys(rates).sort().pop() || '');
    return lastDateCache.get(rates);
  }

  function lookupRate(rates, iso) {
    if (!rates || !iso) return null;
    // Never fall back across the end of the bundled data: a date after the last
    // published rate we have needs a manual rate (or a data refresh).
    if (iso > lastDate(rates)) return null;
    let d = iso;
    for (let i = 0; i <= MAX_RATE_LOOKBACK_DAYS; i++) {
      if (Object.prototype.hasOwnProperty.call(rates, d)) {
        return { rate: rates[d], date: d, exact: i === 0 };
      }
      d = addDays(d, -1);
    }
    return null;
  }

  // ---------------------------------------------------------------- tax

  /**
   * Compute the ILS figures of one lot.
   * @param {object} lot  {qty, dateAcquired, dateSold, proceedsUsd, costUsd, feesUsd}
   * @param {object} rates  map ISO date -> rate
   * @param {object} [overrides]  {rateBuy, rateSell} manual rates
   */
  function computeLot(lot, rates, overrides = {}) {
    const issues = [];
    const buy = overrides.rateBuy ? { rate: +overrides.rateBuy, date: lot.dateAcquired, manual: true }
      : lookupRate(rates, lot.dateAcquired);
    const sell = overrides.rateSell ? { rate: +overrides.rateSell, date: lot.dateSold, manual: true }
      : lookupRate(rates, lot.dateSold);
    if (!lot.dateAcquired) issues.push('חסר תאריך רכישה');
    if (!lot.dateSold) issues.push('חסר תאריך מכירה');
    if (lot.dateAcquired && lot.dateSold && lot.dateAcquired > lot.dateSold) issues.push('תאריך הרכישה מאוחר מתאריך המכירה');
    if (!buy && lot.dateAcquired) issues.push('לא נמצא שער יציג ליום הרכישה - יש להזין ידנית');
    if (!sell && lot.dateSold) issues.push('לא נמצא שער יציג ליום המכירה - יש להזין ידנית');
    if (!isFinite(lot.proceedsUsd)) issues.push('חסרה תמורה בדולרים');
    if (!isFinite(lot.costUsd)) issues.push('חסרה עלות בדולרים');
    if (issues.length) return { ok: false, issues, buy, sell };

    const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
    const proceedsIls = roundILS(lot.proceedsUsd * sell.rate);
    const costIls = roundILS(lot.costUsd * buy.rate);
    const feesIls = roundILS(fees * sell.rate);
    const nominal = proceedsIls - costIls - feesIls;
    // Inflationary amount = original cost x (index at sale / index at purchase - 1).
    const inflRaw = roundILS(costIls * (sell.rate / buy.rate - 1));

    let inflationary; // amount shown on line 17
    let real; // positive = taxable real gain, negative = loss allowed for offset
    let scenario;
    if (nominal >= 0) {
      // Examples 1, 3 and the "5.0" variant of example 2 in Circular 10/2025.
      inflationary = Math.min(Math.max(inflRaw, 0), nominal);
      real = nominal - inflationary;
      scenario = inflRaw > 0 ? (inflRaw >= nominal ? 'gain-all-inflationary' : 'gain-partly-inflationary') : 'gain-no-inflation';
    } else if (inflRaw >= 0) {
      // Example 2: nominal loss while the shekel weakened - the whole nominal loss is allowed.
      inflationary = 0;
      real = nominal;
      scenario = 'loss-allowed';
    } else {
      // Example 4: loss partly caused by a stronger shekel - neutralise the negative
      // inflationary amount. If the USD result is a gain, there is no gain and no loss.
      real = Math.min(0, nominal - inflRaw);
      inflationary = nominal - real; // negative: the part of the loss that is not deductible
      scenario = real === 0 ? 'fx-loss-only' : 'loss-partly-fx';
    }
    const tax = real > 0 ? roundILS(real * TAX_RATE) : 0;
    return {
      ok: true, issues: [], buy, sell,
      proceedsIls, costIls, feesIls, nominal, inflRaw, inflationary, real, tax, scenario,
      gainUsd: round2(lot.proceedsUsd - lot.costUsd - fees),
    };
  }

  // ---------------------------------------------------------------- stock prices

  const sortedCache = new WeakMap();
  function sortedDates(map) {
    if (!sortedCache.has(map)) sortedCache.set(map, Object.keys(map).sort());
    return sortedCache.get(map);
  }

  /**
   * Average closing price over the N trading days BEFORE a date (section 102,
   * listed company: the value of the benefit is the average of the 30 trading
   * days that precede the allocation to the trustee).
   * @param {object} prices  {rates: {iso: close}} or a plain map iso -> close
   * @returns {{avg:number, count:number, from:string, to:string}|null}
   */
  function avgCloseBefore(prices, iso, n = 30) {
    const map = prices && prices.rates ? prices.rates : prices;
    if (!map || !iso) return null;
    const dates = sortedDates(map);
    if (!dates.length || iso > addDays(dates[dates.length - 1], 7)) return null; // no data that recent
    let lo = 0, hi = dates.length; // first index with date >= iso
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < iso) lo = mid + 1; else hi = mid; }
    if (lo < n) return null; // not enough history
    const win = dates.slice(lo - n, lo);
    const avg = win.reduce((a, d) => a + map[d], 0) / n;
    return { avg: Math.round(avg * 10000) / 10000, count: n, from: win[0], to: win[n - 1] };
  }

  /** Last close in a price file: {price, date} or null. */
  function lastClose(prices) {
    const map = prices && prices.rates ? prices.rates : prices;
    if (!map) return null;
    const dates = sortedDates(map);
    if (!dates.length) return null;
    const d = dates[dates.length - 1];
    return { price: map[d], date: d };
  }

  // ---------------------------------------------------------------- section 102 (capital-gains track, trustee)

  const HOLDING_MONTHS = 24;
  const WORK_DEFAULTS = { marginalRate: 47, niRate: 12, includeNi: true };

  /** Allocation date to the trustee: the grant date for RSU, the purchase date for ESPP. */
  const allocationDate = lot => (lot.planType === 'RSU' ? lot.grantDate || '' : lot.dateAcquired || '');

  /** First sale date that is not before the end of the 24-month trustee period (conservative: the day after). */
  const unlockDate = alloc => (alloc ? addDays(addMonths(alloc, HOLDING_MONTHS), 1) : '');

  /**
   * One lot under section 102, capital-gains track with a trustee.
   *
   *  - Work income (marginal tax): the value at allocation minus what the
   *    employee paid, but never more than the actual gain.
   *      ESPP: value = market price on the purchase date (Adjusted Cost Basis),
   *            so the work income is the discount.
   *      RSU:  value = average close of the 30 trading days before the grant.
   *    Converted at the sale-date representative rate (when the trustee withholds).
   *  - Capital gain (25%): the rest. Computed as a REAL gain exactly like any
   *    other lot (Circular 10/2025), with cost = paid + work income, dated at the
   *    allocation date.
   *  - A sale before the end of the 24-month trustee period leaves the track:
   *    the whole gain is work income and there is no capital gain to report.
   *
   * @param {object} opts  {prices: {SYMBOL: priceFile}}
   */
  function computeLot102(lot, rates, overrides = {}, { prices } = {}) {
    const isRsu = lot.planType === 'RSU';
    const alloc = allocationDate(lot);
    const issues = [];
    if (!alloc) issues.push(isRsu ? 'חסר תאריך הענקה (Grant Date), שנדרש במסלול 102' : 'חסר תאריך רכישה');
    if (alloc && lot.dateSold && alloc > lot.dateSold) issues.push('תאריך ההקצאה מאוחר מתאריך המכירה');
    let baseUsd = NaN, baseSource = 'cost', avg = null;
    if (isRsu) {
      const manual = numOrNaN(lot.avg30);
      if (!(lot.qty > 0)) issues.push('חסרה כמות מניות, שנדרשת לחישוב שווי ההטבה');
      else if (isFinite(manual) && manual > 0) { baseUsd = round2(manual * lot.qty); baseSource = 'manual'; }
      else if (alloc) {
        avg = avgCloseBefore(prices && prices[lot.symbol], alloc);
        if (avg) { baseUsd = round2(avg.avg * lot.qty); baseSource = 'avg30'; }
        else issues.push(`אין מחירי מניה של ${lot.symbol || 'הנייר'} לחישוב ממוצע 30 הימים. אפשר להזין את הממוצע מדוח הנאמן`);
      }
    } else {
      baseUsd = lot.costUsd;
      if (!isFinite(baseUsd)) issues.push('חסרה עלות בדולרים (השווי ביום הרכישה)');
    }
    const sell = overrides.rateSell ? { rate: +overrides.rateSell, date: lot.dateSold, manual: true } : lookupRate(rates, lot.dateSold);
    if (!lot.dateSold) issues.push('חסר תאריך מכירה');
    else if (!sell) issues.push('לא נמצא שער יציג ליום המכירה - יש להזין ידנית');
    if (!isFinite(lot.proceedsUsd)) issues.push('חסרה תמורה בדולרים');
    if (issues.length) return { ok: false, issues, track: '102', buy: null, sell };

    const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
    const paidRaw = numOrNaN(lot.paidUsd);
    const paidKnown = isRsu || isFinite(paidRaw);
    const paid = isFinite(paidRaw) ? paidRaw : isRsu ? 0 : baseUsd; // unknown ESPP price: no work part
    const unlock = unlockDate(alloc);
    const base = { track: '102', alloc, unlock, baseUsd, baseSource, avg, paidUsd: paid, paidKnown };
    const net = lot.proceedsUsd - fees;

    if (lot.dateSold < unlock) {
      const workUsd = round2(Math.max(0, net - paid));
      const proceedsIls = roundILS(lot.proceedsUsd * sell.rate);
      return {
        ok: true, issues: [], ...base, early: true, noForm: true, buy: null, sell,
        workUsd, workIls: roundILS(workUsd * sell.rate),
        proceedsIls, costIls: 0, feesIls: roundILS(fees * sell.rate), nominal: 0, inflRaw: 0, inflationary: 0, real: 0, tax: 0,
        scenario: 'early-102', gainUsd: round2(net - paid), capCostUsd: NaN, costDate: alloc,
      };
    }
    const workUsd = round2(Math.max(0, Math.min(baseUsd, net) - paid));
    const capCostUsd = round2(paid + workUsd);
    const cap = computeLot({ ...lot, dateAcquired: alloc, costUsd: capCostUsd }, rates, overrides);
    if (!cap.ok) return { ...cap, track: '102' };
    return { ...cap, ...base, early: false, noForm: false, workUsd, workIls: roundILS(workUsd * cap.sell.rate), capCostUsd, costDate: alloc };
  }

  /** Estimated marginal tax (plus national insurance + health) on work income. */
  function workTax(workIls, settings = {}) {
    const s = { ...WORK_DEFAULTS, ...settings };
    const rate = (+s.marginalRate || 0) + (s.includeNi ? +s.niRate || 0 : 0);
    return workIls > 0 ? roundILS(workIls * rate / 100) : 0;
  }

  /** Aggregate computed lots into half-year and yearly totals with loss offset. */
  function summarize(items) {
    const groups = new Map();
    const add = (key, label, it) => {
      if (!groups.has(key)) groups.set(key, { key, label, gains: 0, losses: 0, proceedsIls: 0, costIls: 0, nominal: 0, inflationary: 0, count: 0, workIls: 0, workCount: 0 });
      const g = groups.get(key);
      if (it.calc.workIls > 0) { g.workIls += it.calc.workIls; g.workCount++; }
      if (it.calc.noForm) return; // early 102 sale: work income only, no capital gain
      g.count++;
      g.proceedsIls += it.calc.proceedsIls;
      g.costIls += it.calc.costIls + it.calc.feesIls;
      g.nominal += it.calc.nominal;
      g.inflationary += Math.max(it.calc.inflationary, 0);
      if (it.calc.real > 0) g.gains += it.calc.real; else g.losses += it.calc.real;
    };
    const valid = items.filter(it => it.calc && it.calc.ok);
    for (const it of valid) {
      const h = halfOfYear(it.lot.dateSold);
      add(h.key, `${h.half === 1 ? 'ינואר-יוני' : 'יולי-דצמבר'} ${h.year}`, it);
      add(`${h.year}`, `שנת ${h.year}`, it);
    }
    const order = k => (k.includes('-H') ? k : `${k}-Z`); // halves first, then the year total
    const out = [...groups.values()].sort((a, b) => order(a.key).localeCompare(order(b.key)));
    for (const g of out) {
      g.net = g.gains + g.losses;
      g.taxable = Math.max(g.net, 0);
      g.tax = roundILS(g.taxable * TAX_RATE);
      g.carryLoss = Math.min(g.net, 0);
      g.isYear = !g.key.includes('-H');
    }
    return out;
  }

  // ---------------------------------------------------------------- rate cross-check

  // Typical |deviation| from the BOI rate (2020-2026): ECB median 0.08%, max 0.99%;
  // Yahoo daily close median 0.22%, p99 1.4%. Above these the row is flagged.
  const CHECK_THRESHOLDS = { ecb: 1.0, yahoo: 1.5 };

  /**
   * Compare the BOI rate for a date with the secondary daily sources.
   * @param {object} sources {boi, ecb, yahoo} maps of ISO date -> rate
   */
  function crossCheck(sources, iso) {
    const boi = lookupRate(sources.boi, iso);
    const out = { date: iso, boi, warn: false, checks: {} };
    for (const key of ['ecb', 'yahoo']) {
      const r = sources[key] ? lookupRate(sources[key], iso) : null;
      const devPct = boi && r ? round2((r.rate / boi.rate - 1) * 100) : null;
      const warn = devPct !== null && Math.abs(devPct) > CHECK_THRESHOLDS[key];
      out.checks[key] = { ...(r || {}), devPct, warn };
      if (warn) out.warn = true;
    }
    return out;
  }

  // ---------------------------------------------------------------- intraday

  /**
   * Convert a wall-clock time in New York (E*Trade shows execution times in ET)
   * to a UTC epoch in seconds, honouring daylight saving time.
   */
  function nyToUtcEpoch(iso, hhmm, timeZone = 'America/New_York') {
    if (!iso || !/^\d{1,2}:\d{2}/.test(hhmm || '')) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const wanted = Date.UTC(y, m - 1, d, h, mi);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    let guess = wanted + 5 * 3600000; // EST offset as a first guess
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
      const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      if (local === wanted) break;
      guess += wanted - local;
    }
    return Math.floor(guess / 1000);
  }

  /**
   * Find the market rate at a UTC epoch in an intraday file written by
   * tools/update_rates.py ({interval, t0, t[], c[]}). Bars are stamped with their
   * START time but hold the CLOSE price, so the bar whose close is nearest to the
   * moment is used; if it is missing, the nearest earlier bar within maxGapBars.
   * Returned `ts` is the close time of the bar used.
   */
  function intradayAt(file, epoch, maxGapBars = 5) {
    if (!file || !file.t || !file.t.length || !isFinite(epoch)) return null;
    const step = file.interval;
    const target = Math.round((epoch - file.t0) / step) - 1;
    let lo = 0, hi = file.t.length - 1;
    if (target < file.t[0]) return null;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (file.t[mid] <= target) lo = mid; else hi = mid - 1; }
    if (target - file.t[lo] > maxGapBars) return null;
    return { rate: file.c[lo], ts: file.t0 + (file.t[lo] + 1) * step, interval: step, exact: file.t[lo] === target };
  }

  // ---------------------------------------------------------------- helpers for the UI

  /**
   * Closed form of the Circular 10/2025 rules, used to explain the result:
   *   A = USD result converted at the sale rate = (P$ - C$ - F$) x Rs
   *   B = nominal ILS result                     = P$ x Rs - C$ x Rb - F$ x Rs
   *   real = min(A, B) if both are gains, max(A, B) if both are losses, otherwise 0.
   * computeLot() implements the circular step by step; this must agree with it.
   */
  function closedFormReal(lot, rateBuy, rateSell) {
    const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
    const A = (lot.proceedsUsd - lot.costUsd - fees) * rateSell;
    const B = lot.proceedsUsd * rateSell - lot.costUsd * rateBuy - fees * rateSell;
    let real;
    if (A >= 0 && B >= 0) real = Math.min(A, B);
    else if (A <= 0 && B <= 0) real = Math.max(A, B);
    else real = 0;
    return { A, B, real };
  }

  /** Israeli ID check digit (9 digits, shorter IDs are left-padded with zeros). */
  function isValidIsraeliId(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits || digits.length > 9) return false;
    const id = digits.padStart(9, '0');
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let n = Number(id[i]) * ((i % 2) + 1);
      if (n > 9) n -= 9;
      sum += n;
    }
    return sum % 10 === 0;
  }

  /**
   * Pull a date and an execution time out of text pasted from E*Trade's
   * Order Details (e.g. "Executed 05/11/2026 10:35:12 AM ET").
   * @returns {{date:string|null, time:string|null}}
   */
  function parseOrderText(text) {
    const s = String(text || '');
    const dm = s.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const tm = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
    let time = null;
    if (tm) {
      let h = Number(tm[1]);
      const ap = tm[3] ? tm[3].toUpperCase() : '';
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      if (h <= 23) time = `${pad2(h)}:${tm[2]}`;
    }
    return { date: dm ? parseDate(dm[1]) : null, time };
  }

  /** Short Hebrew description of the Circular 10/2025 case a lot falls into. */
  const SCENARIO_TEXT = {
    'gain-no-inflation': 'רווח, והשקל התחזק או לא השתנה: אין סכום אינפלציוני וכל הרווח הנומינלי ריאלי (דוגמה 3 בחוזר).',
    'gain-partly-inflationary': 'רווח, והשקל נחלש: החלק שנובע מעליית הדולר פטור כסכום אינפלציוני (דוגמה 1 בחוזר).',
    'gain-all-inflationary': 'כל הרווח בשקלים נובע מעליית הדולר, ולכן אין רווח ריאלי (דוגמה 2 בחוזר, חלק ב).',
    'loss-allowed': 'הפסד, והשקל נחלש: כל ההפסד הנומינלי מותר בקיזוז (דוגמה 2 בחוזר).',
    'loss-partly-fx': 'הפסד, והשקל התחזק: החלק של ההפסד שנובע מירידת הדולר אינו מותר בקיזוז (דוגמה 4 בחוזר, הלכת מוזס).',
    'fx-loss-only': 'רווח בדולרים אבל הפסד בשקלים: ההפסד נובע רק מהשער, ולכן אין רווח ואין הפסד.',
    'early-102': 'מכירה לפני תום 24 החודשים אצל הנאמן: ההקצאה יוצאת ממסלול רווח הון, וכל הרווח הוא הכנסת עבודה במס שולי. אין רווח הון לדיווח ב‑1399.',
  };

  // ---------------------------------------------------------------- backup / restore

  const BACKUP_APP = 'espp-rsu-1399';
  const LOT_FIELDS = ['symbol', 'planType', 'qty', 'dateAcquired', 'dateSold', 'timeSold', 'proceedsUsd', 'costUsd', 'feesUsd', 'sec102', 'rateBuy', 'rateSell', 'order', 'grantDate', 'paidUsd', 'avg30', 'withheldIls', 'offerStart', 'discountPct'];
  const HOLDING_FIELDS = ['symbol', 'planType', 'qty', 'dateAcquired', 'grantDate', 'costPerShare', 'paidPerShare', 'avg30', 'sec102'];
  const PROFILE_FIELDS = ['name', 'belonging', 'place', 'sec102', 'signDate', 'marginalRate', 'niRate', 'includeNi']; // never the ID number

  const numOrNaN = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

  function cleanLot(raw) {
    const lot = {};
    for (const k of LOT_FIELDS) lot[k] = raw && raw[k] !== undefined ? raw[k] : '';
    for (const k of ['qty', 'proceedsUsd', 'costUsd']) lot[k] = numOrNaN(lot[k]);
    lot.feesUsd = isFinite(numOrNaN(lot.feesUsd)) ? numOrNaN(lot.feesUsd) : 0;
    lot.sec102 = lot.sec102 === true || lot.sec102 === false ? lot.sec102 : null;
    lot.symbol = String(lot.symbol || '').toUpperCase();
    for (const k of ['dateAcquired', 'dateSold', 'grantDate', 'offerStart']) lot[k] = parseDate(lot[k]) || '';
    for (const k of ['planType', 'timeSold', 'rateBuy', 'rateSell', 'order', 'avg30', 'discountPct']) lot[k] = lot[k] === null ? '' : String(lot[k]);
    for (const k of ['paidUsd', 'withheldIls']) lot[k] = numOrNaN(lot[k]);
    return lot;
  }

  function cleanHolding(raw) {
    const h = {};
    for (const k of HOLDING_FIELDS) h[k] = raw && raw[k] !== undefined ? raw[k] : '';
    for (const k of ['qty', 'costPerShare', 'paidPerShare']) h[k] = numOrNaN(h[k]);
    h.sec102 = h.sec102 === true || h.sec102 === false ? h.sec102 : null;
    h.symbol = String(h.symbol || '').toUpperCase();
    h.planType = h.planType === 'RSU' ? 'RSU' : 'ESPP';
    for (const k of ['dateAcquired', 'grantDate']) h[k] = parseDate(h[k]) || '';
    h.avg30 = h.avg30 === null ? '' : String(h.avg30);
    return h;
  }

  const pick = (o, fields) => { const out = {}; for (const k of fields) out[k] = typeof o[k] === 'number' && !isFinite(o[k]) ? null : o[k]; return out; };

  /** Build the backup object (JSON-serialisable). The ID number is never included. */
  function makeBackup(profile, lots, now = new Date(), holdings = []) {
    const prof = {};
    for (const k of PROFILE_FIELDS) if (profile && profile[k] !== undefined) prof[k] = profile[k];
    return {
      app: BACKUP_APP, version: 1, exportedAt: now.toISOString(),
      profile: prof,
      lots: lots.map(l => pick(l, LOT_FIELDS)),
      holdings: holdings.map(h => pick(h, HOLDING_FIELDS)),
    };
  }

  /** Parse and validate a backup file's text. Throws an Error with a Hebrew message. */
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('הקובץ אינו קובץ גיבוי תקין (JSON פגום).'); }
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.lots)) throw new Error('הקובץ אינו קובץ גיבוי של מחולל טופס 1399.');
    if (data.version > 1) throw new Error('קובץ הגיבוי נוצר בגרסה חדשה יותר של הכלי.');
    const profile = {};
    for (const k of PROFILE_FIELDS) if (data.profile && data.profile[k] !== undefined) profile[k] = data.profile[k];
    const holdings = Array.isArray(data.holdings) ? data.holdings.map(cleanHolding) : [];
    return { lots: data.lots.map(cleanLot), holdings, profile, exportedAt: data.exportedAt || null };
  }

  const lotKey = l => [l.symbol, l.dateAcquired, l.dateSold, l.qty, l.proceedsUsd, l.costUsd].map(v => String(v ?? '')).join('|');

  /** Append incoming lots to existing ones, skipping exact duplicates. */
  function mergeLots(existing, incoming) {
    const seen = new Set(existing.map(lotKey));
    const added = [];
    let skipped = 0;
    for (const l of incoming) {
      const k = lotKey(l);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k);
      added.push(l);
    }
    return { merged: existing.concat(added), added: added.length, skipped };
  }

  // ---------------------------------------------------------------- E*Trade import

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Header aliases (normalised) for E*Trade "Gains & Losses" exports
  // (G&L_Expanded.xlsx / G&L_Collapsed.xlsx / CSV) and similar layouts.
  const COLUMN_ALIASES = {
    recordType: ['recordtype'],
    symbol: ['symbol', 'ticker'],
    planType: ['plantype', 'benefittype', 'type'],
    qty: ['quantity', 'qty', 'shares', 'quantityshares'],
    dateAcquired: ['dateacquired', 'acquireddate', 'acquisitiondate', 'purchasedate', 'vestdate'],
    dateSold: ['datesold', 'solddate', 'saledate', 'closingdate'],
    proceedsUsd: ['totalproceeds', 'proceeds', 'adjustedproceeds'],
    adjustedCostUsd: ['adjustedcostbasis', 'adjustedcost'],
    costBasisUsd: ['costbasis', 'acquisitioncost', 'totalcost'],
    order: ['ordernumber', 'order', 'orderno'],
    grantDate: ['grantdate'],
    acquisitionCostUsd: ['acquisitioncost'],
    purchasePrice: ['purchaseprice', 'purchasepricepershare'],
    purchaseFmv: ['purchasedatefairmktvalue', 'purchasedatefmv', 'purchasefmv', 'purchasedatefairmarketvalue'],
  };

  function mapHeaders(headerRow) {
    const idx = {};
    const normed = headerRow.map(norm);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const a of aliases) {
        const i = normed.indexOf(a);
        if (i !== -1) { idx[key] = i; break; }
      }
    }
    // "Date Acquired" must win over "Purchase Date"/"Vest Date" when both exist.
    const da = normed.indexOf('dateacquired');
    if (da !== -1) idx.dateAcquired = da;
    return idx;
  }

  /**
   * Turn a 2-D array of cells (from SheetJS sheet_to_json({header:1})) into lots.
   * Rows whose record type is "Summary"/"Total" or that have no sale date are skipped.
   * @returns {{lots:object[], warnings:string[]}}
   */
  function parseEtradeRows(rows) {
    const warnings = [];
    let headerAt = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const n = (rows[r] || []).map(norm);
      if (n.includes('datesold') || (n.some(c => c.includes('sold')) && n.some(c => c.includes('acquired')))) { headerAt = r; break; }
    }
    if (headerAt === -1) {
      return { lots: [], warnings: ['לא נמצאה שורת כותרות עם "Date Sold" / "Date Acquired" - ודא שזה קובץ Gains & Losses של E*Trade'] };
    }
    const idx = mapHeaders(rows[headerAt]);
    for (const k of ['dateAcquired', 'dateSold', 'proceedsUsd']) {
      if (idx[k] === undefined) warnings.push(`עמודה חסרה בקובץ: ${k}`);
    }
    if (idx.adjustedCostUsd === undefined && idx.costBasisUsd === undefined) warnings.push('עמודת עלות (Adjusted Cost Basis) לא נמצאה');

    const lots = [];
    for (let r = headerAt + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = k => (idx[k] === undefined ? undefined : row[idx[k]]);
      const rt = norm(get('recordType'));
      if (rt === 'summary' || rt === 'total' || rt === 'totals') continue;
      const firstCell = norm(row[0]);
      if (firstCell === 'totals' || firstCell === 'total') continue;
      const dateSold = parseDate(get('dateSold'));
      if (!dateSold) continue;
      let cost = parseMoney(get('adjustedCostUsd'));
      if (!isFinite(cost)) cost = parseMoney(get('costBasisUsd'));
      const planType = normalizePlan(get('planType'));
      const qty = parseMoney(get('qty'));
      // What the employee paid (ESPP: purchase price x qty). RSU: nothing.
      let paidUsd = NaN;
      if (planType === 'ESPP') {
        paidUsd = parseMoney(get('acquisitionCostUsd'));
        const pp = parseMoney(get('purchasePrice'));
        if (!isFinite(paidUsd) && isFinite(pp) && isFinite(qty)) paidUsd = round2(pp * qty);
        // If the file's cost is just the price paid, rebuild the market value from the purchase-date FMV.
        const fmv = parseMoney(get('purchaseFmv'));
        if (isFinite(fmv) && isFinite(qty) && (!isFinite(cost) || (isFinite(paidUsd) && Math.abs(cost - paidUsd) < 0.01))) cost = round2(fmv * qty);
        if (isFinite(paidUsd) && isFinite(cost) && paidUsd > cost) paidUsd = NaN; // not a purchase price
      } else if (planType === 'RSU') paidUsd = 0;
      lots.push({
        symbol: String(get('symbol') || '').trim().toUpperCase(),
        planType,
        qty,
        grantDate: planType === 'RSU' ? parseDate(get('grantDate')) || '' : '',
        offerStart: planType === 'ESPP' ? parseDate(get('grantDate')) || '' : '', // E*Trade's ESPP "Grant Date" = offering start
        paidUsd,
        dateAcquired: parseDate(get('dateAcquired')),
        dateSold,
        proceedsUsd: parseMoney(get('proceedsUsd')),
        costUsd: cost,
        feesUsd: 0,
        order: get('order') !== undefined ? String(get('order')).trim() : '',
        timeSold: '',
      });
    }
    if (!lots.length) warnings.push('לא נמצאו שורות מכירה בקובץ');
    return { lots, warnings };
  }

  // Header aliases for E*Trade holdings exports (Portfolios -> By Benefit Type ->
  // Download Expanded). The exact layout was not verified on a real file, so the
  // parser is tolerant and every imported row should be reviewed.
  const HOLDING_ALIASES = {
    recordType: ['recordtype'],
    symbol: ['symbol', 'ticker'],
    planType: ['plantype', 'benefittype'],
    qty: ['sellableqty', 'sellablequantity', 'sellableshares', 'availableqty', 'sharesavailable', 'quantity', 'qty', 'shares'],
    purchaseDate: ['purchasedate', 'dateacquired', 'acquireddate'],
    vestDate: ['vestdate', 'releasedate', 'vestingdate'],
    grantDate: ['grantdate'],
    purchasePrice: ['purchaseprice', 'purchasepricepershare'],
    fmv: ['purchasedatefmv', 'purchasedatefairmktvalue', 'purchasefmv', 'purchasedatefairmarketvalue', 'vestdatefmv', 'fmvatvest', 'releasefmv', 'vestfmv', 'costbasispershare'],
  };

  /** Parse unsold shares (for the simulator) from a sheet. @returns {{holdings, warnings}} */
  function parseHoldingsRows(rows, sheetName = '') {
    const warnings = [];
    let headerAt = -1, idx = {};
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const n = (rows[r] || []).map(norm);
      if (!n.includes('symbol')) continue;
      const map = {};
      for (const [key, aliases] of Object.entries(HOLDING_ALIASES)) {
        for (const a of aliases) { const i = n.indexOf(a); if (i !== -1) { map[key] = i; break; } }
      }
      if (map.qty !== undefined) { headerAt = r; idx = map; break; }
    }
    if (headerAt === -1) return { holdings: [], warnings: ['לא נמצאה שורת כותרות עם Symbol וכמות'] };
    const sheetPlan = /espp/i.test(sheetName) ? 'ESPP' : /restrict|rsu|\brs\b/i.test(sheetName) ? 'RSU' : '';
    const data = [];
    for (let r = headerAt + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = k => (idx[k] === undefined ? undefined : row[idx[k]]);
      const rt = norm(get('recordType'));
      if (['total', 'totals', 'summary', 'overallsummary'].includes(rt) || norm(row[0]) === 'totals') continue;
      const qty = parseMoney(get('qty'));
      if (!(qty > 0)) continue;
      let plan = normalizePlan(get('planType')) || sheetPlan;
      if (!plan) plan = get('purchasePrice') !== undefined && get('purchasePrice') !== '' ? 'ESPP' : 'RSU';
      data.push({ rt, plan, get, qty });
    }
    // Prefer one row per lot: purchase rows for ESPP, grant rows for RSU, when the file has record types.
    const hasType = t => data.some(d => d.rt.includes(t));
    const rowsOut = data.filter(d => !d.rt || (d.plan === 'ESPP' ? !hasType('purchase') || d.rt.includes('purchase') : !hasType('grant') || d.rt.includes('grant')));
    const holdings = rowsOut.map(({ plan, get, qty }) => cleanHolding({
      symbol: String(get('symbol') || '').trim(),
      planType: plan === 'RSU' ? 'RSU' : 'ESPP',
      qty,
      dateAcquired: parseDate(plan === 'RSU' ? get('vestDate') : get('purchaseDate')) || '',
      grantDate: plan === 'RSU' ? parseDate(get('grantDate')) || '' : '',
      costPerShare: parseMoney(get('fmv')),
      paidPerShare: plan === 'RSU' ? 0 : parseMoney(get('purchasePrice')),
      sec102: null,
    }));
    if (!holdings.length) warnings.push('לא נמצאו שורות עם כמות מניות');
    return { holdings, warnings };
  }

  // ---------------------------------------------------------------- "what if" (stock chart)

  const ESPP_DISCOUNT = 15;
  const DEFAULT_OFFERING_MONTHS = 6;

  /** Start of the ESPP offering period: the lot's value, or 6 months before the purchase. */
  const offeringStart = lot => lot.offerStart || (lot.dateAcquired ? addMonths(lot.dateAcquired, -DEFAULT_OFFERING_MONTHS) : '');

  /** ESPP purchase price with a lookback: (1 − discount) × min(close at offering start, close at purchase). */
  function lookbackPrice(closeStart, closePurchase, discountPct = ESPP_DISCOUNT) {
    if (!isFinite(closeStart) || !isFinite(closePurchase)) return NaN;
    return round2((1 - discountPct / 100) * Math.min(closeStart, closePurchase));
  }

  /** Price of a trading day: close, high or low (the last trading day on or before the date). */
  function priceOn(prices, iso, kind = 'close') {
    if (!prices || !iso) return null;
    const map = kind === 'close' ? prices.rates : prices[kind];
    const r = lookupRate(map || {}, iso);
    return r ? { price: r.rate, date: r.date } : null;
  }

  /**
   * Evaluate one lot (the actual one or a "what if" variant): the capital part,
   * the work income, the estimated taxes and the net amount, in shekels.
   * For the regular track the payroll tax on the benefit is estimated too, so
   * both tracks compare like for like. A sale date after the bundled BOI rates
   * uses the last published rate.
   */
  function evaluateLot(lot, { rates, prices, is102, settings }) {
    const overrides = { rateBuy: lot.rateBuy, rateSell: lot.rateSell };
    const last = lastDate(rates || {});
    if (!overrides.rateSell && lot.dateSold && last && lot.dateSold > last) overrides.rateSell = rates[last];
    const calc = is102 ? computeLot102(lot, rates, overrides, { prices }) : computeLot(lot, rates, overrides);
    if (!calc.ok) return { ok: false, issues: calc.issues };
    const rb = calc.buy ? calc.buy.rate : (lookupRate(rates, allocationDate(lot)) || {}).rate;
    const paid = isFinite(lot.paidUsd) ? lot.paidUsd : lot.planType === 'RSU' ? 0 : NaN;
    const paidIls = isFinite(paid) && isFinite(rb) ? roundILS(paid * rb) : 0;
    let workIls = 0, workTaxIls = 0, payroll = false;
    if (is102) { workIls = calc.workIls; workTaxIls = workTax(workIls, settings); }
    else if (isFinite(lot.costUsd) && calc.buy) {
      workIls = roundILS((lot.costUsd - (isFinite(paid) ? paid : lot.costUsd)) * calc.buy.rate);
      workTaxIls = workTax(workIls, settings);
      payroll = true;
    }
    const net = calc.proceedsIls - paidIls - calc.feesIls - workTaxIls - calc.tax;
    return {
      ok: true, calc, paidIls, workIls, workTax: workTaxIls, payroll, net,
      paidPerShare: lot.qty > 0 && isFinite(paid) ? round2(paid / lot.qty) : NaN,
      fmvPerShare: lot.qty > 0 && isFinite(lot.costUsd) ? round2(lot.costUsd / lot.qty) : NaN,
      salePerShare: lot.qty > 0 ? round2((lot.proceedsUsd + (lot.feesUsd || 0)) / lot.qty) : NaN,
    };
  }

  /**
   * Build the "what if" variants of a lot for moved dates.
   * A moved purchase or offering start re-prices the purchase from closing
   * prices (FMV = close at purchase; ESPP price with lookback). A moved sale is
   * priced at that day's low and high. Unmoved parts keep the actual numbers.
   * @param {object} sc {offerStart, buyDate, saleDate}
   * @returns {{moved:{offer,buy,sale}, variants: {key,label,lot}[]}}
   */
  function whatIfLots(lot, sc, prices) {
    const p = prices && prices[lot.symbol];
    const q = lot.qty;
    const moved = { offer: lot.planType === 'ESPP' && sc.offerStart !== offeringStart(lot), buy: sc.buyDate !== lot.dateAcquired, sale: sc.saleDate !== lot.dateSold };
    const base = { ...lot, dateAcquired: sc.buyDate, dateSold: sc.saleDate };
    if ((moved.buy || moved.offer) && p) {
      // Scale the actual numbers by the change in market prices, so an unmoved
      // date gives back exactly the real figures whatever the plan's FMV rule is.
      const close = iso => { const r = priceOn(p, iso); return r ? r.price : NaN; };
      const s1a = close(lot.dateAcquired), s1 = close(sc.buyDate);
      if (isFinite(s1)) {
        base.costUsd = round2(isFinite(lot.costUsd) && isFinite(s1a) ? lot.costUsd * (s1 / s1a) : s1 * q);
        if (lot.planType === 'ESPP') {
          const d = isFinite(+lot.discountPct) && lot.discountPct !== '' ? +lot.discountPct : ESPP_DISCOUNT;
          const la = lookbackPrice(close(offeringStart(lot)), s1a, d);
          const ln = lookbackPrice(close(sc.offerStart), s1, d);
          if (isFinite(ln)) base.paidUsd = round2(isFinite(lot.paidUsd) && isFinite(la) ? lot.paidUsd * (ln / la) : ln * q);
        }
      }
    }
    const variants = [];
    if (moved.sale && p) {
      const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
      for (const [key, label] of [['low', 'מחיר נמוך'], ['high', 'מחיר גבוה']]) {
        const px = priceOn(p, sc.saleDate, key);
        if (px) variants.push({ key, label, price: px.price, lot: { ...base, proceedsUsd: round2(px.price * q - fees) } });
      }
    } else if (moved.buy || moved.offer) {
      variants.push({ key: 'what', label: 'מה אם', lot: base });
    }
    return { moved, variants };
  }

  // ---------------------------------------------------------------- text from PDF / OCR

  const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  const MONEY_RE = /\(?-?\$\s?-?\d[\d,]*(?:\.\d{1,2})?\)?/g;
  const DETAIL_LABELS = [
    ['Grant Date FMV', 'grantFmv', 'money'], ['Purchase Date FMV', 'purchaseFmv', 'money'], ['Vest Date FMV', 'vestFmv', 'money'],
    ['Purchase Price', 'purchasePrice', 'money'], ['Discount Amount', 'discount', 'money'],
    ['Grant Date', 'grantDate', 'date'], ['Purchase Date', 'purchaseDate', 'date'], ['Vest Date', 'vestDate', 'date'],
    ['Order Type', 'orderType', 'text'], ['Covered Status', 'covered', 'text'], ['Qualified Plan', 'qualified', 'text'], ['Disposition Type', 'disposition', 'text'],
  ];

  const tokensOf = line => {
    const out = [];
    for (const m of line.matchAll(DATE_RE)) out.push({ at: m.index, kind: 'date', v: isoFromParts(+m[3], +m[1], +m[2]) });
    for (const m of line.matchAll(MONEY_RE)) out.push({ at: m.index, kind: 'money', v: parseMoney(m[0]) });
    return out.filter(t => t.v !== null && !Number.isNaN(t.v)).sort((a, b) => a.at - b.at);
  };

  /** Labels found in a line, in order (longest match wins, so "Grant Date FMV" beats "Grant Date"). */
  function labelsIn(line) {
    const low = line.toLowerCase();
    const used = [];
    const found = [];
    for (const [label, key, kind] of [...DETAIL_LABELS].sort((a, b) => b[0].length - a[0].length)) {
      let from = 0;
      for (;;) {
        const i = low.indexOf(label.toLowerCase(), from);
        if (i === -1) break;
        from = i + 1;
        if (used.some(([a, b]) => i < b && i + label.length > a)) continue;
        used.push([i, i + label.length]);
        found.push({ at: i, key, kind });
      }
    }
    return found.sort((a, b) => a.at - b.at);
  }

  // A sale row of the E*Trade "Gains & Losses" page: SYMBOL Sell PLAN QTY DATE ... DATE $PROCEEDS ...
  const ROW_RE = /\b([A-Za-z][A-Za-z.]{0,5})\s+Sell\s+([A-Za-z ]{2,20}?)\s+([\d,]+(?:\.\d+)?)\s+(\d{1,2}\/\d{1,2}\/\d{4})/;

  /**
   * Parse the text of an E*Trade Gains & Losses page (a screenshot read with OCR,
   * or a PDF's text). Each sale row gives symbol, plan, quantity, dates, proceeds
   * and Adjusted Cost Basis; the expanded details under it give the purchase
   * price, grant date and fair market values.
   * @returns {{lots: object[], warnings: string[]}}
   */
  function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return dp[a.length][b.length];
  }

  /** OCR misreads a ticker now and then (QCOM -> QCCOM): snap to a known ticker when it is close. */
  function snapSymbol(sym, known = []) {
    const up = sym.toUpperCase();
    if (!known.length || known.includes(up)) return up;
    let best = null, bestD = 3;
    for (const k of known) { const d = editDistance(up, k); if (d < bestD) { best = k; bestD = d; } }
    return best && bestD <= 2 ? best : up;
  }

  function parseGainsText(text, { symbols = [] } = {}) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rows = [];
    lines.forEach((line, i) => { const m = line.match(ROW_RE); if (m) rows.push({ i, m }); });
    const lots = [];
    const warnings = [];
    rows.forEach((row, r) => {
      const { i, m } = row;
      const end = r + 1 < rows.length ? rows[r + 1].i : lines.length;
      const line = lines[i];
      const toks = tokensOf(line.slice(m.index));
      const dates = toks.filter(t => t.kind === 'date');
      const dateAcquired = dates[0] ? dates[0].v : null;
      const dateSold = dates[1] ? dates[1].v : null;
      const soldAt = dates[1] ? dates[1].at : Infinity;
      const moneyBefore = toks.filter(t => t.kind === 'money' && t.at < soldAt);
      const moneyAfter = toks.filter(t => t.kind === 'money' && t.at > soldAt);
      // Adjusted Cost Basis: between the two dates, or on its own line just above (a two-line cell).
      let cost = moneyBefore.length ? moneyBefore[moneyBefore.length - 1].v : NaN;
      if (!isFinite(cost)) {
        for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
          // A line that is only an amount (OCR may add a stray symbol for the "?" icon).
          const only = lines[k].match(/^(\(?-?\$\s?[\d,]+(?:\.\d{1,2})?\)?)\s*\S{0,2}$/);
          if (only) { cost = parseMoney(only[1]); break; }
        }
      }
      const details = {};
      for (let k = i + 1; k < end; k++) {
        if (/^totals?\b/i.test(lines[k])) break;
        const labels = labelsIn(lines[k]);
        if (!labels.length || k + 1 >= end) continue;
        const typed = labels.filter(l => l.kind !== 'text');
        const vals = tokensOf(lines[k + 1]);
        let v = 0;
        for (const l of typed) {
          while (v < vals.length && vals[v].kind !== l.kind) v++;
          if (v < vals.length) details[l.key] = vals[v++].v;
        }
      }
      const planType = normalizePlan(m[2]);
      const qty = parseMoney(m[3]);
      const fmvShare = planType === 'RSU' ? details.vestFmv : details.purchaseFmv;
      if (!isFinite(cost) && isFinite(fmvShare) && isFinite(qty)) cost = round2(fmvShare * qty); // no cost cell read
      const lot = {
        symbol: snapSymbol(m[1], symbols), planType, qty, dateAcquired, dateSold,
        proceedsUsd: moneyAfter.length ? moneyAfter[0].v : NaN, costUsd: cost, feesUsd: 0,
        paidUsd: planType === 'ESPP' && isFinite(details.purchasePrice) && isFinite(qty) ? round2(details.purchasePrice * qty) : planType === 'RSU' ? 0 : NaN,
        grantDate: planType === 'RSU' ? details.grantDate || '' : '',
        offerStart: planType === 'ESPP' ? details.grantDate || '' : '',
        order: (lines.slice(i, end).join(' ').match(/Order\W{0,3}\s*(\d{6,})/i) || [])[1] || '',
        timeSold: '',
      };
      lot._check = { fmv: fmvShare, purchasePrice: details.purchasePrice };
      lots.push(lot);
    });
    return { lots, warnings: lots.length ? lotWarnings(lots) : ['לא נמצאו בטקסט שורות מכירה (Sell) עם תאריכים'] };
  }

  /** Cross-checks of one lot read from a document: {cost, paid, missing} problem flags. */
  function lotProblems(lot) {
    const c = lot._check || {};
    const fmv = c.fmv;
    return {
      // Adjusted Cost Basis per share should match the purchase / vest FMV.
      cost: isFinite(fmv) && isFinite(lot.costUsd) && lot.qty > 0 && Math.abs(lot.costUsd / lot.qty - fmv) > 0.02,
      // An ESPP purchase price is a discount of up to ~15-50% on the FMV.
      paid: lot.planType === 'ESPP' && isFinite(c.purchasePrice) && isFinite(fmv) && (c.purchasePrice > fmv || c.purchasePrice < fmv * 0.5),
      missing: !lot.dateAcquired || !lot.dateSold || !isFinite(lot.proceedsUsd) || !isFinite(lot.costUsd),
    };
  }

  function lotWarnings(lots) {
    const out = [];
    for (const lot of lots) {
      const p = lotProblems(lot), c = lot._check || {}, at = `${lot.symbol} ${D_(lot.dateSold)}`;
      if (p.cost) out.push(`${at}: העלות (${lot.costUsd}) לא מתאימה לשווי למניה (${c.fmv} × ${lot.qty}). כדאי לבדוק.`);
      if (p.paid) out.push(`${at}: מחיר הרכישה (${c.purchasePrice}) נראה לא סביר מול השווי ביום הרכישה (${c.fmv}). כדאי לבדוק.`);
      if (p.missing) out.push(`${lot.symbol}: חלק מהשדות לא זוהו. כדאי להשלים אותם.`);
    }
    return out;
  }

  /**
   * OCR is run more than once on a screenshot (different scaling); keep the
   * reading that found the most sales with the fewest problems.
   */
  function bestGainsParse(texts, opts) {
    const all = texts.map(text => ({ text, ...parseGainsText(text, opts) }));
    let best = null;
    for (const r of all) {
      const score = r.lots.length * 10 - r.warnings.length;
      if (!best || score > best.score) best = { ...r, score };
    }
    if (!best) return { lots: [], warnings: [], text: '', score: 0 };
    // Field by field: a value that failed a cross-check is replaced by another reading of the same sale that passed it.
    const same = (a, b) => a.dateSold === b.dateSold && a.qty === b.qty;
    for (const lot of best.lots) {
      const others = all.flatMap(r => r.lots).filter(o => o !== lot && same(o, lot));
      if (lotProblems(lot).paid) {
        const o = others.find(x => !lotProblems(x).paid && isFinite(x._check.purchasePrice));
        if (o) { lot.paidUsd = o.paidUsd; lot._check.purchasePrice = o._check.purchasePrice; }
      }
      if (lotProblems(lot).cost) {
        const o = others.find(x => !lotProblems(x).cost);
        if (o) lot.costUsd = o.costUsd;
      }
    }
    best.warnings = lotWarnings(best.lots);
    return best;
  }
  const D_ = iso => (iso ? formatDateIL(iso) : '—');

  /**
   * Fallback for documents that are not a G&L page (for example a trade
   * confirmation): pull the sale-side facts that can be found, to prefill a lot.
   */
  function parseSaleHints(text) {
    const t = String(text || '');
    const near = (re, kind) => {
      const m = t.match(re);
      if (!m) return kind === 'date' ? null : NaN;
      const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
      if (kind === 'date') { const d = tail.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); return d ? parseDate(d[0]) : null; }
      const n = tail.match(/-?\$?\s?[\d,]+(?:\.\d+)?/);
      return n ? parseMoney(n[0]) : NaN;
    };
    const sym = t.match(/\b(?:Symbol|Security)\W{0,3}\s*([A-Z]{1,5})\b/);
    return {
      symbol: sym ? sym[1] : '',
      dateSold: near(/Trade\s*Date/i, 'date'),
      qty: near(/(?:Quantity|Shares)(?:\s*Sold)?/i, 'num'),
      proceedsUsd: near(/Net\s*(?:Amount|Proceeds)/i, 'num'),
      feesUsd: (near(/Commission/i, 'num') || 0) + (near(/(?:SEC|Transaction|Supplemental)\s*Fee/i, 'num') || 0),
    };
  }

  // ---------------------------------------------------------------- sale simulator

  /** Turn a holding (per-share values) into a lot sold at `price` on `date`. */
  function holdingToLot(h, { qty, price, date }) {
    const q = isFinite(qty) ? qty : h.qty;
    return {
      symbol: h.symbol, planType: h.planType, qty: q, dateAcquired: h.dateAcquired, grantDate: h.grantDate, dateSold: date,
      proceedsUsd: round2(price * q), costUsd: round2(h.costPerShare * q),
      paidUsd: isFinite(h.paidPerShare) ? round2(h.paidPerShare * q) : NaN, avg30: h.avg30, feesUsd: 0, sec102: h.sec102,
    };
  }

  /**
   * Simulate selling a holding. Returns the capital and work-income parts, the
   * estimated taxes and the net amount, plus (for an early 102 sale) the same
   * sale on the unlock date at the same price and rate.
   * @param {object} o {qty, price, date, rate, is102, rates, prices, settings}
   */
  function simulateHolding(h, o) {
    const run = date => {
      const lot = holdingToLot(h, { qty: o.qty, price: o.price, date });
      const overrides = { rateSell: o.rate };
      const calc = o.is102 ? computeLot102(lot, o.rates, overrides, { prices: o.prices }) : computeLot(lot, o.rates, overrides);
      if (!calc.ok) return { ok: false, issues: calc.issues, lot };
      const wTax = o.is102 ? workTax(calc.workIls, o.settings) : 0;
      const proceedsIls = roundILS(lot.proceedsUsd * calc.sell.rate);
      return { ok: true, lot, calc, workTax: wTax, capTax: calc.tax, net: proceedsIls - wTax - calc.tax, proceedsIls };
    };
    const now = run(o.date);
    if (!now.ok || !o.is102 || !now.calc.early) return { now };
    return { now, later: run(now.calc.unlock) };
  }

  function normalizePlan(v) {
    const s = String(v || '').trim().toUpperCase();
    if (!s) return '';
    if (s.includes('ESPP')) return 'ESPP';
    if (s === 'RS' || s.includes('RSU') || s.includes('RESTRICTED')) return 'RSU';
    if (s.includes('OPTION') || s === 'SO' || s === 'NQ' || s === 'ISO') return 'Options';
    return s;
  }

  return {
    TAX_RATE, parseDate, formatDateIL, addDays, addMonths, halfOfYear, parseMoney, round2, roundILS,
    lookupRate, computeLot, summarize, parseEtradeRows, mapHeaders, normalizePlan,
    CHECK_THRESHOLDS, crossCheck, nyToUtcEpoch, intradayAt,
    closedFormReal, isValidIsraeliId, parseOrderText, SCENARIO_TEXT,
    makeBackup, parseBackup, mergeLots, lotKey, cleanHolding,
    avgCloseBefore, lastClose, HOLDING_MONTHS, WORK_DEFAULTS, allocationDate, unlockDate, computeLot102, workTax,
    parseHoldingsRows, holdingToLot, simulateHolding, parseGainsText, parseSaleHints, bestGainsParse, snapSymbol,
    ESPP_DISCOUNT, offeringStart, lookbackPrice, priceOn, evaluateLot, whatIfLots,
  };
});
