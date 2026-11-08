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

  const blankLot = () => ({ id: nextId++, symbol: '', planType: 'ESPP', qty: NaN, dateAcquired: '', dateSold: '', timeSold: '', proceedsUsd: NaN, costUsd: NaN, feesUsd: 0, sec102: null, rateBuy: '', rateSell: '', order: '', grantDate: '', paidUsd: NaN, avg30: '', withheldIls: NaN });

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
    renderExplainAll(formItems(ok)[0]);
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
    for (const it of items) if (openPanels.has(it.lot.id)) fillIntraday(it);
  }

  /** Small second line in the table: the work-income part of a 102 lot. */
  const workLine = it => (it.calc.ok && it.calc.workIls > 0 ? `<span class="cell-sub">עבודה ${fmt(it.calc.workIls)}</span>` : '');

  // ------------------------------------------------------------ "how was it calculated" panel

  /** The section 102 split: work income (marginal tax) vs. the capital part. */
  function sec102Html(it) {
    const { lot, calc } = it;
    if (!it.is102) return '';
    const D = Core.formatDateIL;
    const step = (what, calcStr, note, cls = '') => `<li class="${cls}"><span class="what">${what}</span><span class="calc">${calcStr}</span>${note ? `<span class="note">${note}</span>` : ''}</li>`;
    const rs = calc.sell.rate;
    const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
    const base = calc.baseSource === 'avg30'
      ? step('שווי ההטבה (V) = ממוצע 30 ימי המסחר שלפני ההענקה × כמות', L(`${calc.avg.avg} × ${lot.qty} = ${usd(calc.baseUsd)} $`), `מחירי הסגירה של ${esc(lot.symbol)} מ‑${D(calc.avg.from)} עד ${D(calc.avg.to)} (Yahoo Finance). אם בדוח הנאמן מופיע ממוצע אחר, אפשר להזין אותו בעריכה.`)
      : calc.baseSource === 'manual'
        ? step('שווי ההטבה (V) = ממוצע 30 הימים (הוזן ידנית) × כמות', L(`${lot.avg30} × ${lot.qty} = ${usd(calc.baseUsd)} $`))
        : step('שווי ההטבה (V) = השווי ביום הרכישה', L(`${usd(calc.baseUsd)} $`), 'Adjusted Cost Basis: מחיר השוק ביום הרכישה × כמות.');
    const rate = (+profile.marginalRate || 0) + (profile.includeNi ? +profile.niRate || 0 : 0);
    const withheld = isFinite(lot.withheldIls) ? (() => {
      const est = it.workTax + calc.tax;
      const diff = lot.withheldIls - est;
      return `<p class="case">הנאמן ניכה ${ils(lot.withheldIls)}. ההערכה כאן: ${ils(est)} (מס שולי ${ils(it.workTax)} ועוד מס רווח הון ${ils(calc.tax)} לפני קיזוז). ההפרש: <bdi class="ltr">${signed(diff)} ₪</bdi>${Math.abs(diff) > Math.max(100, est * 0.05) ? '. הפער גדול מ‑5%, וכדאי לבדוק את שיעור המס השולי ואת השער עם הנאמן או רואה החשבון.' : ', בטווח הסביר.'}</p>`;
    })() : '';
    return `<h3>סעיף 102: חלוקה בין הכנסת עבודה לרווח הון</h3>
      <ol class="steps">
        ${step('הקצאה לנאמן', L(D(calc.alloc)), `${lot.planType === 'RSU' ? 'תאריך ההענקה' : 'תאריך הרכישה'}. המסלול ההוני מחייב החזקה של 24 חודשים לפחות: מכירה מ‑${D(calc.unlock)} ואילך.`)}
        ${calc.early ? '' : base}
        ${step('שולם (C<sub>p</sub>)', L(`${usd(calc.paidUsd)} $`), calc.paidKnown ? (lot.planType === 'RSU' ? 'ב‑RSU לא משלמים על המניות.' : '') : 'חסר הסכום ששילמת (Acquisition Cost). בלעדיו אי אפשר לחשב את ההנחה, ולכן חלק העבודה מוצג כ‑0.')}
        ${calc.early
          ? step('הכנסת עבודה $ = תמורה − עמלות − שולם (כל הרווח)', L(`${usd(lot.proceedsUsd)} − ${usd(fees)} − ${usd(calc.paidUsd)} = ${usd(calc.workUsd)} $`), 'המכירה לפני תום 24 החודשים, ולכן כל הרווח הוא הכנסת עבודה.')
          : step('הכנסת עבודה $ = min(V, תמורה − עמלות) − שולם', L(`min(${usd(calc.baseUsd)}, ${usd(lot.proceedsUsd - fees)}) − ${usd(calc.paidUsd)} = ${usd(calc.workUsd)} $`))}
        ${step('הכנסת עבודה ₪ = $ × שער מכירה', L(`${usd(calc.workUsd)} × ${rs} = ${fmt(calc.workIls)} ₪`), 'כמו בניכוי של הנאמן, בשער היציג של יום המכירה.')}
        ${step(`מס שולי משוער = הכנסת עבודה × ${rate}%`, L(`${fmt(calc.workIls)} × ${rate}% = ${fmt(it.workTax)} ₪`), 'הערכה לפי השיעור שבשלב 4. הנאמן מנכה את המס בפועל. הסכום לא נכנס לטופס 1399.', 'result')}
        ${calc.early ? '' : step('עלות לרווח ההון = שולם + הכנסת עבודה', L(`${usd(calc.paidUsd)} + ${usd(calc.workUsd)} = ${usd(calc.capCostUsd)} $`), `בתאריך ההקצאה (${D(calc.alloc)}), כמו בהערה 12.5 לטופס 1399.`)}
      </ol>
      ${calc.early ? `<p class="case">${esc(Core.SCENARIO_TEXT['early-102'])}</p>` : ''}
      ${withheld}`;
  }

  function panelHtml(it) {
    const { calc } = it;
    const lot = it.capLot;
    if (!calc.ok) {
      return `<div class="panel"><h3>חסרים נתונים לחישוב</h3>
        <ul class="lc-issues">${calc.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="actions"><button type="button" class="btn btn-sm" data-act="edit" data-id="${lot.id}">השלמת הנתונים</button></div></div>`;
    }
    if (calc.noForm) {
      return `<div class="panel">${sec102Html(it)}<h3>בקרת שערים</h3>${checksTable(it)}</div>`;
    }
    const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
    const rb = calc.buy.rate, rs = calc.sell.rate;
    const cf = Core.closedFormReal(lot, rb, rs);
    const A = Core.roundILS(cf.A);
    const rateNote = (r, d) => (r.manual ? 'שער שהוזן ידנית' : r.date !== d ? `השער היציג מ‑${Core.formatDateIL(r.date)} (לא פורסם שער ב‑${Core.formatDateIL(d)})` : `השער היציג של ${Core.formatDateIL(d)}`);
    const step = (what, calcStr, note, cls = '') => `<li class="${cls}"><span class="what">${what}</span><span class="calc">${calcStr}</span>${note ? `<span class="note">${note}</span>` : ''}</li>`;
    const inflNote = calc.inflRaw <= 0
      ? 'השקל התחזק (או לא השתנה), ולכן אין סכום אינפלציוני פטור.'
      : calc.nominal < 0 ? 'הפסד בזמן שהשקל נחלש: כל ההפסד הנומינלי מותר.' : `פטור ממס עד גובה הרווח: ${ils(calc.inflationary)}.`;
    const realRule = cf.A >= 0 && cf.B >= 0 ? `min(${signed(A)}, ${signed(calc.nominal)})`
      : cf.A <= 0 && cf.B <= 0 ? `max(${signed(A)}, ${signed(calc.nominal)})` : '0 (סימנים שונים)';

    return `<div class="panel">
      ${sec102Html(it)}
      <h3>${it.is102 ? 'חלק רווח ההון (25%)' : 'החישוב'}</h3>
      <ol class="steps">
        ${step('תמורה בשקלים = תמורה $ × שער מכירה', L(`${usd(lot.proceedsUsd)} × ${rs} = ${calc.proceedsIls.toLocaleString('en-US')} ₪`), rateNote(calc.sell, lot.dateSold))}
        ${step(`עלות בשקלים = עלות $ × שער ${it.is102 ? 'יום ההקצאה' : 'רכישה'}`, L(`${usd(lot.costUsd)} × ${rb} = ${calc.costIls.toLocaleString('en-US')} ₪`), rateNote(calc.buy, lot.dateAcquired))}
        ${fees ? step('הוצאות מכירה = עמלות $ × שער מכירה', L(`${usd(fees)} × ${rs} = ${calc.feesIls.toLocaleString('en-US')} ₪`)) : ''}
        ${step('רווח נומינלי (B) = תמורה − עלות − הוצאות', L(`${calc.proceedsIls.toLocaleString('en-US')} − ${calc.costIls.toLocaleString('en-US')} − ${calc.feesIls.toLocaleString('en-US')} = ${signed(calc.nominal)} ₪`))}
        ${step('רווח בדולרים בשער המכירה (A) = (תמורה $ − עלות $ − עמלות $) × שער מכירה', L(`(${usd(lot.proceedsUsd)} − ${usd(lot.costUsd)} − ${usd(fees)}) × ${rs} = ${signed(A)} ₪`))}
        ${step('סכום אינפלציוני = עלות ₪ × (שער מכירה ÷ שער רכישה − 1)', L(`${calc.costIls.toLocaleString('en-US')} × (${rs} ÷ ${rb} − 1) = ${signed(calc.inflRaw)} ₪`), inflNote)}
        ${step('רווח ריאלי = הקטן מבין A ו‑B (בהפסד: ההפסד הקטן יותר)', L(`${realRule} = ${signed(calc.real)} ₪`), '', 'result')}
        ${calc.real > 0 ? step('מס משוער = 25% × רווח ריאלי', L(`${calc.real.toLocaleString('en-US')} × 25% = ${calc.tax.toLocaleString('en-US')} ₪`), 'המס הסופי מחושב בסיכום, אחרי קיזוז הפסדים של אותה שנה.', 'result') : ''}
      </ol>
      <p class="case">${esc(Core.SCENARIO_TEXT[calc.scenario] || '')}</p>
      <h3>בקרת שערים</h3>
      ${checksTable(it)}
      <p class="intraday" data-intraday="${lot.id}">${lot.timeSold ? '' : 'כדי לראות את שער השוק בדקת המכירה, מוסיפים את שעת המכירה בעריכת העסקה.'}</p>
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

  function renderExplainAll(example) {
    const ex = example && example.calc.ok ? example : null;
    let sub = '';
    if (ex) {
      const { calc } = ex;
      const lot = ex.capLot;
      const fees = isFinite(lot.feesUsd) ? lot.feesUsd : 0;
      const rb = calc.buy.rate, rs = calc.sell.rate;
      const A = Core.roundILS(Core.closedFormReal(lot, rb, rs).A);
      sub = `<h3>הצבה במספרים שלך (${esc(lot.symbol || 'עסקה')} ${esc(lot.planType || '')}, נמכרה ${Core.formatDateIL(lot.dateSold)})</h3>
        <div class="formula">
          <span><var>P</var> = ${L(usd(lot.proceedsUsd))} $, <var>C</var> = ${L(usd(lot.costUsd))} $, <var>F</var> = ${L(usd(fees))} $, <var>R<sub>b</sub></var> = ${L(rb)}, <var>R<sub>s</sub></var> = ${L(rs)}</span>
          <span>A = ${L(`(${usd(lot.proceedsUsd)} − ${usd(lot.costUsd)} − ${usd(fees)}) × ${rs} = ${signed(A)}`)}</span>
          <span>B = ${L(`${usd(lot.proceedsUsd)} × ${rs} − ${usd(lot.costUsd)} × ${rb} − ${usd(fees)} × ${rs} = ${signed(calc.nominal)}`)}</span>
          <span>רווח ריאלי = ${L(`${signed(calc.real)} ₪`)} · מס = ${L(`${fmt(calc.tax)} ₪`)}</span>
        </div>
        <p>${esc(Core.SCENARIO_TEXT[calc.scenario] || '')} את החישוב המלא של כל עסקה רואים בלחיצה על "הצגת החישוב" ליד העסקה.</p>`;
    }
    $('#explain-body').innerHTML = `
      <h3>הפרמטרים של כל מכירה (lot)</h3>
      <dl class="params">
        <dt>P</dt><dd>התמורה בדולרים (Total Proceeds ב‑E*Trade)</dd>
        <dt>C</dt><dd>העלות בדולרים (Adjusted Cost Basis: השווי ביום הרכישה או ההבשלה)</dd>
        <dt>F</dt><dd>עמלות מכירה בדולרים, אם לא נוכו כבר מהתמורה</dd>
        <dt>R<sub>b</sub></dt><dd>השער היציג של בנק ישראל ביום הרכישה</dd>
        <dt>R<sub>s</sub></dt><dd>השער היציג של בנק ישראל ביום המכירה</dd>
      </dl>
      <h3>שלב 1: המרה לשקלים ורווח נומינלי</h3>
      <div class="formula">
        <span>תמורה ₪ = ${L('P × Rs')} · עלות ₪ = ${L('C × Rb')} · הוצאות ₪ = ${L('F × Rs')}</span>
        <span>רווח נומינלי: ${L('B = P×Rs − C×Rb − F×Rs')}</span>
      </div>
      <h3>שלב 2: הסכום האינפלציוני (השער כ"מדד")</h3>
      <p>ליחיד שקנה נייר ערך בדולרים, שער הדולר משמש כמדד. החלק של הרווח שנובע רק מעליית הדולר פטור ממס:</p>
      <div class="formula"><span>סכום אינפלציוני = ${L('C×Rb × (Rs ÷ Rb − 1) = C × (Rs − Rb)')}</span></div>
      <p>כשהשקל נחלש (<bdi class="ltr">Rs &gt; Rb</bdi>) הסכום חיובי ופטור. כשהשקל התחזק הוא שלילי: ברווח הוא נחשב 0, ובהפסד מנטרלים אותו (הלכת מוזס).</p>
      <h3>שלב 3: רווח ריאלי בנוסחה אחת</h3>
      <div class="formula">
        <span>${L('A = (P − C − F) × Rs')}: הרווח בדולרים, מומר בשער המכירה</span>
        <span>${L('B = P×Rs − C×Rb − F×Rs')}: הרווח הנומינלי בשקלים</span>
        <span>רווח ריאלי = ${L('min(A, B)')} אם שניהם רווח · ${L('max(A, B)')} אם שניהם הפסד · 0 אם הסימנים שונים</span>
      </div>
      <p>במילים: לוקחים את התוצאה הקטנה יותר בערך מוחלט. כך מקבלים בדיוק את ארבע הדוגמאות שבחוזר מס הכנסה 10/2025.</p>
      <h3>שלב 4: מס רווח הון</h3>
      <div class="formula"><span>מס = ${L('25% × max(0, Σ real gains − Σ allowed losses)')}</span></div>
      <ul>
        <li>מקזזים הפסדים מול רווחים של אותה שנה. בחצי השנה מחשבים את המקדמה (עד 31.7 ועד 31.1). הפסד שנשאר עובר לשנים הבאות.</li>
        <li>מס רווח הון הוא בשיעור קבוע של 25% (30% לבעל מניות מהותי), לא לפי מדרגות.</li>
        <li>מס יסף: 3% על הכנסה חייבת מעל ‏721,560 ₪ בשנה, ועוד 2% על הכנסה הונית מעל הסף (מ‑2025). הכלי לא מחשב אותו.</li>
      </ul>
      <h3>מה ההבדל בין מס שולי למס רווח הון?</h3>
      <ul>
        <li><b>ההטבה מהמעסיק היא הכנסת עבודה, במס שולי</b> לפי המדרגות (10% עד 47%, ועוד מס יסף). ב‑ESPP: ההנחה, כלומר (השווי ביום הרכישה פחות המחיר ששילמת) × כמות. ב‑RSU: השווי ביום ההבשלה. המס הזה משולם דרך המשכורת.</li>
        <li><b>מה שקרה למניה אחרי זה הוא רווח הון, ב‑25%.</b> לכן העלות בחישוב היא השווי ביום הרכישה או ההבשלה (Adjusted Cost Basis), ולא המחיר ששילמת. אחרת ההנחה הייתה ממוסה פעמיים.</li>
        <li><b>במסלול 102 רווח הון עם נאמן</b> המס על ההטבה לא משולם במשכורת אלא במכירה, והנאמן מנכה אותו:
          <ul>
            <li>הכנסת עבודה ${L('W = min(V, P − F) − Cp')}, במס שולי. ‏V הוא שווי ההטבה: ב‑ESPP השווי ביום הרכישה (כלומר W היא ההנחה), וב‑RSU ממוצע מחירי הסגירה ב‑30 ימי המסחר שלפני ההענקה. ‏Cp הוא מה ששילמת.</li>
            <li>רווח ההון הוא היתרה, ב‑25%. הוא מחושב כרווח ריאלי בדיוק כמו למעלה, עם עלות ${L('C = Cp + W')} בשער של יום ההקצאה לנאמן.</li>
            <li>מכירה לפני תום 24 חודשים מההקצאה מוציאה את המניות מהמסלול: כל הרווח הוא הכנסת עבודה.</li>
            <li>אין הכרעה רשמית אם חלק רווח ההון ב‑102 מחושב ריאלית או נומינלית. הכלי מחשב ריאלית, וכדאי לוודא עם רואה החשבון.</li>
          </ul></li>
      </ul>
      ${sub}`;
  }

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

  function openEditor(id) {
    clearTimeout(draftTimer); // a pending save belongs to the previous session
    const lot = id ? lots.find(l => l.id === id) : blankLot();
    editingId = id || null;
    $('#lot-dialog-title').textContent = id ? 'עריכת עסקה' : 'עסקה חדשה';
    for (const k of ['symbol', 'planType', 'dateAcquired', 'dateSold', 'timeSold', 'rateBuy', 'rateSell', 'grantDate', 'avg30']) F(k).value = lot[k] ?? '';
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
  const DRAFT_FIELDS = ['symbol', 'planType', 'qty', 'dateAcquired', 'dateSold', 'timeSold', 'proceedsUsd', 'costUsd', 'feesUsd', 'rateBuy', 'rateSell', 'grantDate', 'paidUsd', 'avg30', 'withheldIls'];
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
    // PDF and images are not tables: say so instead of "the file is empty".
    if (/\.(pdf|png|jpe?g|gif|webp|heic)$/i.test(file.name) || /^(image\/|application\/pdf)/.test(file.type)) {
      setMsg(msg, `הקובץ ${file.name} הוא PDF או תמונה, והכלי קורא כרגע רק קובצי Excel או CSV. ב‑E*Trade מורידים את הדוח דרך Download ואז Download Expanded, או מוסיפים את העסקה ידנית.`, 'err', {
        actions: [{ label: 'בחירת קובץ אחר', run: () => $('#file').click() }, { label: 'הוספת עסקה ידנית', run: () => openEditor(null) }],
      });
      return;
    }
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

  const VIEWS = ['report', 'sim', 'formulas'];

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
      document.querySelector('.dz-title').textContent = 'בחירת קובץ Excel מ‑E*Trade';
      document.querySelector('.dz-sub').innerHTML = 'הקובץ <bdi>G&amp;L_Expanded.xlsx</bdi> או CSV';
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
