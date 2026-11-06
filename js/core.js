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

  /** Aggregate computed lots into half-year and yearly totals with loss offset. */
  function summarize(items) {
    const groups = new Map();
    const add = (key, label, it) => {
      if (!groups.has(key)) groups.set(key, { key, label, gains: 0, losses: 0, proceedsIls: 0, costIls: 0, nominal: 0, inflationary: 0, count: 0 });
      const g = groups.get(key);
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
      lots.push({
        symbol: String(get('symbol') || '').trim().toUpperCase(),
        planType: normalizePlan(get('planType')),
        qty: parseMoney(get('qty')),
        dateAcquired: parseDate(get('dateAcquired')),
        dateSold,
        proceedsUsd: parseMoney(get('proceedsUsd')),
        costUsd: cost,
        feesUsd: 0,
        order: get('order') !== undefined ? String(get('order')).trim() : '',
      });
    }
    if (!lots.length) warnings.push('לא נמצאו שורות מכירה בקובץ');
    return { lots, warnings };
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
    TAX_RATE, parseDate, formatDateIL, addDays, halfOfYear, parseMoney, round2, roundILS,
    lookupRate, computeLot, summarize, parseEtradeRows, mapHeaders, normalizePlan,
  };
});
