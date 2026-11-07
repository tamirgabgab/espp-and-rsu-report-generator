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
  };

  // ---------------------------------------------------------------- backup / restore

  const BACKUP_APP = 'espp-rsu-1399';
  const LOT_FIELDS = ['symbol', 'planType', 'qty', 'dateAcquired', 'dateSold', 'timeSold', 'proceedsUsd', 'costUsd', 'feesUsd', 'sec102', 'rateBuy', 'rateSell', 'order'];
  const PROFILE_FIELDS = ['name', 'belonging', 'place', 'sec102', 'signDate']; // never the ID number

  const numOrNaN = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

  function cleanLot(raw) {
    const lot = {};
    for (const k of LOT_FIELDS) lot[k] = raw && raw[k] !== undefined ? raw[k] : '';
    for (const k of ['qty', 'proceedsUsd', 'costUsd']) lot[k] = numOrNaN(lot[k]);
    lot.feesUsd = isFinite(numOrNaN(lot.feesUsd)) ? numOrNaN(lot.feesUsd) : 0;
    lot.sec102 = lot.sec102 === true || lot.sec102 === false ? lot.sec102 : null;
    lot.symbol = String(lot.symbol || '').toUpperCase();
    for (const k of ['dateAcquired', 'dateSold']) lot[k] = parseDate(lot[k]) || '';
    for (const k of ['planType', 'timeSold', 'rateBuy', 'rateSell', 'order']) lot[k] = lot[k] === null ? '' : String(lot[k]);
    return lot;
  }

  /** Build the backup object (JSON-serialisable). The ID number is never included. */
  function makeBackup(profile, lots, now = new Date()) {
    const prof = {};
    for (const k of PROFILE_FIELDS) if (profile && profile[k] !== undefined) prof[k] = profile[k];
    return {
      app: BACKUP_APP, version: 1, exportedAt: now.toISOString(),
      profile: prof,
      lots: lots.map(l => { const o = {}; for (const k of LOT_FIELDS) o[k] = isFinite(l[k]) || typeof l[k] !== 'number' ? l[k] : null; return o; }),
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
    return { lots: data.lots.map(cleanLot), profile, exportedAt: data.exportedAt || null };
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
        timeSold: '',
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
    CHECK_THRESHOLDS, crossCheck, nyToUtcEpoch, intradayAt,
    closedFormReal, isValidIsraeliId, parseOrderText, SCENARIO_TEXT,
    makeBackup, parseBackup, mergeLots, lotKey,
  };
});
