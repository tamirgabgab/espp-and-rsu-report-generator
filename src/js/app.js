/* UI: state, import, lot list + edit drawer, explanations, summary, chart, export. */
(function () {
  'use strict';
  const Core = window.Core;
  const RATES = (window.USD_ILS_RATES && window.USD_ILS_RATES.rates) || {};
  const SECONDARY = window.USD_ILS_SECONDARY || {};
  const PRICES = window.STOCK_PRICES || {};
  const SOURCES = { boi: RATES, ecb: SECONDARY.ecb && SECONDARY.ecb.rates, yahoo: SECONDARY.yahoo && SECONDARY.yahoo.rates };
  const LS_PROFILE = 'f1399.profile';
  const LS_LOTS = 'f1399.lots';
  const FORM_URL = 'assets/forms/form-1399y-2025-blank.pdf';
  const FONT_URL = 'assets/fonts/NotoSansHebrew_400Regular.ttf';
  const $ = sel => document.querySelector(sel);

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };

  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (isFinite(n) ? (n < 0 ? `(${Math.abs(n).toLocaleString('en-US')})` : n.toLocaleString('en-US')) : '');
  const ils = n => `${fmt(n)} ₪`;
  const usd = n => (isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const signed = n => (n < 0 ? `−${Math.abs(n).toLocaleString('en-US')}` : n.toLocaleString('en-US'));
  const L = s => `<bdi class="ltr">${s}</bdi>`; // isolate a left-to-right formula inside Hebrew text
  let nextId = 1;

  // ------------------------------------------------------------ state

  // The ID number is sensitive: it lives only in memory and is never written to storage.
  const profile = Object.assign({ name: '', belonging: '2', place: 'israel', sec102: true, signDate: '', ...Core.WORK_DEFAULTS }, store.get(LS_PROFILE, {}), { idNumber: '' });
  // JSON turns NaN into null: bring missing numbers back as NaN so isFinite() checks work.
  const NUM_FIELDS = ['qty', 'proceedsUsd', 'costUsd', 'paidUsd', 'withheldIls'];
  const revive = l => { const o = { ...l }; for (const k of NUM_FIELDS) if (o[k] === null || o[k] === '' || o[k] === undefined) o[k] = NaN; if (!isFinite(o.feesUsd)) o.feesUsd = 0; return o; };
  let lots = store.get(LS_LOTS, []).map(l => ({ ...revive(l), id: nextId++ }));
  let yearFilter = 'all';
  let lastImport = null; // {name, buf}: the E*Trade file imported in this session (memory only, for the ZIP)
  const openPanels = new Set();

  const blankLot = () => ({ id: nextId++, symbol: '', planType: 'ESPP', qty: NaN, dateAcquired: '', dateSold: '', timeSold: '', proceedsUsd: NaN, costUsd: NaN, feesUsd: 0, sec102: null, rateBuy: '', rateSell: '', order: '', grantDate: '', paidUsd: NaN, avg30: '', withheldIls: NaN, offerStart: '', discountPct: '' });

  const EXAMPLE = [
    { symbol: 'QCOM', planType: 'ESPP', qty: 17, dateAcquired: '2024-01-31', dateSold: '2026-05-11', timeSold: '11:02', proceedsUsd: 3938.96, costUsd: 2524.67, paidUsd: 2145.97, feesUsd: 0 },
  ];

  function persist() {
    const { idNumber, ...safeProfile } = profile; // never store the ID number
    store.set(LS_PROFILE, safeProfile);
    store.set(LS_LOTS, lots.map(({ id, ...rest }) => rest));
  }

  const sortLots = () => lots.sort((a, b) => (a.dateSold || '9').localeCompare(b.dateSold || '9') || (a.dateAcquired || '').localeCompare(b.dateAcquired || ''));
  const yearOf = lot => (lot.dateSold ? lot.dateSold.slice(0, 4) : '');
  const sec102Of = lot => (lot.sec102 === null || lot.sec102 === undefined ? !!profile.sec102 : !!lot.sec102);

  /** Section 102 (trustee, capital track) applies to ESPP and RSU lots marked 102. */
  const is102Lot = lot => sec102Of(lot) && (lot.planType === 'ESPP' || lot.planType === 'RSU');

  /**
   * calc: the capital-gain calculation (plus the work-income part for 102 lots).
   * capLot: the lot as it goes on the form (for 102: cost = paid + work income, dated at the allocation).
   */
  function computeItem(lot) {
    const overrides = { rateBuy: lot.rateBuy, rateSell: lot.rateSell };
    const is102 = is102Lot(lot);
    const calc = is102 ? Core.computeLot102(lot, RATES, overrides, { prices: PRICES }) : Core.computeLot(lot, RATES, overrides);
    const capLot = is102 && calc.ok && !calc.noForm ? { ...lot, dateAcquired: calc.costDate, costUsd: calc.capCostUsd } : lot;
    const workTax = calc.ok ? Core.workTax(calc.workIls || 0, profile) : 0;
    const checks = [calc.noForm ? '' : capLot.dateAcquired, lot.dateSold].filter(Boolean).map(d => Core.crossCheck(SOURCES, d));
    return { lot, capLot, calc, is102, workTax, checks, rateWarn: checks.some(c => c.warn) };
  }
  const formItems = ok => ok.filter(it => !it.calc.noForm);

  /** Lots in the current year filter (lots without a sale date stay visible so they can be fixed). */
  function visibleItems() {
    return lots.filter(l => yearFilter === 'all' || !l.dateSold || yearOf(l) === yearFilter).map(computeItem);
  }

  // ------------------------------------------------------------ toasts

  function toast(text, action) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(text)}</span>`;
    let timer;
    const close = () => { clearTimeout(timer); el.remove(); };
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); close(); });
      el.appendChild(b);
    }
    host.appendChild(el);
    timer = setTimeout(close, action ? 7000 : 3500);
  }

  // ------------------------------------------------------------ render all

  function render() {
    sortLots();
    const items = visibleItems();
    renderYearFilter();
    renderLots(items);
    const ok = items.filter(it => it.calc.ok);
    const groups = Core.summarize(ok);
    renderHero(ok, groups);
    renderSummary(groups);
    renderChart();
    renderExportScope(ok, items.length - ok.length);
    persist();
  }

  // ------------------------------------------------------------ year filter

  function renderYearFilter() {
    const years = [...new Set(lots.map(yearOf).filter(Boolean))].sort();
    if (yearFilter !== 'all' && !years.includes(yearFilter)) yearFilter = 'all';
    const host = $('#year-filter');
    host.hidden = years.length < 2;
    host.innerHTML = ['all', ...years].map(y => `<button type="button" class="chip" role="radio" aria-checked="${y === yearFilter}" tabindex="${y === yearFilter ? 0 : -1}" data-year="${y}">${y === 'all' ? 'כל השנים' : y}</button>`).join('');
    $('#clear-all').hidden = lots.length === 0;
    $('#toolbar').hidden = lots.length === 0;
  }

  // ------------------------------------------------------------ lots

  function statusBadge(it) {
    if (!it.calc.ok) return '<span class="badge badge-warn" title="חסרים נתונים">⚠ חסר</span>';
    if (it.calc.early) return '<span class="badge badge-info" title="נמכר לפני תום 24 החודשים אצל הנאמן: כל הרווח במס שולי, בלי טופס 1399">מס שולי</span>';
    if (it.rateWarn) return '<span class="badge badge-warn" title="סטייה חריגה בין מקורות השער">⚠ שער</span>';
    return '<span class="badge badge-ok" title="החישוב תקין והשערים תואמים">✓ תקין</span>';
  }

  const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function lotActions(it, compact) {
    const id = it.lot.id;
    const open = openPanels.has(id);
    return `<button type="button" class="btn-link" data-act="explain" data-id="${id}" aria-expanded="${open}">${open ? 'הסתרת החישוב' : 'הצגת החישוב'}</button>
      <span class="${compact ? 'right' : ''}">
        <button type="button" class="icon-btn" data-act="edit" data-id="${id}" aria-label="עריכת העסקה" data-tip="עריכת העסקה">${ICON_EDIT}</button>
        <button type="button" class="icon-btn danger" data-act="delete" data-id="${id}" aria-label="מחיקת העסקה" data-tip="מחיקת העסקה">${ICON_DEL}</button>
      </span>`;
  }

  function renderLots(items) {
    const body = $('#lots-body');
    const cards = $('#lots-cards');
    $('#empty-state').hidden = lots.length > 0;
    $('#lots-hint').hidden = lots.length === 0;
    document.querySelector('.lots-desktop').hidden = lots.length === 0;

    body.innerHTML = items.map(it => {
      const { lot, calc } = it;
      const realCls = calc.ok ? (calc.real > 0 ? 'gain' : calc.real < 0 ? 'loss' : '') : '';
      const row = `<tr class="lot-row" data-id="${lot.id}">
        <td>${statusBadge(it)}</td>
        <td><span class="sym">${esc(lot.symbol || '—')}</span><span class="plan">${esc(lot.planType || '')}${it.is102 ? ' · 102' : ''}</span></td>
        <td class="num">${isFinite(lot.qty) ? lot.qty : ''}</td>
        <td>${Core.formatDateIL(lot.dateAcquired) || '—'}</td>
        <td>${Core.formatDateIL(lot.dateSold) || '—'}</td>
        <td class="num">${usd(lot.proceedsUsd)}</td>
        <td class="num">${usd(lot.costUsd)}</td>
        <td class="num ${realCls}">${calc.ok ? (calc.noForm ? '—' : fmt(calc.real)) : ''}${workLine(it)}</td>
        <td class="num">${calc.ok ? fmt(calc.tax) : ''}</td>
        <td class="actions-cell">${lotActions(it, false)}</td>
      </tr>`;
      const panel = openPanels.has(lot.id) ? `<tr class="panel-row"><td colspan="10">${panelHtml(it)}</td></tr>` : '';
      return row + panel;
    }).join('');

    cards.innerHTML = items.map(it => {
      const { lot, calc } = it;
      const realCls = calc.ok ? (calc.real > 0 ? 'gain' : calc.real < 0 ? 'loss' : '') : '';
      const qty = isFinite(lot.qty) ? ` · ${lot.qty} מניות` : '';
      const plan = lot.planType ? ` · <bdi>${esc(lot.planType)}${it.is102 ? ' 102' : ''}</bdi>` : '';
      return `<article class="lot-card ${calc.ok ? '' : 'has-issue'}" data-id="${lot.id}">
        <div class="lc-head">
          <div class="lc-title"><span class="sym">${esc(lot.symbol || '—')}</span><span class="plan">${plan}${qty}</span></div>
          ${statusBadge(it)}
        </div>
        <div class="lc-dates">נקנו ${Core.formatDateIL(lot.dateAcquired) || '—'} · נמכרו ${Core.formatDateIL(lot.dateSold) || '—'}${lot.timeSold ? ` <bdi>${esc(lot.timeSold)}</bdi>` : ''}</div>
        ${calc.ok ? `<div class="lc-metrics">
          <div class="lc-metric"><div class="k">רווח ריאלי</div><div class="v ${realCls}">${ils(calc.real)}</div></div>
          <div class="lc-metric"><div class="k">מס משוער</div><div class="v">${ils(calc.tax)}</div></div>
          ${calc.workIls > 0 ? `<div class="lc-metric"><div class="k">הכנסת עבודה (102)</div><div class="v">${ils(calc.workIls)}</div></div>
          <div class="lc-metric"><div class="k">מס שולי משוער</div><div class="v">${ils(it.workTax)}</div></div>` : ''}
        </div>` : `<ul class="lc-issues">${calc.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`}
        <div class="lc-actions">${lotActions(it, true)}</div>
        ${openPanels.has(lot.id) ? panelHtml(it) : ''}
      </article>`;
    }).join('');

    // Intraday rates are loaded lazily, only for open panels.
    for (const it of items) if (openPanels.has(it.lot.id)) { fillIntraday(it); mountWhatIf(it); }
  }

  /** Small second line in the table: the work-income part of a 102 lot. */
  const workLine = it => (it.calc.ok && it.calc.workIls > 0 ? `<span class="cell-sub">עבודה ${fmt(it.calc.workIls)}</span>` : '');

  // ------------------------------------------------------------ "how was it calculated" panel

  /**
   * The "how was it calculated" panel: one compact table ($ × rate = ₪), a few
   * result lines, the "what if" stock chart and the rate cross-check. The full
   * step-by-step version lives in the formulas tab; the general method in the
   * explanation tab.
   */
  function panelHtml(it) {
    const { calc } = it;
    const lot = it.capLot;
    const D = Core.formatDateIL;
    if (!calc.ok) {
      return `<div class="panel"><h3>חסרים נתונים לחישוב</h3>
        <ul class="lc-issues">${calc.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="actions"><button type="button" class="btn btn-sm" data-act="edit" data-id="${it.lot.id}">השלמת הנתונים</button></div></div>`;
    }
    const rs = calc.sell.rate;
    const fees = isFinite(it.lot.feesUsd) ? it.lot.feesUsd : 0;
    const rateCell = r => (r ? `<bdi class="ltr">${r.rate}</bdi> <span class="muted">${D(r.date)}${r.manual ? ', ידני' : ''}</span>` : '—');
    const row = (label, usdVal, rate, ilsVal, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th><td class="num">${isFinite(usdVal) ? usd(usdVal) : '—'}</td><td>${rate}</td><td class="num">${isFinite(ilsVal) ? fmt(ilsVal) : '—'}</td></tr>`;
    const rows = [];
    const results = [];
    const mRate = (+profile.marginalRate || 0) + (profile.includeNi ? +profile.niRate || 0 : 0);
    if (it.is102) {
      const vLabel = calc.baseSource === 'avg30' ? `שווי ההטבה <span class="muted">(ממוצע 30 יום: ${calc.avg.avg} × ${it.lot.qty})</span>`
        : calc.baseSource === 'manual' ? 'שווי ההטבה <span class="muted">(ממוצע 30 יום, ידני)</span>' : 'שווי ההטבה <span class="muted">(ביום הרכישה)</span>';
      if (!calc.early) rows.push(row(vLabel, calc.baseUsd, '', NaN));
      rows.push(row(`שולם${calc.paidKnown ? '' : ' <span class="muted">(חסר, נחשב כ‑0 הנחה)</span>'}`, calc.paidUsd, '', NaN));
      rows.push(row(`הכנסת עבודה${calc.early ? ' <span class="muted">(כל הרווח)</span>' : ''}`, calc.workUsd, rateCell(calc.sell), calc.workIls, 'hl'));
    }
    if (!calc.noForm) {
      rows.push(row('תמורה', lot.proceedsUsd, rateCell(calc.sell), calc.proceedsIls));
      rows.push(row(it.is102 ? 'עלות לרווח ההון <span class="muted">(שולם + הכנסת עבודה)</span>' : 'עלות', lot.costUsd, rateCell(calc.buy), calc.costIls));
      if (fees) rows.push(row('עמלות', fees, rateCell(calc.sell), calc.feesIls));
      const cf = Core.closedFormReal(lot, calc.buy.rate, rs);
      const A = Core.roundILS(cf.A);
      const rule = cf.A >= 0 && cf.B >= 0 ? 'הקטן מביניהם' : cf.A <= 0 && cf.B <= 0 ? 'ההפסד הקטן מביניהם' : 'סימנים שונים, ולכן 0';
      results.push(`<dt>רווח נומינלי בשקלים</dt><dd>${ils(calc.nominal)}</dd>`);
      results.push(`<dt>רווח בדולרים, בשער המכירה</dt><dd>${ils(A)}</dd>`);
      results.push(`<dt>רווח ריאלי <span class="muted">(${rule})</span></dt><dd class="big ${calc.real > 0 ? 'gain' : calc.real < 0 ? 'loss' : ''}">${ils(calc.real)}</dd>`);
      results.push(`<dt>מס רווח הון 25% <span class="muted">(לפני קיזוז)</span></dt><dd class="big">${ils(calc.tax)}</dd>`);
    }
    if (it.is102) results.push(`<dt>מס שולי משוער ${mRate}% <span class="muted">(הנאמן מנכה)</span></dt><dd class="big">${ils(it.workTax)}</dd>`);
    const notes = [];
    if (it.is102) notes.push(calc.early ? Core.SCENARIO_TEXT['early-102'] : `מסלול 102: הקצאה ב‑${D(calc.alloc)}, ומכירה במסלול ההוני מ‑${D(calc.unlock)}. הכנסת העבודה לא נכנסת לטופס 1399.`);
    if (!calc.noForm) notes.push(Core.SCENARIO_TEXT[calc.scenario] || '');
    if (isFinite(it.lot.withheldIls)) {
      const est = it.workTax + calc.tax, diff = it.lot.withheldIls - est;
      notes.push(`הנאמן ניכה ${ils(it.lot.withheldIls)}, וההערכה כאן ${ils(est)}. ההפרש ${signed(diff)} ₪${Math.abs(diff) > Math.max(100, est * 0.05) ? ', יותר מ‑5%: כדאי לבדוק את שיעור המס השולי עם הנאמן.' : ', בטווח הסביר.'}`);
    }
    return `<div class="panel">
      <div class="table-scroll"><table class="mini-table calc-table">
        <thead><tr><th scope="col"></th><th scope="col">$</th><th scope="col">שער</th><th scope="col">₪</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
      <dl class="calc-results">${results.join('')}</dl>
      ${notes.map(n => `<p class="case">${esc(n)}</p>`).join('')}
      <div class="panel-links">
        <button type="button" class="btn-link" data-act="to-formulas" data-id="${it.lot.id}">כל השלבים עם הנוסחאות</button>
        <button type="button" class="btn-link" data-act="to-explain" data-id="${it.lot.id}">איך מחושב המס?</button>
      </div>
      ${PRICES[it.lot.symbol] && (it.lot.planType === 'ESPP' || it.lot.planType === 'RSU') ? `<h3>מחיר המניה: מה היה קורה אילו…</h3><div class="wi" data-wi="${it.lot.id}"></div>` : ''}
      <h3>בקרת שערים</h3>
      ${checksTable(it)}
      <p class="intraday" data-intraday="${it.lot.id}">${it.lot.timeSold ? '' : 'כדי לראות את שער השוק בדקת המכירה, מוסיפים את שעת המכירה בעריכת העסקה.'}</p>
    </div>`;
  }

  function checksTable(it) {
    const lot = it.capLot;
    const cell = c => {
      if (!c || !c.rate) return '<td>—</td>';
      const dev = c.devPct === null ? '' : `<span class="dev">${c.devPct > 0 ? '+' : ''}${c.devPct.toFixed(2)}%</span>`;
      return `<td class="${c.warn ? 'warn-cell' : ''}"><bdi class="ltr">${c.rate}</bdi>${dev}</td>`;
    };
    const rows = [[it.is102 ? 'הקצאה' : 'רכישה', it.calc.noForm ? '' : lot.dateAcquired], ['מכירה', lot.dateSold]].filter(([, d]) => d).map(([label, d]) => {
      const cc = Core.crossCheck(SOURCES, d);
      return `<tr><th scope="row">${label} ${Core.formatDateIL(d)}</th><td><bdi class="ltr">${cc.boi ? cc.boi.rate : '—'}</bdi></td>${cell(cc.checks.ecb)}${cell(cc.checks.yahoo)}</tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="mini-table">
      <thead><tr><th></th><th>בנק ישראל (בטופס)</th><th>ECB</th><th>Yahoo</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="hint">בסוגריים הקטנים: הסטייה מבנק ישראל. מסומן בצהוב מעל ${Core.CHECK_THRESHOLDS.ecb}% ב‑ECB או מעל ${Core.CHECK_THRESHOLDS.yahoo}% ב‑Yahoo.</p>`;
  }

  // ------------------------------------------------------------ "what if" stock chart (src/js/whatif.js)

  const whatIfState = new Map(); // lot id -> moved dates, kept while the page is open

  function mountWhatIf(it) {
    if (!window.WhatIf) return;
    for (const el of document.querySelectorAll(`[data-wi="${it.lot.id}"]`)) {
      window.WhatIf.mount(el, {
        lot: it.lot, is102: it.is102,
        state: whatIfState.get(it.lot.id),
        onState: st => { if (st) whatIfState.set(it.lot.id, st); else whatIfState.delete(it.lot.id); },
      });
    }
  }

  // ------------------------------------------------------------ intraday

  const jsonCache = new Map();
  const loadJson = url => {
    if (!jsonCache.has(url)) jsonCache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));
    return jsonCache.get(url);
  };

  async function intradayRate(lot) {
    const epoch = Core.nyToUtcEpoch(lot.dateSold, lot.timeSold);
    if (epoch === null) return null;
    const idx = (await loadJson('data/rates/intraday/index.json')) || { minute: [], hourly: [] };
    const month = new Date(epoch * 1000).toISOString().slice(0, 7), year = month.slice(0, 4);
    if (idx.minute.includes(month)) {
      const r = Core.intradayAt(await loadJson(`data/rates/intraday/minute/${month}.json`), epoch, 5);
      if (r) return { ...r, kind: 'דקה' };
    }
    if (idx.hourly.includes(year)) {
      const r = Core.intradayAt(await loadJson(`data/rates/intraday/hourly/${year}.json`), epoch, 1);
      if (r) return { ...r, kind: 'שעה' };
    }
    return { missing: true, firstMinute: idx.minute[0] };
  }

  async function fillIntraday(it) {
    const { lot, calc } = it;
    if (!lot.timeSold || !calc.ok) return;
    const t = setTimeout(() => {
      for (const el of document.querySelectorAll(`[data-intraday="${lot.id}"]`)) if (!el.textContent) el.textContent = 'טוען את השער בשעת המכירה…';
    }, 100);
    const ir = await intradayRate(lot);
    clearTimeout(t);
    for (const el of document.querySelectorAll(`[data-intraday="${lot.id}"]`)) {
      if (!ir || ir.missing) {
        el.textContent = `אין נתוני דקה או שעה לשעה ${lot.timeSold} בתאריך הזה (ארכיון הדקות מתחיל ב‑${ir && ir.firstMinute ? ir.firstMinute : '?'}, נתוני שעה כשנתיים אחורה).`;
        continue;
      }
      const diff = (ir.rate / calc.sell.rate - 1) * 100;
      const effect = Core.roundILS(lot.proceedsUsd * (ir.rate - calc.sell.rate));
      const utc = new Date(ir.ts * 1000).toISOString().slice(11, 16);
      el.innerHTML = `שער השוק בשעת המכירה (${esc(lot.timeSold)} שעון ניו יורק, דיוק של ${ir.kind}, נכון ל‑<bdi class="ltr">${utc} UTC</bdi>): <b><bdi class="ltr">${ir.rate.toFixed(4)}</bdi></b>.
        הפרש מהשער היציג: <bdi class="ltr">${diff > 0 ? '+' : ''}${diff.toFixed(2)}%</bdi>, כלומר <bdi class="ltr">${signed(effect)} ₪</bdi> בתמורה. לבקרה בלבד, בטופס נשאר השער היציג.`;
    }
  }

  // ------------------------------------------------------------ hero + sticky

  function dueDate(key) {
    const [y, h] = key.split('-H');
    return h === '1' ? `${y}-07-31` : `${+y + 1}-01-31`;
  }

  function renderHero(ok, groups) {
    const hero = $('#hero');
    const sticky = $('#sticky');
    const show = ok.length > 0;
    hero.hidden = !show;
    sticky.hidden = !show || currentView !== 'report';
    document.body.classList.toggle('has-sticky', show && currentView === 'report');
    if (!show) return;
    const years = groups.filter(g => g.isYear);
    const halves = groups.filter(g => !g.isYear);
    const net = years.reduce((a, g) => a + g.net, 0);
    const tax = years.reduce((a, g) => a + g.tax, 0);
    const scope = yearFilter === 'all' ? (years.length > 1 ? `${years.length} שנות מס` : `שנת ${years[0].key}`) : `שנת ${yearFilter}`;

    const netEl = $('#t-net');
    netEl.textContent = ils(net);
    netEl.className = `tile-value ${net > 0 ? 'gain' : net < 0 ? 'loss' : ''}`;
    $('#t-net-sub').textContent = `${scope}, אחרי קיזוז הפסדים`;
    $('#t-tax').textContent = ils(tax);
    const workTaxAll = ok.reduce((a, it) => a + it.workTax, 0);
    $('#t-tax-sub').textContent = workTaxAll > 0 ? `ועוד כ‑${ils(workTaxAll)} מס שולי על הכנסת עבודה (102)`
      : years.some(g => g.carryLoss < 0) ? 'יש הפסד להעברה לשנה הבאה' : 'לפני מס יסף, אם חל';

    const upcoming = halves.map(g => ({ g, due: dueDate(g.key) })).filter(x => x.due >= today()).sort((a, b) => a.due.localeCompare(b.due))[0];
    if (upcoming) {
      $('#t-due').textContent = upcoming.g.tax > 0 ? ils(upcoming.g.tax) : 'אין לתשלום';
      $('#t-due-sub').textContent = `עד ${Core.formatDateIL(upcoming.due)} · ${upcoming.g.label}`;
    } else {
      $('#t-due').textContent = '—';
      $('#t-due-sub').textContent = 'מועדי המקדמה של המכירות האלה כבר עברו';
    }
    $('#t-count').textContent = String(ok.length);
    const early = ok.filter(it => it.calc.noForm).length;
    const bad = visibleItems().length - ok.length;
    $('#t-count-sub').textContent = bad ? `ועוד ${bad} שצריך להשלים` : early ? `${early} מהן לפני תום 24 החודשים (בלי טופס)` : 'כל העסקאות תקינות';

    $('#s-net').textContent = ils(net);
    $('#s-tax').textContent = ils(tax);
  }

  // ------------------------------------------------------------ summary

  function renderSummary(groups) {
    const host = $('#summary');
    if (!groups.length) { host.innerHTML = '<p class="hint">הסיכום יופיע אחרי שתהיה לפחות עסקה אחת תקינה.</p>'; return; }
    host.innerHTML = groups.map(g => `
      <div class="sum-card ${g.isYear ? 'year' : ''}">
        <h3>${esc(g.label)}</h3>
        <dl>
          <dt>מכירות</dt><dd>${g.count}</dd>
          <dt>תמורה ₪</dt><dd>${fmt(g.proceedsIls)}</dd>
          <dt>רווחים ריאליים ₪</dt><dd>${fmt(g.gains)}</dd>
          <dt>הפסדים לקיזוז ₪</dt><dd>${fmt(g.losses)}</dd>
          <dt>רווח ריאלי נטו ₪</dt><dd>${fmt(g.net)}</dd>
          <dt>מס משוער 25% ₪</dt><dd class="big">${fmt(g.tax)}</dd>
          ${g.workIls > 0 ? `<dt>הכנסת עבודה (102) ₪</dt><dd>${fmt(g.workIls)}</dd><dt>מס שולי משוער ₪</dt><dd>${fmt(Core.workTax(g.workIls, profile))}</dd>` : ''}
        </dl>
        ${g.isYear ? (g.carryLoss < 0 ? `<div class="due">הפסד להעברה לשנה הבאה: ${ils(g.carryLoss)}</div>` : '') : `<div class="due">מקדמה בדוח חצי‑שנתי עד ${Core.formatDateIL(dueDate(g.key))}</div>`}
      </div>`).join('');
  }

  // ------------------------------------------------------------ general explanation

  // ------------------------------------------------------------ chart

  function renderChart() {
    const markers = [];
    for (const l of lots) {
      if (yearFilter !== 'all' && yearOf(l) !== yearFilter) continue;
      const name = `${esc(l.symbol || '')} ${esc(l.planType || '')}`.trim();
      if (l.dateAcquired) markers.push({ date: l.dateAcquired, type: 'buy', label: `רכישה: ${name}` });
      if (l.dateSold) markers.push({ date: l.dateSold, type: 'sell', label: `מכירה: ${name}` });
    }
    window.RateChart.renderRateChart($('#chart'), RATES, markers, $('#tooltip'));
    const meta = window.USD_ILS_RATES;
    $('#rates-meta').textContent = meta
      ? `מקור: בנק ישראל, שער יציג. ${meta.count} ימי פרסום, עד ${Core.formatDateIL(meta.last)}. השערים מתעדכנים פעם בשבוע.`
      : 'קובץ השערים לא נטען.';
  }

  // ------------------------------------------------------------ edit drawer

  const dlg = $('#lot-dialog');
  const form = $('#lot-form');
  let editingId = null;
  const F = name => form.elements[name];

  function openEditor(id, prefill) {
    clearTimeout(draftTimer); // a pending save belongs to the previous session
    const lot = id ? lots.find(l => l.id === id) : { ...blankLot(), ...(prefill || {}) };
    editingId = id || null;
    $('#lot-dialog-title').textContent = id ? 'עריכת עסקה' : 'עסקה חדשה';
    for (const k of ['symbol', 'planType', 'dateAcquired', 'dateSold', 'timeSold', 'rateBuy', 'rateSell', 'grantDate', 'avg30', 'offerStart', 'discountPct']) F(k).value = lot[k] ?? '';
    for (const k of ['qty', 'proceedsUsd', 'costUsd', 'feesUsd', 'paidUsd', 'withheldIls']) F(k).value = isFinite(lot[k]) ? lot[k] : '';
    F('sec102').checked = sec102Of(lot);
    $('#f-paste').value = '';
    $('#f-paste-note').textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
    updateRatePlaceholders();
    updatePlanFields();
    form.querySelector('.advanced').open = !!(lot.rateBuy || lot.rateSell);
    initialSnapshot = JSON.stringify(readForm());
    showDraftBanner();
    dlg.showModal();
    setTimeout(() => (id ? F('dateSold') : F('symbol')).focus(), 30);
  }

  // ------------------------------------------------------------ editor drafts (lot data only, never the ID number)

  const LS_DRAFT = 'f1399.draft';
  const DRAFT_FIELDS = ['symbol', 'planType', 'qty', 'dateAcquired', 'dateSold', 'timeSold', 'proceedsUsd', 'costUsd', 'feesUsd', 'rateBuy', 'rateSell', 'grantDate', 'paidUsd', 'avg30', 'withheldIls', 'offerStart', 'discountPct'];
  let initialSnapshot = '';
  let draftTimer;
  let savingLot = false;
  const draftKey = () => (editingId ? `lot-${editingId}` : 'new');
  const readForm = () => Object.fromEntries([...DRAFT_FIELDS.map(k => [k, F(k).value]), ['sec102', F('sec102').checked]]);

  function saveDraft() {
    const values = readForm();
    if (JSON.stringify(values) === initialSnapshot) { store.set(LS_DRAFT, null); return; }
    store.set(LS_DRAFT, { key: draftKey(), at: Date.now(), values });
  }

  function showDraftBanner() {
    const d = store.get(LS_DRAFT, null);
    const show = !!(d && d.key === draftKey() && d.values);
    $('#draft-banner').hidden = !show;
    if (show) {
      const t = new Date(d.at);
      const stamp = `${Core.formatDateIL(t.toISOString().slice(0, 10))}, ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      $('#draft-text').innerHTML = `יש טיוטה שלא נשמרה (<bdi class="ltr">${stamp}</bdi>).`;
    }
  }

  function restoreDraft() {
    const d = store.get(LS_DRAFT, null);
    if (!d || !d.values) return;
    for (const k of DRAFT_FIELDS) F(k).value = d.values[k] ?? '';
    F('sec102').checked = !!d.values.sec102;
    updateRatePlaceholders();
    updatePlanFields();
    $('#draft-banner').hidden = true;
    F('dateSold').focus();
  }

  function discardDraft() {
    store.set(LS_DRAFT, null);
    $('#draft-banner').hidden = true;
    F(editingId ? 'dateSold' : 'symbol').focus();
  }

  function updateRatePlaceholders() {
    const b = Core.lookupRate(RATES, F('dateAcquired').value);
    const s = Core.lookupRate(RATES, F('dateSold').value);
    F('rateBuy').placeholder = b ? `יציג: ${b.rate}` : 'אין שער יציג';
    F('rateSell').placeholder = s ? `יציג: ${s.rate}` : 'אין שער יציג';
  }

  const isRsu102Form = () => F('planType').value === 'RSU' && F('sec102').checked;

  /** Show the fields that matter for the plan type and track (ESPP / RSU, 102 or not). */
  function updatePlanFields() {
    const plan = F('planType').value;
    const s102 = F('sec102').checked && (plan === 'ESPP' || plan === 'RSU');
    $('#w-grantDate').hidden = plan !== 'RSU';
    $('#w-avg30').hidden = !(plan === 'RSU' && s102);
    $('#w-paidUsd').hidden = plan !== 'ESPP';
    $('#w-offerStart').hidden = plan !== 'ESPP';
    $('#w-discountPct').hidden = plan !== 'ESPP';
    $('#w-withheldIls').hidden = !s102;
    $('#l-dateAcquired').innerHTML = `${plan === 'RSU' ? 'תאריך הבשלה <bdi>(Vest)</bdi>' : 'תאריך רכישה'} <span class="req" aria-hidden="true">*</span>`;
    $('#l-costUsd').innerHTML = plan === 'RSU' && s102
      ? 'שווי ביום ההבשלה ($) <small>(לא חובה במסלול 102)</small>'
      : `עלות ($) <span class="req" aria-hidden="true">*</span> <small>${plan === 'RSU' ? 'השווי ביום ההבשלה' : 'Adjusted Cost Basis'}</small>`;
    $('#w-grantDate .req').hidden = !s102;
    // Show the automatic 30-day average as a hint.
    const note = $('#f-avg30-note');
    note.textContent = '';
    if (plan === 'RSU' && s102) {
      const sym = F('symbol').value.trim().toUpperCase();
      const a = F('grantDate').value ? Core.avgCloseBefore(PRICES[sym], F('grantDate').value) : null;
      F('avg30').placeholder = a ? `אוטומטי: ${a.avg}` : '';
      note.textContent = a ? `ממוצע הסגירה מ‑${Core.formatDateIL(a.from)} עד ${Core.formatDateIL(a.to)}. משאירים ריק כדי להשתמש בו.`
        : PRICES[sym] ? 'מזינים תאריך הענקה כדי לחשב את הממוצע.' : `אין מחירי מניה של ${sym || 'הנייר'} בכלי, ולכן צריך להזין את הממוצע מדוח הנאמן.`;
    }
  }

  const FIELD_RULES = {
    grantDate: v => (isRsu102Form() && !v ? 'צריך תאריך הענקה במסלול 102' : null),
    dateAcquired: v => (!v ? (F('planType').value === 'RSU' ? 'צריך תאריך הבשלה' : 'צריך תאריך רכישה') : null),
    dateSold: v => (!v ? 'צריך תאריך מכירה' : F('dateAcquired').value && v < F('dateAcquired').value ? 'תאריך המכירה מוקדם מתאריך הרכישה' : null),
    proceedsUsd: v => (v === '' ? 'צריך את התמורה בדולרים' : +v < 0 ? 'התמורה לא יכולה להיות שלילית' : null),
    costUsd: v => (v === '' && !isRsu102Form() ? 'צריך את העלות בדולרים' : +v < 0 ? 'העלות לא יכולה להיות שלילית' : null),
  };

  function validateField(name) {
    const el = F(name);
    const err = FIELD_RULES[name](el.value.trim());
    el.setAttribute('aria-invalid', err ? 'true' : 'false');
    const out = document.getElementById(`e-${name}`);
    if (out) out.textContent = err || '';
    return !err;
  }

  function saveEditor(ev) {
    ev.preventDefault();
    const results = Object.keys(FIELD_RULES).map(validateField);
    if (results.includes(false)) {
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    const num = k => (F(k).value === '' ? NaN : +F(k).value);
    const data = {
      symbol: F('symbol').value.trim().toUpperCase(), planType: F('planType').value, qty: num('qty'),
      dateAcquired: F('dateAcquired').value, dateSold: F('dateSold').value, timeSold: F('timeSold').value,
      proceedsUsd: num('proceedsUsd'), costUsd: num('costUsd'), feesUsd: isFinite(num('feesUsd')) ? num('feesUsd') : 0,
      sec102: F('sec102').checked === !!profile.sec102 ? null : F('sec102').checked,
      rateBuy: F('rateBuy').value, rateSell: F('rateSell').value,
      grantDate: F('grantDate').value, paidUsd: num('paidUsd'), avg30: F('avg30').value, withheldIls: num('withheldIls'),
      offerStart: F('offerStart').value, discountPct: F('discountPct').value,
    };
    let savedId = editingId;
    if (editingId) Object.assign(lots.find(l => l.id === editingId), data);
    else { const lot = { ...blankLot(), ...data }; lots.push(lot); savedId = lot.id; }
    if (yearFilter !== 'all' && data.dateSold.slice(0, 4) !== yearFilter) yearFilter = 'all';
    clearTimeout(draftTimer);
    store.set(LS_DRAFT, null);
    savingLot = true; // reset by the (asynchronous) close handler
    dlg.close();
    render();
    focusLot(savedId, 'edit');
    toast(editingId ? 'העסקה עודכנה' : 'העסקה נוספה');
  }

  function bindEditor() {
    form.addEventListener('submit', saveEditor);
    form.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); });
    form.addEventListener('change', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); });
    $('#draft-restore').addEventListener('click', restoreDraft);
    // Closing without saving (Esc, backdrop, Cancel) keeps whatever was typed as a draft.
    dlg.addEventListener('close', () => { clearTimeout(draftTimer); if (!savingLot) saveDraft(); savingLot = false; });
    $('#draft-discard').addEventListener('click', discardDraft);
    for (const name of Object.keys(FIELD_RULES)) {
      const el = F(name);
      el.addEventListener('blur', () => { if (el.value !== '' || el.getAttribute('aria-invalid')) validateField(name); });
      el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') validateField(name); });
    }
    F('dateAcquired').addEventListener('change', updateRatePlaceholders);
    for (const k of ['planType', 'sec102', 'grantDate']) F(k).addEventListener('change', updatePlanFields);
    F('symbol').addEventListener('change', updatePlanFields);
    F('dateSold').addEventListener('change', updateRatePlaceholders);
    F('symbol').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    $('#f-paste').addEventListener('input', e => {
      const { date, time } = Core.parseOrderText(e.target.value);
      const parts = [];
      if (date) { F('dateSold').value = date; parts.push(`תאריך ${Core.formatDateIL(date)}`); validateField('dateSold'); updateRatePlaceholders(); }
      if (time) { F('timeSold').value = time; parts.push(`שעה ${time}`); }
      $('#f-paste-note').textContent = parts.length ? `זוהו: ${parts.join(', ')}` : e.target.value ? 'לא זוהו תאריך או שעה בטקסט' : '';
    });
    for (const d of [dlg, $('#preview-dialog')]) {
      d.addEventListener('click', e => {
        if (e.target.closest('[data-close]') || e.target === d) d.close();
      });
    }
  }

  // ------------------------------------------------------------ lot actions

  function deleteLot(id) {
    const idx = lots.findIndex(l => l.id === id);
    if (idx === -1) return;
    const [removed] = lots.splice(idx, 1);
    openPanels.delete(id);
    render();
    // Keep keyboard users in place: focus the next lot (or the previous one, or the list heading).
    const visible = visibleItems().map(it => it.lot.id);
    const next = visible.find(v => lots.findIndex(l => l.id === v) >= idx) ?? visible[visible.length - 1];
    if (next !== undefined) focusLot(next, 'delete'); else $('#lots-title').focus();
    toast(`העסקה ${removed.symbol || ''} נמחקה`.replace('  ', ' '), { label: 'ביטול', run: () => { lots.splice(idx, 0, removed); render(); focusLot(removed.id, 'edit'); } });
  }

  /** Move focus to a lot's action button in whichever layout (table or cards) is visible. */
  function focusLot(id, act) {
    const el = [...document.querySelectorAll(`[data-act="${act}"][data-id="${id}"]`)].find(e => e.offsetParent);
    if (el) el.focus();
  }

  /** Smooth scroll unless the user asked for reduced motion. */
  function scrollToEl(el) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function onListClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const id = +btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'edit') openEditor(id);
    else if (act === 'delete') deleteLot(id);
    else if (act === 'to-formulas') {
      const lot = lots.find(l => l.id === id);
      if (lot && window.Formulas) window.Formulas.fillFromLot(lot);
      setView('formulas', true);
      scrollToEl($('#fx-calc'));
    } else if (act === 'to-explain') { setView('explain', true); scrollToEl($('#view-explain')); }
    else if (act === 'explain') {
      if (openPanels.has(id)) openPanels.delete(id); else openPanels.add(id);
      render();
      const again = [...document.querySelectorAll(`[data-act="explain"][data-id="${id}"]`)].find(el => el.offsetParent);
      if (again) again.focus();
    }
  }

  // ------------------------------------------------------------ import

  /**
   * Status message under a section. `actions` adds recovery buttons; `details` adds
   * "העתקת פרטי השגיאה" (copy error details) instead of showing raw errors in the UI.
   */
  function setMsg(el, text, kind, { actions = [], details } = {}) {
    el.className = `msg ${kind || ''}`;
    el.textContent = text;
    const all = actions.slice();
    if (details) {
      all.push({
        label: 'העתקת פרטי השגיאה',
        run: async () => {
          try { await navigator.clipboard.writeText(String(details)); toast('פרטי השגיאה הועתקו'); } catch { toast('ההעתקה לא הצליחה. הפרטים מופיעים בקונסולה של הדפדפן.'); }
        },
      });
    }
    if (!all.length) return;
    const row = document.createElement('span');
    row.className = 'msg-actions';
    for (const a of all) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = a.label;
      b.addEventListener('click', a.run);
      row.appendChild(b);
    }
    el.appendChild(row);
  }

  const errDetails = e => `${e && e.name ? e.name : 'Error'}: ${e && e.message ? e.message : e}\n${(e && e.stack) || ''}`;

  async function importFile(file) {
    const msg = $('#import-msg');
    if (!file) return;
    // PDF and images (screenshots, confirmations): read the text, then review before adding.
    if (window.DocImport && window.DocImport.isDocument(file)) { importDocument(file); return; }
    try {
      const buf = await file.arrayBuffer();
      lastImport = { name: file.name, buf };
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      let best = { lots: [], warnings: ['לא נמצאה בקובץ טבלת מכירות'] };
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        const res = Core.parseEtradeRows(rows);
        if (res.lots.length > best.lots.length) best = res;
      }
      if (!best.lots.length) { setMsg(msg, `לא יובאו עסקאות. ${best.warnings.join(' · ')}`, 'err'); return; }
      const before = lots.length;
      lots = lots.concat(best.lots.map(l => ({ ...blankLot(), ...l, sec102: null })));
      yearFilter = 'all';
      render();
      const extra = best.warnings.length ? ` שים לב: ${best.warnings.join(' · ')}` : '';
      setMsg(msg, `יובאו ${lots.length - before} מכירות מהקובץ ${file.name}.${extra}`, best.warnings.length ? 'warn' : 'ok');
      scrollToEl($('#hero'));
    } catch (e) {
      console.error(e);
      setMsg(msg, 'הקובץ לא נקרא. אפשר לנסות שוב עם קובץ G&L_Expanded.xlsx או CSV שירד מ‑E*Trade.', 'err', {
        actions: [{ label: 'בחירת קובץ אחר', run: () => $('#file').click() }], details: errDetails(e),
      });
    }
  }

  // ------------------------------------------------------------ PDF / image import (review before adding)

  const docDlg = () => $('#doc-dialog');
  let docState = null; // {file, buf, lots, hints}

  function docStatus(text, kind = '') {
    const el = $('#doc-status');
    el.className = `msg ${kind}`;
    el.textContent = text;
  }

  const docField = (i, key, label, value, type = 'text', extra = '') => `<div class="field"><label for="doc-${key}-${i}">${label}</label>
    <input id="doc-${key}-${i}" data-doc="${i}" data-k="${key}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''} ${extra} value="${esc(value ?? '')}"></div>`;

  function renderDocLots() {
    const { lots: found } = docState;
    const n = v => (isFinite(v) ? v : '');
    $('#doc-lots').innerHTML = found.map((l, i) => `<article class="sim-card doc-card">
        <label class="check"><input type="checkbox" data-doc-on="${i}" checked> <span><b><bdi>${esc(l.symbol || '—')} ${esc(l.planType || '')}</bdi></b> · נמכרה ${Core.formatDateIL(l.dateSold) || '—'}</span></label>
        <div class="grid grid-2">
          ${docField(i, 'symbol', 'סימול', l.symbol, 'text', 'dir="ltr"')}
          <div class="field"><label for="doc-planType-${i}">תוכנית</label><select id="doc-planType-${i}" data-doc="${i}" data-k="planType">${['ESPP', 'RSU', 'Options', 'אחר'].map(o => `<option${o === l.planType ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
          ${docField(i, 'qty', 'כמות', n(l.qty), 'number')}
          ${docField(i, 'dateAcquired', l.planType === 'RSU' ? 'תאריך הבשלה' : 'תאריך רכישה', l.dateAcquired, 'date')}
          ${docField(i, 'dateSold', 'תאריך מכירה', l.dateSold, 'date')}
          ${docField(i, 'proceedsUsd', 'תמורה ($)', n(l.proceedsUsd), 'number')}
          ${docField(i, 'costUsd', 'עלות ($) · Adjusted Cost Basis', n(l.costUsd), 'number')}
          ${l.planType === 'RSU' ? docField(i, 'grantDate', 'תאריך הענקה', l.grantDate, 'date') : docField(i, 'paidUsd', 'סכום ששילמת ($)', n(l.paidUsd), 'number')}
        </div>
      </article>`).join('');
    const count = found.length;
    $('#doc-add').hidden = !count;
    $('#doc-add').textContent = count === 1 ? 'הוספת העסקה' : `הוספת ${count} עסקאות`;
    $('#doc-manual').hidden = !!count;
  }

  async function importDocument(file) {
    const d = docDlg();
    docState = { file, lots: [], hints: null };
    $('#doc-title').textContent = `קריאת ${file.name}`;
    $('#doc-lots').innerHTML = '';
    $('#doc-warn').innerHTML = '';
    $('#doc-text').textContent = '';
    $('#doc-text-wrap').hidden = true;
    $('#doc-add').hidden = true;
    $('#doc-manual').hidden = true;
    docStatus('מכין את הקריאה…');
    d.showModal();
    try {
      const buf = await file.arrayBuffer();
      docState.buf = buf;
      const res = await window.DocImport.read(new File([buf], file.name, { type: file.type }), p => {
        if (p.step === 'ocr') docStatus(`מזהה את הטקסט${p.pages > 1 ? `, עמוד ${p.page} מתוך ${p.pages}` : ''}${p.passes > 1 ? `, קריאה ${p.pass} מתוך ${p.passes}` : ''}… ${p.pct}%`);
        else docStatus('טוען את מנוע זיהוי הטקסט. בפעם הראשונה זה לוקח כמה שניות…');
      });
      if (docState.file !== file) return; // a newer file replaced this one
      const parsed = Core.bestGainsParse(res.texts, { symbols: Object.keys(PRICES) });
      docState.lots = parsed.lots;
      $('#doc-text').textContent = parsed.text;
      $('#doc-text-wrap').hidden = false;
      if (parsed.lots.length) {
        docStatus(`${res.method === 'ocr' ? 'הטקסט זוהה מהתמונה' : 'הטקסט נקרא מה‑PDF'}. ${parsed.lots.length === 1 ? 'נמצאה מכירה אחת' : `נמצאו ${parsed.lots.length} מכירות`}. כדאי לבדוק כל שדה מול המסמך לפני ההוספה.`, 'ok');
        $('#doc-warn').innerHTML = parsed.warnings.map(w => `<li>${esc(w)}</li>`).join('');
      } else {
        docState.hints = Core.parseSaleHints(parsed.text);
        const h = docState.hints;
        const got = [h.dateSold && `תאריך ${Core.formatDateIL(h.dateSold)}`, isFinite(h.qty) && `כמות ${h.qty}`, isFinite(h.proceedsUsd) && `תמורה ${usd(h.proceedsUsd)}$`].filter(Boolean);
        docStatus(`לא נמצאה במסמך טבלת Gains & Losses.${got.length ? ` זוהו: ${got.join(', ')}. אפשר לפתוח עסקה חדשה עם הנתונים האלה ולהשלים את השאר.` : ' אפשר להוסיף את העסקה ידנית.'}`, 'warn');
      }
      renderDocLots();
    } catch (e) {
      if (!e.userMessage) console.error(e); // expected problems (an unreadable image) are explained in the dialog
      docStatus(e.userMessage || 'קריאת המסמך נכשלה. אפשר לנסות שוב, או להוסיף את העסקה ידנית.', 'err');
      $('#doc-manual').hidden = false;
    }
  }

  function addDocLots() {
    if (!docState) return;
    const read = (i, k) => { const el = document.querySelector(`[data-doc="${i}"][data-k="${k}"]`); return el ? el.value.trim() : ''; };
    const num = v => (v === '' ? NaN : +v);
    const added = [];
    docState.lots.forEach((l, i) => {
      if (!document.querySelector(`[data-doc-on="${i}"]`).checked) return;
      const planType = read(i, 'planType');
      added.push({
        ...blankLot(), ...l, symbol: read(i, 'symbol').toUpperCase(), planType, qty: num(read(i, 'qty')),
        dateAcquired: read(i, 'dateAcquired'), dateSold: read(i, 'dateSold'), proceedsUsd: num(read(i, 'proceedsUsd')), costUsd: num(read(i, 'costUsd')),
        paidUsd: planType === 'RSU' ? 0 : num(read(i, 'paidUsd')), grantDate: planType === 'RSU' ? read(i, 'grantDate') : '', sec102: null,
      });
      delete added[added.length - 1]._check;
    });
    docDlg().close();
    if (!added.length) return;
    lots = lots.concat(added);
    lastImport = { name: docState.file.name, buf: docState.buf };
    yearFilter = 'all';
    render();
    setMsg($('#import-msg'), `נוספו ${added.length === 1 ? 'עסקה אחת' : `${added.length} עסקאות`} מהקובץ ${docState.file.name}. הנתונים זוהו אוטומטית, אז כדאי לעבור על "הצגת החישוב".`, 'ok');
    focusLot(added[0].id, 'edit');
  }

  function bindDocDialog() {
    const d = docDlg();
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.addEventListener('close', () => { if (docState) docState.file = null; });
    $('#doc-add').addEventListener('click', addDocLots);
    $('#doc-manual').addEventListener('click', () => {
      const h = (docState && docState.hints) || {};
      d.close();
      const prefill = {};
      if (h.symbol) prefill.symbol = h.symbol;
      if (h.dateSold) prefill.dateSold = h.dateSold;
      if (isFinite(h.qty)) prefill.qty = h.qty;
      if (isFinite(h.proceedsUsd)) prefill.proceedsUsd = h.proceedsUsd;
      if (h.feesUsd) prefill.feesUsd = Core.round2(h.feesUsd);
      openEditor(null, prefill);
    });
    // Keep the card title in sync with the symbol / plan being edited.
    $('#doc-lots').addEventListener('change', e => {
      const i = e.target.dataset.doc;
      if (i === undefined || !docState) return;
      const k = e.target.dataset.k;
      if (k === 'planType') {
        // Re-render so RSU shows the grant date and ESPP the amount paid; keep the edits already typed.
        docState.lots.forEach((l, j) => {
          for (const el of document.querySelectorAll(`[data-doc="${j}"]`)) l[el.dataset.k] = el.type === 'number' ? (el.value === '' ? NaN : +el.value) : el.value;
        });
        renderDocLots();
        const again = document.querySelector(`[data-doc="${i}"][data-k="planType"]`);
        if (again) again.focus();
      }
    });
  }

  function bindDropzone() {
    const dz = $('#dropzone');
    $('#file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => importFile(e.dataTransfer.files[0]));
    // Allow dropping anywhere on the page.
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { if (!dz.contains(e.target)) { e.preventDefault(); importFile(e.dataTransfer.files[0]); } });
  }

  // ------------------------------------------------------------ profile

  function validateId(showEmpty) {
    const input = $('#p-id');
    const v = input.value.trim();
    let err = '';
    if (v && !/^\d+$/.test(v)) err = 'מספר זהות מכיל ספרות בלבד';
    else if (v && !Core.isValidIsraeliId(v)) err = 'ספרת הביקורת לא מתאימה למספר. כדאי לבדוק את כל 9 הספרות.';
    else if (!v && showEmpty) err = 'מומלץ למלא מספר זהות. הוא נכתב בשדה "מספר תיק" בטופס.';
    input.setAttribute('aria-invalid', err && v ? 'true' : 'false');
    $('#p-id-err').textContent = err;
    return !v || !err;
  }

  function syncProfileInputs() {
    $('#p-name').value = profile.name || '';
    $('#p-belonging').value = profile.belonging || '2';
    $('#p-place').value = profile.place || 'israel';
    $('#p-date').value = profile.signDate || today();
    $('#p-102').checked = !!profile.sec102;
    syncWorkInputs();
  }

  function bindProfile() {
    const fields = { 'p-name': 'name', 'p-id': 'idNumber', 'p-belonging': 'belonging', 'p-place': 'place', 'p-date': 'signDate' };
    for (const [id, key] of Object.entries(fields)) {
      const input = document.getElementById(id);
      input.value = profile[key] || (key === 'signDate' ? today() : '');
      input.addEventListener('input', () => { profile[key] = input.value.trim(); persist(); if (id === 'p-id' && input.getAttribute('aria-invalid') === 'true') validateId(false); });
    }
    $('#p-id').addEventListener('blur', () => validateId(false));
    const cb = $('#p-102');
    cb.checked = !!profile.sec102;
    cb.addEventListener('change', () => { profile.sec102 = cb.checked; persist(); render(); });
    bindWorkSettings();
  }

  /** Marginal-tax settings appear in step 4 and in the simulator; all copies stay in sync. */
  function syncWorkInputs() {
    for (const el of document.querySelectorAll('[data-work]')) {
      const k = el.dataset.work;
      if (el.type === 'checkbox') el.checked = !!profile[k]; else el.value = profile[k];
    }
    for (const el of document.querySelectorAll('[data-work="niRate"]')) el.disabled = !profile.includeNi;
  }

  function bindWorkSettings() {
    syncWorkInputs();
    for (const el of document.querySelectorAll('[data-work]')) {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const k = el.dataset.work;
        if (el.type === 'checkbox') profile[k] = el.checked;
        else if (el.value !== '' && isFinite(+el.value)) profile[k] = +el.value;
        else return;
        syncWorkInputs();
        render();
        if (window.Sim) window.Sim.render();
        if (window.Formulas) window.Formulas.render();
      });
    }
  }

  // ------------------------------------------------------------ export

  const formsText = n => (n === 1 ? 'טופס 1399 אחד' : `${n} טפסי 1399`);

  function renderExportScope(ok, bad) {
    const scope = yearFilter === 'all' ? 'כל העסקאות' : `העסקאות של ${yearFilter}`;
    const forms = formItems(ok).length;
    const early = ok.length - forms;
    $('#export-scope').textContent = forms
      ? `ההורדה תכלול את ${scope}: ${formsText(forms)} ודף סיכום.${bad ? ` ${bad === 1 ? 'עסקה אחת' : `${bad} עסקאות`} עם נתונים חסרים לא ${bad === 1 ? 'תיכלל' : 'ייכללו'}.` : ''}${early ? ` ${early === 1 ? 'מכירה אחת' : `${early} מכירות`} לפני תום 24 החודשים במסלול 102 ${early === 1 ? 'מופיעה' : 'מופיעות'} רק ב‑Excel, כי אין בהן רווח הון.` : ''}`
      : ok.length ? 'אין מכירות עם רווח הון לטופס 1399. כל המכירות הן לפני תום 24 החודשים במסלול 102, והן מופיעות ב‑Excel.' : 'אין עדיין עסקאות תקינות להורדה.';
  }

  async function fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.arrayBuffer();
  }

  function download(bytes, name, type) {
    const blob = new Blob([bytes], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportReady() {
    const ok = visibleItems().filter(it => it.calc.ok);
    const msg = $('#export-msg');
    if (!ok.length) { setMsg(msg, 'אין עסקאות תקינות להורדה. השלם את העסקאות המסומנות ב‑⚠.', 'err'); return null; }
    if (!validateId(false)) {
      scrollToEl($('#export'));
      $('#p-id').focus();
      setMsg(msg, 'יש לתקן את מספר הזהות לפני ההורדה.', 'err');
      return null;
    }
    return ok;
  }

  async function buildPdfBytes(ok) {
    const [formBytes, fontBytes] = await Promise.all([fetchBytes(FORM_URL), fetchBytes(FONT_URL)]);
    const items = formItems(ok).map(it => ({ lot: { ...it.capLot, sec102: sec102Of(it.lot) }, calc: it.calc }));
    if (!items.length) throw new Error('אין מכירות עם רווח הון לטופס 1399');
    return window.Pdf1399.buildPdf({ formBytes, fontBytes, profile: { ...profile, signDate: profile.signDate || today() }, items });
  }

  const fileYear = ok => (yearFilter !== 'all' ? yearFilter : [...new Set(ok.map(it => yearOf(it.lot)))].join('-'));

  async function withBusy(btns, fn) {
    btns.forEach(b => { b.disabled = true; });
    try { return await fn(); } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  async function onPdf() {
    const ok = exportReady();
    if (!ok) return;
    if (!formItems(ok).length) { setMsg($('#export-msg'), 'אין מכירות עם רווח הון לטופס 1399. אפשר להוריד את ה‑Excel.', 'warn'); return; }
    const msg = $('#export-msg');
    await withBusy([$('#dl-pdf'), $('#s-dl'), $('#preview-dl')], async () => {
      try {
        const t = setTimeout(() => setMsg(msg, 'מכין את ה‑PDF…', ''), 100);
        let bytes;
        try { bytes = await buildPdfBytes(ok); } finally { clearTimeout(t); }
        download(bytes, `form-1399-${fileYear(ok)}.pdf`, 'application/pdf');
        setMsg(msg, `ירד PDF עם ${formsText(formItems(ok).length)} ודף סיכום.`, 'ok');
        if (!profile.idNumber) toast('הטופס ירד בלי מספר זהות. אפשר למלא אותו בשלב 4.');
      } catch (e) {
        console.error(e);
        const text = location.protocol === 'file:'
          ? 'יצירת ה‑PDF נכשלה כי הדף נפתח ישירות מהדיסק. אפשר לפתוח אותו דרך הקישור לאתר.'
          : 'יצירת ה‑PDF נכשלה. אפשר לנסות שוב.';
        setMsg(msg, text, 'err', { actions: [{ label: 'ניסיון חוזר', run: onPdf }], details: errDetails(e) });
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function onPreview() {
    const ok = exportReady();
    if (!ok) return;
    if (!formItems(ok).length) { setMsg($('#export-msg'), 'אין מכירות עם רווח הון לטופס 1399. אפשר להוריד את ה‑Excel.', 'warn'); return; }
    const pd = $('#preview-dialog');
    const pages = $('#preview-pages');
    pages.innerHTML = '';
    const skel = setTimeout(() => {
      if (!pages.querySelector('canvas')) pages.innerHTML = '<div class="page-skeleton" role="img" aria-label="טוען את התצוגה המקדימה">' + '<i></i>'.repeat(14) + '</div>';
    }, 100);
    pd.showModal();
    try {
      const bytes = await buildPdfBytes(ok);
      if (!window.pdfjsLib) {
        await loadScript('vendor/pdfjs/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      }
      // disableFontFace: the form's embedded Hebrew CID fonts render garbled through
      // the browser's FontFace path; drawing glyphs as paths renders them correctly.
      const doc = await window.pdfjsLib.getDocument({ data: bytes, disableFontFace: true }).promise;
      clearTimeout(skel);
      pages.innerHTML = '';
      const width = Math.min(pages.clientWidth - 32, 820);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.setAttribute('aria-label', `עמוד ${n} מתוך ${doc.numPages}`);
        pages.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      console.error(e);
      clearTimeout(skel);
      pages.innerHTML = '<p class="loading">התצוגה המקדימה לא נטענה. אפשר להוריד את הקובץ ישירות.</p>';
      setMsg($('#export-msg'), 'התצוגה המקדימה לא נטענה.', 'err', { actions: [{ label: 'ניסיון חוזר', run: () => { pd.close(); onPreview(); } }], details: errDetails(e) });
    }
  }

  function onXlsx() {
    const ok = exportReady();
    if (!ok) return;
    XLSX.writeFile(buildWorkbook(ok), `capital-gains-${fileYear(ok)}.xlsx`);
    setMsg($('#export-msg'), 'קובץ ה‑Excel ירד.', 'ok');
  }

  function buildWorkbook(ok) {
    const rows = ok.map((it, i) => {
      const { calc, is102 } = it;
      const lot = it.capLot;
      return {
        '#': i + 1, 'נייר': lot.symbol, 'תוכנית': lot.planType, 'מסלול': is102 ? '102 נאמן' : 'רגיל', 'כמות': lot.qty,
        'תאריך רכישה/הקצאה': Core.formatDateIL(calc.noForm ? calc.alloc : lot.dateAcquired), 'תאריך מכירה': Core.formatDateIL(lot.dateSold), 'שעת מכירה (ניו יורק)': lot.timeSold || '',
        'שער רכישה/הקצאה': calc.buy ? calc.buy.rate : '', 'שער מכירה': calc.sell.rate,
        'תמורה $': lot.proceedsUsd, 'עלות $': calc.noForm ? '' : lot.costUsd, 'עמלות $': lot.feesUsd || 0,
        'תמורה ₪': calc.proceedsIls, 'עלות ₪': calc.costIls, 'עמלות ₪': calc.feesIls,
        'רווח נומינלי ₪': calc.nominal, 'סכום אינפלציוני ₪': calc.inflationary, 'רווח/הפסד ריאלי ₪': calc.real, 'מס 25% ₪': calc.tax,
        'הכנסת עבודה $': is102 ? calc.workUsd : '', 'הכנסת עבודה ₪': is102 ? calc.workIls : '', 'מס שולי משוער ₪': is102 ? it.workTax : '',
        'מס שנוכה ע"י הנאמן ₪': isFinite(it.lot.withheldIls) ? it.lot.withheldIls : '',
        'הערה': calc.noForm ? 'מכירה לפני תום 24 חודשים: כל הרווח הכנסת עבודה, בלי טופס 1399' : '',
      };
    });
    const sums = Core.summarize(ok).map(g => ({
      'תקופה': g.label, 'מכירות': g.count, 'תמורה ₪': g.proceedsIls, 'רווחים ריאליים ₪': g.gains,
      'הפסדים לקיזוז ₪': g.losses, 'רווח ריאלי נטו ₪': g.net, 'מס משוער 25% ₪': g.tax,
      'הכנסת עבודה 102 ₪': g.workIls, 'מס שולי משוער ₪': Core.workTax(g.workIls, profile),
    }));
    const checks = [];
    for (const it of ok) {
      const lot = it.capLot;
      for (const [label, date] of [[it.is102 ? 'הקצאה' : 'רכישה', it.calc.noForm ? '' : lot.dateAcquired], ['מכירה', lot.dateSold]]) {
        if (!date) continue;
        const cc = Core.crossCheck(SOURCES, date);
        checks.push({
          'נייר': lot.symbol, 'אירוע': label, 'תאריך': Core.formatDateIL(date),
          'בנק ישראל': cc.boi ? cc.boi.rate : '', 'ECB': cc.checks.ecb.rate ?? '', 'סטייה ECB %': cc.checks.ecb.devPct ?? '',
          'Yahoo': cc.checks.yahoo.rate ?? '', 'סטייה Yahoo %': cc.checks.yahoo.devPct ?? '',
        });
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'עסקאות');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sums), 'סיכום');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checks), 'בקרת שערים');
    wb.Workbook = { Views: [{ RTL: true }] };
    return wb;
  }

  // ------------------------------------------------------------ backup / restore

  function downloadBackup() {
    if (!lots.length && !simHoldings().length) { toast('אין עדיין עסקאות לגבות.'); return; }
    const data = Core.makeBackup(profile, lots, new Date(), simHoldings());
    download(JSON.stringify(data, null, 2), `1399-backup-${today()}.json`, 'application/json');
    const nh = simHoldings().length;
    toast(`נשמר גיבוי של ${lots.length === 1 ? 'עסקה אחת' : `${lots.length} עסקאות`}${nh ? ` ו‑${nh === 1 ? 'מנה אחת' : `${nh} מנות`} מהסימולטור` : ''}. מספר הזהות לא נכלל בגיבוי.`);
  }

  let pendingRestore = null;
  const simHoldings = () => (window.Sim ? window.Sim.getHoldings() : []);

  function applyRestore(mode) {
    const data = pendingRestore;
    pendingRestore = null;
    if (!data) return;
    const before = lots.slice();
    const beforeProfile = { ...profile };
    const beforeHoldings = simHoldings();
    const fresh = data.lots.map(l => ({ ...blankLot(), ...l }));
    let text;
    if (mode === 'replace') {
      lots = fresh;
      Object.assign(profile, data.profile);
      if (data.holdings.length && window.Sim) window.Sim.setHoldings(data.holdings);
      text = `נטענו ${fresh.length} עסקאות מהגיבוי, והרשימה הקודמת הוחלפה.`;
    } else {
      const r = Core.mergeLots(lots, fresh);
      lots = r.merged;
      if (data.holdings.length && window.Sim) window.Sim.setHoldings(beforeHoldings.concat(data.holdings));
      for (const [k, v] of Object.entries(data.profile)) if (!profile[k]) profile[k] = v; // fill only empty details
      text = `נוספו ${r.added} עסקאות מהגיבוי${r.skipped ? `, ו‑${r.skipped} כפולות דולגו` : ''}.`;
    }
    yearFilter = 'all';
    openPanels.clear();
    syncProfileInputs();
    render();
    $('#lots-title').focus();
    if (data.holdings.length) text += ` נטענו גם ${data.holdings.length} מנות לסימולטור.`;
    toast(text, { label: 'ביטול', run: () => { lots = before; Object.assign(profile, beforeProfile); if (window.Sim) window.Sim.setHoldings(beforeHoldings); syncProfileInputs(); render(); } });
  }

  async function onBackupFile(file) {
    if (!file) return;
    const msg = $('#import-msg');
    try {
      pendingRestore = Core.parseBackup(await file.text());
    } catch (e) {
      setMsg(msg, e.message, 'err', { actions: [{ label: 'בחירת קובץ אחר', run: () => $('#backup-file').click() }] });
      return;
    }
    setMsg(msg, '', '');
    if (!lots.length && !simHoldings().length) { applyRestore('replace'); return; }
    const n = pendingRestore.lots.length;
    $('#restore-body').textContent = `בקובץ הגיבוי ${n === 1 ? 'עסקה אחת' : `${n} עסקאות`}, וברשימה כרגע ${lots.length === 1 ? 'עסקה אחת' : `${lots.length} עסקאות`}. אפשר להחליף את הרשימה בגיבוי, או להוסיף את עסקאות הגיבוי לרשימה (כפולות ידולגו).`;
    $('#restore-dialog').showModal();
    $('#restore-cancel').focus();
  }

  // ------------------------------------------------------------ ZIP package for the accountant

  function explanationText(ok) {
    const groups = Core.summarize(ok);
    const L = [];
    L.push('הסבר לחישוב רווח ההון ממכירת מניות – טופס 1399');
    L.push('='.repeat(48));
    L.push(`נוצר: ${Core.formatDateIL(today())} · מחולל טופס 1399 · https://tamirgabgab.github.io/espp-and-rsu-report-generator/`);
    if (profile.name) L.push(`שם: ${profile.name}`);
    const sales = n => (n === 1 ? 'מכירה אחת' : `${n} מכירות`);
    L.push(`היקף: ${yearFilter === 'all' ? 'כל העסקאות' : `שנת ${yearFilter}`} · ${sales(ok.length)} (lots)`);
    L.push('');
    L.push('סיכום');
    L.push('-----');
    for (const g of groups) {
      L.push(`${g.label}: ${sales(g.count)} · רווח ריאלי נטו ${fmt(g.net)} ₪ · מס משוער 25%: ${fmt(g.tax)} ₪${g.isYear ? '' : ` · מקדמה עד ${Core.formatDateIL(dueDate(g.key))}`}`);
    }
    L.push('');
    L.push('פירוט המכירות');
    L.push('-------------');
    ok.forEach((it, i) => {
      const { calc } = it;
      const lot = it.capLot;
      L.push(`${i + 1}. ${lot.symbol || '—'} ${lot.planType || ''}${isFinite(lot.qty) ? `, ${lot.qty} מניות` : ''}${it.is102 ? ' (סעיף 102, מסלול רווח הון עם נאמן)' : sec102Of(lot) ? ' (סעיף 102)' : ''}`);
      if (it.is102) {
        L.push(`   הקצאה לנאמן ${Core.formatDateIL(calc.alloc)}; תום 24 החודשים: מכירה מ-${Core.formatDateIL(calc.unlock)}.`);
        L.push(`   הכנסת עבודה ${usd(calc.workUsd)}$ = ${fmt(calc.workIls)} ₪ (שער יום המכירה); מס שולי משוער ${fmt(it.workTax)} ₪${isFinite(it.lot.withheldIls) ? `; הנאמן ניכה ${fmt(it.lot.withheldIls)} ₪` : ''}.`);
        if (calc.baseSource === 'avg30') L.push(`   שווי ההטבה: ממוצע סגירה ${calc.avg.avg}$ ב-30 ימי המסחר ${Core.formatDateIL(calc.avg.from)}–${Core.formatDateIL(calc.avg.to)}.`);
        if (calc.noForm) { L.push(`   נמכר ${Core.formatDateIL(lot.dateSold)} בשער ${calc.sell.rate}. ${Core.SCENARIO_TEXT['early-102']}`); return; }
      }
      L.push(`   ${it.is102 ? 'עלות לרווח ההון בתאריך ההקצאה' : 'נרכש'} ${Core.formatDateIL(lot.dateAcquired)} בשער ${calc.buy.rate}; נמכר ${Core.formatDateIL(lot.dateSold)} בשער ${calc.sell.rate}${lot.timeSold ? ` (שעה ${lot.timeSold} שעון ניו יורק)` : ''}.`);
      L.push(`   תמורה ${usd(lot.proceedsUsd)}$ = ${fmt(calc.proceedsIls)} ₪; עלות ${usd(lot.costUsd)}$ = ${fmt(calc.costIls)} ₪${calc.feesIls ? `; הוצאות ${fmt(calc.feesIls)} ₪` : ''}.`);
      L.push(`   רווח נומינלי ${fmt(calc.nominal)} ₪; סכום אינפלציוני ${fmt(calc.inflationary)} ₪; רווח/הפסד ריאלי ${fmt(calc.real)} ₪.`);
      L.push(`   ${Core.SCENARIO_TEXT[calc.scenario] || ''}`);
    });
    L.push('');
    L.push('שיטת החישוב');
    L.push('-----------');
    L.push('• שערים: השער היציג של בנק ישראל ביום הרכישה וביום המכירה. ביום שבו לא פורסם שער נלקח השער האחרון שפורסם לפניו. השערים נבדקו מול ECB ו-Yahoo Finance.');
    L.push('• חישוב לפי חוזר מס הכנסה 10/2025 (הלכת מוזס): ליחיד שרכש נייר ערך בדולרים, שער הדולר משמש כמדד.');
    L.push('  A = (תמורה $ − עלות $ − עמלות $) × שער מכירה ;  B = תמורה $ × שער מכירה − עלות $ × שער רכישה − עמלות $ × שער מכירה');
    L.push('  רווח ריאלי = הקטן מבין A ו-B כששניהם רווח; הגדול מביניהם כששניהם הפסד; 0 אם הסימנים שונים.');
    L.push('• עלות: Adjusted Cost Basis מ-E*Trade (השווי ביום הרכישה ב-ESPP או ביום ההבשלה ב-RSU), בהנחה שההטבה מוסתה כהכנסת עבודה במשכורת.');
    L.push('• מס: 25% על הרווח הריאלי, אחרי קיזוז הפסדים באותה תקופה. מס יסף לא חושב.');
    if (ok.some(it => it.is102)) {
      L.push(`• סעיף 102 (מסלול רווח הון עם נאמן): הכנסת עבודה W = min(V, תמורה − עמלות) − ששולם, כאשר V הוא השווי ביום הרכישה ב-ESPP או ממוצע 30 ימי המסחר שלפני ההענקה ב-RSU. W מומרת בשער יום המכירה, והמס עליה הוא הערכה לפי ${profile.marginalRate}%${profile.includeNi ? ` ועוד ${profile.niRate}% ביטוח לאומי ובריאות` : ''}.`);
      L.push('  רווח ההון מחושב ריאלית (חוזר 10/2025) עם עלות = ששולם + W, בשער יום ההקצאה. מכירה לפני תום 24 חודשים: כל הרווח הכנסת עבודה, בלי 1399.');
    }
    L.push('');
    L.push('קבצים בחבילה');
    L.push('------------');
    L.push(`• form-1399-${fileYear(ok)}.pdf – טופס 1399 לכל מכירה ונספח סיכום`);
    L.push(`• capital-gains-${fileYear(ok)}.xlsx – החישוב המלא, סיכום ובקרת שערים`);
    L.push(lastImport ? `• ${lastImport.name} – קובץ ה-Gains & Losses המקורי מ-E*Trade` : '• קובץ E*Trade המקורי לא נכלל, כי לא הועלה קובץ במושב הזה.');
    L.push('• backup.json – גיבוי הנתונים לטעינה חוזרת בכלי (ללא מספר זהות)');
    L.push('');
    L.push('המסמך הוכן אוטומטית ואינו ייעוץ מס.');
    return '\uFEFF' + L.join('\r\n'); // BOM + CRLF so Windows Notepad shows Hebrew correctly
  }

  async function onZip() {
    const ok = exportReady();
    if (!ok) return;
    const msg = $('#export-msg');
    const btns = [$('#dl-zip')];
    await withBusy(btns, async () => {
      const t = setTimeout(() => setMsg(msg, 'מכין את החבילה…', ''), 100);
      try {
        if (!window.JSZip) await loadScript('vendor/jszip.min.js');
        const zip = new window.JSZip();
        const year = fileYear(ok);
        zip.file(`capital-gains-${year}.xlsx`, XLSX.write(buildWorkbook(ok), { bookType: 'xlsx', type: 'array' }));
        if (lastImport) zip.file(lastImport.name, lastImport.buf);
        zip.file('explanation.txt', explanationText(ok));
        if (formItems(ok).length) zip.file(`form-1399-${year}.pdf`, await buildPdfBytes(ok));
        zip.file('backup.json', JSON.stringify(Core.makeBackup(profile, ok.map(it => it.lot), new Date(), simHoldings()), null, 2));
        const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        clearTimeout(t);
        download(blob, `form-1399-package-${year}.zip`, 'application/zip');
        const n = Object.keys(zip.files).length;
        setMsg(msg, `ירדה חבילה עם ${n} קבצים${lastImport ? '' : ' (בלי קובץ E*Trade המקורי, כי לא הועלה במושב הזה)'}.`, lastImport ? 'ok' : 'warn');
      } catch (e) {
        clearTimeout(t);
        console.error(e);
        setMsg(msg, 'יצירת החבילה נכשלה. אפשר לנסות שוב.', 'err', { actions: [{ label: 'ניסיון חוזר', run: onZip }], details: errDetails(e) });
      }
    });
  }

  // ------------------------------------------------------------ install as app (home-screen icon)

  function bindInstall() {
    let deferred = null;
    const btn = $('#install-app');
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
    window.addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; toast('האפליקציה הותקנה במסך הבית'); });
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      btn.hidden = true;
    });
  }

  // ------------------------------------------------------------ theme (auto / light / dark)

  const LS_THEME = 'f1399.theme';

  function applyTheme(opt) {
    if (opt === 'light' || opt === 'dark') document.documentElement.setAttribute('data-theme', opt);
    else document.documentElement.removeAttribute('data-theme');
    try { if (opt === 'auto') localStorage.removeItem(LS_THEME); else localStorage.setItem(LS_THEME, opt); } catch { /* storage blocked */ }
    for (const b of document.querySelectorAll('#theme-switch [data-theme-opt]')) {
      const on = b.dataset.themeOpt === opt;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  /** Keyboard pattern for a radiogroup of buttons (RTL: Left = next, Right = previous). */
  function radioKeys(group, selector, choose) {
    group.addEventListener('keydown', e => {
      const items = [...group.querySelectorAll(selector)];
      const i = items.indexOf(document.activeElement);
      if (i === -1) return;
      const step = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 }[e.key];
      let j = null;
      if (step) j = (i + step + items.length) % items.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = items.length - 1;
      if (j === null) return;
      e.preventDefault();
      choose(items[j]);
    });
  }

  function bindTheme() {
    const group = $('#theme-switch');
    let saved = 'auto';
    try { saved = localStorage.getItem(LS_THEME) || 'auto'; } catch { /* default */ }
    applyTheme(saved);
    const choose = b => { applyTheme(b.dataset.themeOpt); b.focus(); };
    group.addEventListener('click', e => { const b = e.target.closest('[data-theme-opt]'); if (b) choose(b); });
    radioKeys(group, '[data-theme-opt]', choose);
  }

  // ------------------------------------------------------------ named destructive confirmation (shared)

  let confirmAction = null;
  function confirmDestructive({ title, body, ok, run }) {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = ok;
    confirmAction = run;
    $('#confirm-dialog').showModal();
    $('#confirm-cancel').focus();
  }

  // ------------------------------------------------------------ views (report / simulator)

  const LS_VIEW = 'f1399.view';
  let currentView = 'report';

  const VIEWS = ['report', 'sim', 'formulas', 'explain'];

  function setView(view, focus) {
    currentView = VIEWS.includes(view) ? view : 'report';
    for (const v of VIEWS) {
      const on = v === currentView;
      const tab = $(`#tab-${v}`);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#view-${v}`).hidden = !on;
    }
    try { localStorage.setItem(LS_VIEW, currentView); } catch { /* storage blocked */ }
    if (focus) $(`#tab-${currentView}`).focus();
    render();
    if (currentView === 'sim' && window.Sim) window.Sim.render();
    if (currentView === 'formulas' && window.Formulas) window.Formulas.render();
    if (currentView === 'explain' && window.Explain) window.Explain.render();
  }

  function bindViews() {
    const tabs = document.querySelector('.view-tabs');
    const viewOf = t => t.id.replace('tab-', '');
    tabs.addEventListener('click', e => { const t = e.target.closest('[role="tab"]'); if (t) setView(viewOf(t), true); });
    radioKeys(tabs, '[role="tab"]', t => setView(viewOf(t), true));
    let saved = 'report';
    try { saved = localStorage.getItem(LS_VIEW) || 'report'; } catch { /* default */ }
    const hash = location.hash.slice(1);
    if (VIEWS.includes(hash)) saved = hash;
    currentView = saved;
    setView(saved, false);
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS.includes(h)) setView(h, false); });
  }

  // Shared helpers for the simulator (src/js/sim.js).
  window.App = {
    PRICES, RATES, profile, toast, setMsg, confirmDestructive, download, errDetails, scrollToEl, radioKeys, esc, fmt, ils, usd, signed, L, today,
    store, persist: () => persist(),
    /** The report's lots (copies), for "fill from my lot" in the formulas view. */
    reportLots: () => lots.map(l => ({ ...l })),
    setView: (v, focus) => setView(v, focus),
    sec102Of: lot => sec102Of(lot),
    syncWorkInputs: () => syncWorkInputs(),
    /** Capital results already realised in the report, per tax year (for loss offset in the simulator). */
    realizedByYear(year) {
      const items = lots.filter(l => yearOf(l) === String(year)).map(computeItem).filter(it => it.calc.ok && !it.calc.noForm);
      return items.reduce((acc, it) => { if (it.calc.real > 0) acc.gains += it.calc.real; else acc.losses += it.calc.real; return acc; }, { gains: 0, losses: 0, count: items.length });
    },
  };

  // ------------------------------------------------------------ init

  function init() {
    bindTheme();
    bindProfile();
    bindEditor();
    bindDropzone();
    bindDocDialog();
    $('#lots-body').addEventListener('click', onListClick);
    $('#lots-cards').addEventListener('click', onListClick);
    const chooseYear = year => {
      yearFilter = year;
      render();
      const chip = $(`#year-filter [data-year="${year}"]`);
      if (chip) chip.focus();
    };
    $('#year-filter').addEventListener('click', e => {
      const chip = e.target.closest('[data-year]');
      if (chip) chooseYear(chip.dataset.year);
    });
    // Radio group keyboard pattern (RTL: Left = next, Right = previous).
    $('#year-filter').addEventListener('keydown', e => {
      const chips = [...$('#year-filter').querySelectorAll('[data-year]')];
      const i = chips.indexOf(document.activeElement);
      if (i === -1) return;
      const step = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 }[e.key];
      let j = null;
      if (step) j = (i + step + chips.length) % chips.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = chips.length - 1;
      if (j === null) return;
      e.preventDefault();
      chooseYear(chips[j].dataset.year);
    });
    $('#add-row').addEventListener('click', () => openEditor(null));
    $('#go-explain').addEventListener('click', () => { setView('explain', true); scrollToEl($('#view-explain')); });
    const loadExample = () => {
      lots = lots.concat(EXAMPLE.map(l => ({ ...blankLot(), ...l })));
      render();
      setMsg($('#import-msg'), 'נטענה דוגמה: מכירת 17 מניות QCOM מתוכנית ESPP.', 'ok');
    };
    $('#load-example').addEventListener('click', loadExample);
    $('#empty-example').addEventListener('click', loadExample);
    $('#empty-upload').addEventListener('click', () => $('#file').click());
    // Touch devices cannot drag files: say "choose" instead of "drag".
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      document.querySelector('.dz-title').textContent = 'בחירת קובץ או צילום מסך מ‑E*Trade';
      document.querySelector('.dz-sub').textContent = 'קובץ Excel, \u200FCSV, \u200FPDF או תמונה';
    }
    // Delete all: named confirmation first (Cancel focused), then an undo toast.
    const cd = $('#confirm-dialog');
    $('#clear-all').addEventListener('click', () => {
      if (!lots.length) return;
      const n = lots.length;
      const what = n === 1 ? 'העסקה' : `כל ${n} העסקאות`;
      confirmDestructive({
        title: `למחוק את ${what}?`,
        body: `הפעולה מוחקת ${n === 1 ? 'עסקה אחת' : `${n} עסקאות`} מהרשימה בדפדפן הזה. אחרי המחיקה אפשר לבטל אותה לכמה שניות.`,
        ok: n === 1 ? 'מחיקת העסקה' : `מחיקת ${n} עסקאות`,
        run: () => {
          const backup = lots.slice();
          lots = [];
          openPanels.clear();
          render();
          $('#lots-title').focus();
          toast(`נמחקו ${backup.length === 1 ? 'עסקה אחת' : `${backup.length} עסקאות`}`, { label: 'ביטול', run: () => { lots = backup; render(); } });
        },
      });
    });
    $('#confirm-ok').addEventListener('click', () => {
      cd.close();
      const run = confirmAction;
      confirmAction = null;
      if (run) run();
    });
    cd.addEventListener('click', e => { if (e.target === cd || e.target.closest('[data-close]')) cd.close(); });
    $('#dl-pdf').addEventListener('click', onPdf);
    $('#s-dl').addEventListener('click', onPdf);
    $('#preview-pdf').addEventListener('click', onPreview);
    $('#preview-dl').addEventListener('click', onPdf);
    $('#dl-xlsx').addEventListener('click', onXlsx);
    $('#dl-zip').addEventListener('click', onZip);
    $('#backup-save').addEventListener('click', downloadBackup);
    $('#backup-load').addEventListener('click', () => $('#backup-file').click());
    $('#backup-file').addEventListener('change', e => { onBackupFile(e.target.files[0]); e.target.value = ''; });
    const rd = $('#restore-dialog');
    $('#restore-replace').addEventListener('click', () => { rd.close(); applyRestore('replace'); });
    $('#restore-merge').addEventListener('click', () => { rd.close(); applyRestore('merge'); });
    rd.addEventListener('click', e => { if (e.target === rd || e.target.closest('[data-close]')) rd.close(); });
    rd.addEventListener('close', () => { pendingRestore = null; }); // replace/merge already consumed it synchronously
    bindInstall();
    bindViews();
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 150); });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
