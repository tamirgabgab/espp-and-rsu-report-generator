/*
 * "What if" stock chart, shown inside a lot's calculation panel.
 *
 * The chart draws the stock's daily closes and movable points: the start of
 * the ESPP offering period (lookback), the purchase / vest date, and the sale
 * date. For an RSU on the section 102 track the vest date changes nothing, so
 * the grant date is the movable point instead (it sets the 30-day average and
 * the start of the 24 months). Each point can be dragged (mouse / touch), moved with the arrow
 * keys, or set with a date field. A comparison table shows the actual result
 * next to the "what if" result; a moved sale is priced at that day's low and
 * high. "חזרה לנתונים האמיתיים" puts the points back.
 */
(function () {
  'use strict';
  const Core = window.Core;
  const DAY = 86400000;
  const H = 220, M = { l: 48, r: 16, t: 16, b: 28 };

  const t = iso => Date.parse(`${iso}T00:00:00Z`);
  const D = iso => Core.formatDateIL(iso);

  const POINTS = {
    offer: { label: 'תחילת התקופה', aria: 'תחילת תקופת ההצעה (Lookback)', cls: 'offer' },
    grant: { label: 'הענקה', aria: 'תאריך ההענקה (ממוצע 30 הימים ותחילת 24 החודשים)', cls: 'offer' },
    buy: { label: 'רכישה', aria: 'תאריך הרכישה', cls: 'buy' },
    sale: { label: 'מכירה', aria: 'תאריך המכירה', cls: 'sale' },
  };

  function mount(el, { lot, is102, state, onState }) {
    const App = window.App;
    const prices = App.PRICES[lot.symbol];
    if (!prices || !lot.dateAcquired || !lot.dateSold) { el.innerHTML = ''; return; }
    const isEspp = lot.planType === 'ESPP';
    const isGrant = lot.planType === 'RSU' && is102 && !!lot.grantDate;
    const actual = { offerStart: isEspp ? Core.offeringStart(lot) : '', buyDate: lot.dateAcquired, saleDate: lot.dateSold, grantDate: isGrant ? lot.grantDate : '' };
    let st = { ...actual, ...(state || {}) };
    const keys = isEspp ? ['offer', 'buy', 'sale'] : isGrant ? ['grant', 'sale'] : ['buy', 'sale'];
    const field = { offer: 'offerStart', grant: 'grantDate', buy: 'buyDate', sale: 'saleDate' };
    const rsuVest = lot.planType === 'RSU' ? { label: 'הבשלה', aria: 'תאריך ההבשלה' } : null;
    const P = k => (k === 'buy' && rsuVest ? { ...POINTS.buy, ...rsuVest } : POINTS[k]);

    // Trading days in view: from 3 months before the earliest point to the last price we have.
    const all = Object.keys(prices.rates).sort();
    const first = keys.map(k => st[field[k]]).concat(keys.map(k => actual[field[k]])).sort()[0];
    const from = Core.addDays(first, -90);
    const days = all.filter(d => d >= from);
    if (days.length < 5) { el.innerHTML = ''; return; }
    const idxOf = iso => { let lo = 0, hi = days.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (days[m] <= iso) lo = m; else hi = m - 1; } return lo; };
    const snap = iso => days[idxOf(iso)];
    for (const k of keys) st[field[k]] = snap(st[field[k]]);
    // A point on its actual (snapped) day stands for the actual date, even when that was not a trading day.
    const isActual = k => !keys.includes(k) || st[field[k]] === snap(actual[field[k]]);
    const scenario = () => ({ ...st, ...Object.fromEntries(keys.filter(isActual).map(k => [field[k], actual[field[k]]])) });

    el.innerHTML = `
      <div class="wi-chart" dir="ltr"></div>
      <div class="grid wi-dates">
        ${keys.map(k => `<div class="field"><label for="wi-${k}-${lot.id}-${el.closest('.lots-mobile') ? 'm' : 'd'}"><i class="sw wi-${P(k).cls}"></i> ${P(k).aria}</label>
          <input id="wi-${k}-${lot.id}-${el.closest('.lots-mobile') ? 'm' : 'd'}" type="date" data-wi-key="${k}" min="${days[0]}" max="${days[days.length - 1]}" aria-describedby="wi-${k}-${lot.id}-${el.closest('.lots-mobile') ? 'm' : 'd'}-il">
          <span class="wi-date-il" id="wi-${k}-${lot.id}-${el.closest('.lots-mobile') ? 'm' : 'd'}-il" data-wi-il="${k}"></span></div>`).join('')}
      </div>
      <p class="hint">גוררים נקודה בגרף, מזיזים אותה עם החצים במקלדת (יום) או עם PageUp ו‑PageDown (חודש), או בוחרים תאריך.</p>
      <div class="wi-compare" aria-live="polite"></div>
      <div class="actions"><button type="button" class="btn btn-sm" data-wi-reset>חזרה לנתונים האמיתיים</button></div>`;
    const chart = el.querySelector('.wi-chart');
    const compare = el.querySelector('.wi-compare');
    let svg = null, xOf = null, focusKey = null, lastW = 0;

    function clamp(k, iso) {
      iso = snap(iso);
      if (k === 'offer' && iso > st.buyDate) iso = st.buyDate;
      if (k === 'grant') {
        const max = st.saleDate < lot.dateAcquired ? st.saleDate : lot.dateAcquired; // not after the vest or the sale
        if (iso > max) iso = snap(max);
      }
      if (k === 'buy') {
        if (isEspp && iso < st.offerStart) iso = st.offerStart;
        if (iso > st.saleDate) iso = st.saleDate;
      }
      if (k === 'sale' && iso < st.buyDate) iso = snap(st.buyDate);
      return iso;
    }

    function set(k, iso) {
      const v = clamp(k, iso);
      if (st[field[k]] === v) return;
      st[field[k]] = v;
      onState(keys.every(isActual) ? null : { ...st });
      draw();
      table();
    }

    // ---------------------------------------------------------------- chart
    function draw() {
      const W = Math.max(280, chart.clientWidth || el.clientWidth || 600);
      const x0 = t(days[0]), x1 = t(days[days.length - 1]);
      const closes = days.map(d => prices.rates[d]);
      const lows = days.map(d => (prices.low && prices.low[d]) || prices.rates[d]);
      const highs = days.map(d => (prices.high && prices.high[d]) || prices.rates[d]);
      let yMin = Math.min(...lows), yMax = Math.max(...highs);
      const pad = (yMax - yMin) * 0.08 || 1;
      yMin -= pad; yMax += pad;
      xOf = iso => M.l + ((t(iso) - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
      const yOf = v => M.t + (1 - (v - yMin) / (yMax - yMin)) * (H - M.t - M.b);
      const path = days.map((d, i) => `${i ? 'L' : 'M'}${xOf(d).toFixed(1)},${yOf(closes[i]).toFixed(1)}`).join('');
      // Axis ticks: 4 prices; dates at most one per 90 px (three or four on a phone).
      const yTicks = [0, 1, 2, 3].map(i => yMin + ((yMax - yMin) * (i + 0.5)) / 4);
      const months = (x1 - x0) / DAY / 30.44;
      const maxTicks = Math.max(2, Math.floor((W - M.l - M.r) / 90));
      const step = [1, 2, 3, 6, 12, 24].find(s => months / s <= maxTicks) || 36;
      const xTicks = [];
      for (let d = new Date(x0); d.getTime() <= x1; d.setUTCMonth(d.getUTCMonth() + 1)) {
        if ((d.getUTCFullYear() * 12 + d.getUTCMonth()) % step === 0) xTicks.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
      }
      const tickLabel = d => (step >= 12 ? String(d.getUTCFullYear()) : `${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`);
      const pt = k => { const iso = st[field[k]]; return { iso, x: xOf(iso), y: yOf(prices.rates[iso]) }; };
      const ghost = k => { const iso = snap(actual[field[k]]); return iso === st[field[k]] ? '' : `<circle class="wi-ghost wi-${P(k).cls}" cx="${xOf(iso).toFixed(1)}" cy="${yOf(prices.rates[iso]).toFixed(1)}" r="6"/>`; };
      const sale = pt('sale');
      const lo = prices.low && prices.low[sale.iso], hi = prices.high && prices.high[sale.iso];
      const range = lo && hi ? `<line class="wi-range" x1="${sale.x.toFixed(1)}" x2="${sale.x.toFixed(1)}" y1="${yOf(hi).toFixed(1)}" y2="${yOf(lo).toFixed(1)}"/>` : '';
      // Point labels: kept inside the plot, and moved under the point when they would overlap another label.
      const LABEL_H = 16, charW = 7;
      // Labels must not cover any point either.
      const placed = keys.map(k => { const p = pt(k); return { l: p.x - 9, r: p.x + 9, t: p.y - 9, b: p.y + 9 }; });
      const labelOf = k => {
        const p = pt(k), text = P(k).label, w = text.length * charW;
        let x = p.x, anchor = 'middle';
        if (x - w / 2 < M.l) { x = Math.max(p.x - 10, M.l); anchor = 'start'; } else if (x + w / 2 > W - M.r) { x = Math.min(p.x + 10, W - M.r); anchor = 'end'; }
        const box = y => { const l = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2; return { l, r: l + w, t: y - 12, b: y + 4 }; };
        const hits = b => placed.some(o => b.l < o.r && o.l < b.r && b.t < o.b && o.t < b.b);
        const above = p.y - 14, below = p.y + 24;
        let y = p.y < M.t + 28 ? below : above;
        if (hits(box(y))) y = y === above ? below : above;
        if (hits(box(y))) y = (y === below ? below : above) + (y === below ? LABEL_H : -LABEL_H);
        placed.push(box(y));
        return { x, y, anchor, text };
      };
      const handle = k => {
        const p = pt(k), lb = labelOf(k);
        const val = k === 'sale' && lo && hi ? `${D(p.iso)}, ${lo}–${hi} $` : `${D(p.iso)}, ${prices.rates[p.iso]} $`;
        return `<g class="wi-handle wi-${P(k).cls}" data-key="${k}" tabindex="0" role="slider" aria-label="${P(k).aria}"
            aria-valuemin="0" aria-valuemax="${days.length - 1}" aria-valuenow="${idxOf(p.iso)}" aria-valuetext="${val}">
          <circle class="hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="22"/>
          <circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7"/>
          <text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" text-anchor="${lb.anchor}">${lb.text}</text>
        </g>`;
      };
      lastW = W;
      const keepFocus = focusKey; // replacing the SVG fires focusout, which clears focusKey
      chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="מחיר המניה ${App.esc(lot.symbol)} עם נקודות שאפשר להזיז">
        ${yTicks.map(v => `<line class="gl" x1="${M.l}" x2="${W - M.r}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}"/><text class="axis" x="${M.l - 6}" y="${(yOf(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('')}
        ${xTicks.map(d => { const x = xOf(d.toISOString().slice(0, 10)); return x < M.l || x > W - M.r ? '' : `<text class="axis" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${tickLabel(d)}</text>`; }).join('')}
        <path class="wi-line" d="${path}"/>
        ${range}
        ${keys.map(ghost).join('')}
        ${keys.map(handle).join('')}
      </svg>`;
      svg = chart.querySelector('svg');
      for (const inp of el.querySelectorAll('[data-wi-key]')) if (document.activeElement !== inp) inp.value = st[field[inp.dataset.wiKey]];
      // The date field follows the browser's language; show the app's format next to it.
      for (const s of el.querySelectorAll('[data-wi-il]')) s.textContent = D(st[field[s.dataset.wiIl]]);
      if (keepFocus) { focusKey = keepFocus; const h = svg.querySelector(`[data-key="${keepFocus}"]`); if (h) h.focus(); }
    }

    // ---------------------------------------------------------------- comparison
    function table() {
      const ctx = { rates: App.RATES, prices: App.PRICES, is102, settings: App.profile };
      const real = Core.evaluateLot(lot, ctx);
      const { variants } = Core.whatIfLots(lot, scenario(), App.PRICES);
      const cols = [{ label: 'בפועל', r: real }].concat(variants.map(v => ({ label: `מה אם · ${v.label}`, r: Core.evaluateLot(v.lot, ctx) })));
      if (!real.ok) { compare.innerHTML = ''; return; }
      const money = v => (isFinite(v) ? App.usd(v) : '—');
      const shek = v => (isFinite(v) ? App.fmt(v) : '—');
      const rows = [
        isEspp ? ['מחיר רכישה למניה $', c => money(c.r.paidPerShare)] : null,
        is102 ? [lot.planType === 'RSU' ? 'שווי ההטבה למניה $ (ממוצע 30 יום)' : 'שווי ההטבה למניה $', c => money(c.r.benefitPerShare)]
          : [lot.planType === 'RSU' ? 'שווי ביום ההבשלה למניה $' : 'שווי ביום הרכישה למניה $', c => money(c.r.fmvPerShare)],
        ['מחיר מכירה למניה $', c => money(c.r.salePerShare)],
        ['שער מכירה', c => (c.r.calc.sell ? c.r.calc.sell.rate : '—')],
        ['תמורה ₪', c => shek(c.r.calc.proceedsIls)],
        [is102 ? 'הכנסת עבודה ₪' : 'הטבה במשכורת ₪', c => shek(c.r.workIls)],
        [is102 ? 'מס שולי משוער ₪' : 'מס במשכורת, משוער ₪', c => shek(c.r.workTax)],
        ['רווח ריאלי ₪', c => shek(c.r.calc.real)],
        ['מס רווח הון ₪', c => shek(c.r.calc.tax)],
        ['מזומן אחרי מס ₪', c => shek(c.r.cash)],
        ['רווח נקי ₪', c => shek(c.r.net), 'total'],
      ].filter(Boolean);
      if (!variants.length) {
        compare.innerHTML = `<p class="hint">הנקודות במקומות האמיתיים. ${isEspp ? `תחילת התקופה: ${D(st.offerStart)}${lot.offerStart ? '' : ' (הנחה: חצי שנה לפני הרכישה)'}. ` : ''}מחירי הסגירה של ${App.esc(lot.symbol)} מ‑Yahoo Finance. אחרי שמזיזים נקודה מופיעה כאן השוואה בין התוצאה בפועל לתוצאה החדשה.</p>`;
        return;
      }
      const diff = variants.length ? `<tr class="diff"><th scope="row">הפרש ברווח הנקי ₪</th><td></td>${cols.slice(1).map(c => `<td class="num ${c.r.ok && c.r.net - real.net > 0 ? 'gain' : c.r.ok && c.r.net - real.net < 0 ? 'loss' : ''}">${c.r.ok ? App.signed(c.r.net - real.net) : '—'}</td>`).join('')}</tr>` : '';
      compare.innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="השוואה: בפועל מול מה אם, ${App.esc(lot.symbol)} ${D(lot.dateSold)}"><table class="mini-table wi-table">
          <thead><tr><th scope="col"><span class="visually-hidden">נתון</span></th>${cols.map(c => `<th scope="col">${c.label}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(([label, f, cls]) => `<tr class="${cls || ''}"><th scope="row">${label}</th>${cols.map(c => `<td class="num">${c.r.ok ? f(c) : '—'}</td>`).join('')}</tr>`).join('')}${diff}</tbody>
        </table></div>
        <p class="hint">${variants.length
          ? `${variants.some(v => v.key === 'low') ? `המכירה הוזזה ל‑${D(st.saleDate)}: מוצג טווח המחירים של אותו יום, מהנמוך לגבוה. ` : ''}${isGrant && !isActual('grant') ? `ההענקה הוזזה ל‑${D(st.grantDate)}: ממוצע 30 הימים מחושב מחדש, וגם מועד תום 24 החודשים זז. ` : ''}${isActual('buy') && isActual('offer') ? '' : 'רכישה שהוזזה מתומחרת לפי מחירי הסגירה: השווי לפי הסגירה ביום הרכישה, ומחיר הרכישה לפי 85% מהנמוך בין תחילת התקופה ליום הרכישה (Lookback). '}השערים היציגים מתעדכנים לפי התאריכים. המס השולי לפי השיעור שהגדרת.`
          : `הנקודות במקומות האמיתיים. ${isEspp ? `תחילת התקופה: ${D(st.offerStart)}${lot.offerStart ? '' : ' (הנחה: חצי שנה לפני הרכישה)'}. ` : ''}מחירי הסגירה של ${App.esc(lot.symbol)} מ‑Yahoo Finance.`}</p>`;
    }

    // ---------------------------------------------------------------- input
    let dragKey = null, raf = 0;
    const dateAt = clientX => {
      const r = svg.getBoundingClientRect();
      const W = svg.viewBox.baseVal.width;
      const x = ((clientX - r.left) / r.width) * W;
      const ms = t(days[0]) + ((x - M.l) / (W - M.l - M.r)) * (t(days[days.length - 1]) - t(days[0]));
      return new Date(Math.max(t(days[0]), Math.min(t(days[days.length - 1]), ms))).toISOString().slice(0, 10);
    };
    chart.addEventListener('pointerdown', e => {
      const h = e.target.closest('.wi-handle');
      if (!h) return;
      e.preventDefault();
      dragKey = h.dataset.key;
      focusKey = dragKey;
      chart.setPointerCapture(e.pointerId);
      chart.classList.add('dragging');
    });
    chart.addEventListener('pointermove', e => {
      if (!dragKey) return;
      const x = e.clientX;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => set(dragKey, dateAt(x)));
    });
    const end = () => { dragKey = null; chart.classList.remove('dragging'); };
    chart.addEventListener('pointerup', end);
    chart.addEventListener('pointercancel', end);
    chart.addEventListener('focusin', e => { const h = e.target.closest('.wi-handle'); if (h) focusKey = h.dataset.key; });
    chart.addEventListener('focusout', e => { if (!chart.contains(e.relatedTarget)) focusKey = null; });
    chart.addEventListener('keydown', e => {
      const h = e.target.closest('.wi-handle');
      if (!h) return;
      const k = h.dataset.key;
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 21, PageDown: -21 }[e.key];
      let i = idxOf(st[field[k]]);
      if (step) i += step;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = days.length - 1;
      else return;
      e.preventDefault();
      focusKey = k;
      set(k, days[Math.max(0, Math.min(days.length - 1, i))]);
    });
    el.addEventListener('change', e => {
      const k = e.target.dataset && e.target.dataset.wiKey;
      if (k && e.target.value) set(k, e.target.value);
    });
    el.querySelector('[data-wi-reset]').addEventListener('click', () => {
      st = { ...actual };
      for (const k of keys) st[field[k]] = snap(st[field[k]]);
      onState(null);
      draw();
      table();
    });

    draw();
    table();
    // Redraw at the new width when the panel is resized (rotation, window resize).
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!el.isConnected) { ro.disconnect(); return; }
        if (chart.clientWidth && Math.abs(chart.clientWidth - lastW) > 4) draw();
      });
      ro.observe(chart);
    }
  }

  window.WhatIf = { mount };
})();
