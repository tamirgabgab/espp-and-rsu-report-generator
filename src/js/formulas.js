/*
 * Formulas view: a live calculator that shows each tax formula in general form
 * and then with the user's numbers, for ESPP / RSU on the section 102 trustee
 * track or the regular (payroll) track, with the conversion to shekels.
 *
 * It reuses the report's calculation (Core.computeLot / Core.computeLot102).
 * The calculator inputs are a per-browser convenience (localStorage "f1399.formulas").
 */
(function () {
  'use strict';
  const Core = window.Core;
  const $ = sel => document.querySelector(sel);
  const LS = 'f1399.formulas';
  let App;

  const EXAMPLE = {
    plan: 'ESPP', track: '102', symbol: 'QCOM', qty: '17', grantDate: '2024-03-01', buyDate: '2024-01-31',
    fmv: '', avg30: '', paid: '126.23', saleDate: '2026-05-11', price: '231.7035', fees: '0', rb: '', rs: '',
  };
  let st = { ...EXAMPLE };

  const n = v => (v === '' || v === null || v === undefined ? NaN : +v);
  const D = iso => Core.formatDateIL(iso);
  const money = v => App.usd(v);
  const num = v => Number(v).toLocaleString('en-US');

  function persist() { App.store.set(LS, st); }

  // ------------------------------------------------------------ derived inputs

  function derive() {
    const plan = st.plan, is102 = st.track === '102';
    const prices = App.PRICES[(st.symbol || '').toUpperCase()];
    const close = iso => (prices && iso ? Core.lookupRate(prices.rates, iso) : null);
    const fmvAuto = close(st.buyDate);
    const avgAuto = prices && st.grantDate ? Core.avgCloseBefore(prices, st.grantDate) : null;
    const rbDate = is102 && plan === 'RSU' ? st.grantDate : st.buyDate;
    const rbAuto = rbDate ? Core.lookupRate(App.RATES, rbDate) : null;
    let rsAuto = st.saleDate ? Core.lookupRate(App.RATES, st.saleDate) : null;
    let rsIsLast = false;
    const meta = window.USD_ILS_RATES;
    if (!rsAuto && st.saleDate && meta && st.saleDate > meta.last) { rsAuto = { rate: meta.rates[meta.last], date: meta.last }; rsIsLast = true; }
    const qty = n(st.qty);
    const fmv = isFinite(n(st.fmv)) ? n(st.fmv) : fmvAuto ? fmvAuto.rate : NaN;
    const avg = isFinite(n(st.avg30)) ? n(st.avg30) : avgAuto ? avgAuto.avg : NaN;
    const rb = isFinite(n(st.rb)) && n(st.rb) > 0 ? n(st.rb) : rbAuto ? rbAuto.rate : NaN;
    const rs = isFinite(n(st.rs)) && n(st.rs) > 0 ? n(st.rs) : rsAuto ? rsAuto.rate : NaN;
    return { plan, is102, prices, fmvAuto, avgAuto, rbDate, rbAuto, rsAuto, rsIsLast, qty, fmv, avg, rb, rs };
  }

  // ------------------------------------------------------------ inputs

  function renderInputs() {
    const d = derive();
    for (const b of document.querySelectorAll('#fx-plan [data-plan]')) { const on = b.dataset.plan === st.plan; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const b of document.querySelectorAll('#fx-track [data-track]')) { const on = b.dataset.track === st.track; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    const show = { RSU: st.plan === 'RSU', ESPP: st.plan === 'ESPP', FMV: st.plan === 'ESPP' || !d.is102, AVG: st.plan === 'RSU' && d.is102 };
    for (const el of document.querySelectorAll('#fx-inputs [data-show]')) el.hidden = !show[el.dataset.show];
    for (const el of document.querySelectorAll('#fx-inputs [data-fx]')) if (document.activeElement !== el) el.value = st[el.dataset.fx] ?? '';
    $('#fx-buy-label').innerHTML = st.plan === 'RSU' ? 'תאריך הבשלה <bdi>(Vest)</bdi>' : 'תאריך רכישה';
    $('#fx-fmv-label').textContent = st.plan === 'RSU' ? 'שווי ביום ההבשלה ($ למניה)' : 'מחיר שוק ביום הרכישה ($ למניה)';
    $('#fx-rb-label').innerHTML = `${d.is102 ? 'שער ביום ההקצאה' : st.plan === 'RSU' ? 'שער ביום ההבשלה' : 'שער ביום הרכישה'} <bdi>(R<sub>b</sub>)</bdi>`;
    $('#fx-fmv').placeholder = d.fmvAuto ? `אוטומטי: ${d.fmvAuto.rate}` : '';
    $('#fx-fmv-note').textContent = d.fmvAuto ? `מחיר הסגירה ב‑${D(d.fmvAuto.date)}. משאירים ריק כדי להשתמש בו.` : d.prices ? '' : 'אין מחירים לסימול הזה, צריך להקליד.';
    $('#fx-avg').placeholder = d.avgAuto ? `אוטומטי: ${d.avgAuto.avg}` : '';
    $('#fx-avg-note').textContent = d.avgAuto ? `מ‑${D(d.avgAuto.from)} עד ${D(d.avgAuto.to)}. משאירים ריק כדי להשתמש בו.` : 'מזינים תאריך הענקה, או מקלידים את הממוצע מדוח הנאמן.';
    const last = Core.lastClose(d.prices);
    $('#fx-price-note').textContent = last ? `סגירה אחרונה של ${st.symbol}: ${last.price} ב‑${D(last.date)}.` : '';
    $('#fx-rb').placeholder = d.rbAuto ? `יציג: ${d.rbAuto.rate}` : '';
    $('#fx-rb-note').textContent = d.rbAuto ? `השער היציג של ${D(d.rbAuto.date)}. משאירים ריק כדי להשתמש בו.` : '';
    $('#fx-rs').placeholder = d.rsAuto ? `יציג: ${d.rsAuto.rate}` : '';
    $('#fx-rs-note').textContent = d.rsAuto ? (d.rsIsLast ? `אין עדיין שער ליום המכירה, נלקח האחרון (${D(d.rsAuto.date)}).` : `השער היציג של ${D(d.rsAuto.date)}.`) : '';
    // "Fill from my lot"
    const lots = App.reportLots().filter(l => l.planType === 'ESPP' || l.planType === 'RSU');
    $('#fx-fill-wrap').hidden = !lots.length;
    $('#fx-fill').innerHTML = '<option value="">בחירת עסקה…</option>' + lots.map((l, i) => `<option value="${i}">${App.esc(l.symbol || '—')} ${l.planType} · ${isFinite(l.qty) ? `${l.qty} מניות · ` : ''}נמכרה ${D(l.dateSold) || '—'}</option>`).join('');
  }

  // ------------------------------------------------------------ calculation

  function compute(d) {
    const issues = [];
    const price = n(st.price), fees = isFinite(n(st.fees)) ? n(st.fees) : 0;
    const paidPs = st.plan === 'ESPP' ? n(st.paid) : 0;
    if (!(d.qty > 0)) issues.push('חסרה כמות מניות');
    if (!(price >= 0) || st.price === '') issues.push('חסר מחיר מכירה');
    if (!st.saleDate) issues.push('חסר תאריך מכירה');
    if (st.plan === 'ESPP' && !isFinite(paidPs)) issues.push('חסר המחיר ששילמת למניה');
    if (st.plan === 'RSU' && d.is102 && !st.grantDate) issues.push('חסר תאריך הענקה');
    if (!(st.plan === 'RSU' && d.is102) && !st.buyDate) issues.push(st.plan === 'RSU' ? 'חסר תאריך הבשלה' : 'חסר תאריך רכישה');
    const perShare = st.plan === 'RSU' && d.is102 ? d.avg : d.fmv;
    if (!isFinite(perShare)) issues.push(st.plan === 'RSU' && d.is102 ? 'חסר ממוצע 30 הימים' : st.plan === 'RSU' ? 'חסר השווי ביום ההבשלה' : 'חסר מחיר השוק ביום הרכישה');
    if (!isFinite(d.rs)) issues.push('חסר שער ליום המכירה');
    if (issues.length) return { ok: false, issues };

    const P = Core.round2(price * d.qty), F = fees, V = Core.round2(perShare * d.qty), Cp = Core.round2(paidPs * d.qty);
    const overrides = { rateBuy: isFinite(d.rb) ? d.rb : '', rateSell: d.rs };
    let calc, workIls = 0, workTax = 0, payroll = null;
    if (d.is102) {
      const lot = { symbol: st.symbol, planType: st.plan, qty: d.qty, dateAcquired: st.buyDate, grantDate: st.grantDate, dateSold: st.saleDate, proceedsUsd: P, costUsd: V, paidUsd: Cp, avg30: String(d.avg), feesUsd: F };
      calc = Core.computeLot102(lot, App.RATES, overrides, { prices: App.PRICES });
      if (calc.ok) { workIls = calc.workIls; workTax = Core.workTax(workIls, App.profile); }
    } else {
      calc = Core.computeLot({ dateAcquired: st.buyDate, dateSold: st.saleDate, proceedsUsd: P, costUsd: V, feesUsd: F }, App.RATES, overrides);
      if (calc.ok) {
        const w0 = Core.round2(V - Cp);
        const w0Ils = Core.roundILS(w0 * calc.buy.rate);
        payroll = { w0, w0Ils, tax: Core.workTax(w0Ils, App.profile) };
      }
    }
    if (!calc.ok) return { ok: false, issues: calc.issues };
    const rbUsed = calc.buy ? calc.buy.rate : d.rb;
    const paidIls = isFinite(rbUsed) ? Core.roundILS(Cp * rbUsed) : 0;
    return { ok: true, P, F, V, Cp, calc, workIls, workTax, payroll, rbUsed, paidIls };
  }

  // ------------------------------------------------------------ output

  const rate = () => (+App.profile.marginalRate || 0) + (App.profile.includeNi ? +App.profile.niRate || 0 : 0);
  const step = (what, general, subst, note = '', cls = '') => `<li class="${cls}"><span class="what">${what}</span>
    <span class="calc fx-general">${App.L(general)}</span><span class="calc">${App.L(subst)}</span>${note ? `<span class="note">${note}</span>` : ''}</li>`;

  function capitalSteps(r, d, label) {
    const c = r.calc;
    const C = r.calc.capCostUsd !== undefined && isFinite(r.calc.capCostUsd) ? r.calc.capCostUsd : r.V;
    const rb = c.buy.rate, rs = c.sell.rate;
    const cf = Core.closedFormReal({ proceedsUsd: r.P, costUsd: C, feesUsd: r.F }, rb, rs);
    const A = Core.roundILS(cf.A);
    const rule = cf.A >= 0 && cf.B >= 0 ? `min(${A}, ${c.nominal})` : cf.A <= 0 && cf.B <= 0 ? `max(${A}, ${c.nominal})` : '0';
    return `<h3>${label}</h3><ol class="steps">
      ${d.is102 ? step('עלות לרווח ההון', 'C = Cp + W', `${money(r.Cp)} + ${money(c.workUsd)} = ${money(C)} $`, 'מה ששילמת ועוד החלק שכבר ממוסה כהכנסת עבודה.') : step('עלות לרווח ההון', 'C = V', `${money(C)} $`, 'השווי שכבר מוסה במשכורת הוא העלות, כדי שההטבה לא תמוסה פעמיים.')}
      ${step('תמורה בשקלים', 'P × Rs', `${money(r.P)} × ${rs} = ${num(c.proceedsIls)} ₪`)}
      ${step('עלות בשקלים', 'C × Rb', `${money(C)} × ${rb} = ${num(c.costIls)} ₪`, `השער היציג של ${D(c.buy.date)}.`)}
      ${step('רווח נומינלי בשקלים (B)', 'B = P×Rs − C×Rb − F×Rs', `${num(c.proceedsIls)} − ${num(c.costIls)} − ${num(c.feesIls)} = ${App.signed(c.nominal)} ₪`)}
      ${step('רווח בדולרים בשער המכירה (A)', 'A = (P − C − F) × Rs', `(${money(r.P)} − ${money(C)} − ${money(r.F)}) × ${rs} = ${App.signed(A)} ₪`)}
      ${step('סכום אינפלציוני (פטור)', 'C×Rb × (Rs ÷ Rb − 1)', `${num(c.costIls)} × (${rs} ÷ ${rb} − 1) = ${App.signed(c.inflRaw)} ₪`, c.inflRaw > 0 ? 'השקל נחלש: החלק שנובע מעליית הדולר פטור.' : 'השקל התחזק או לא השתנה: אין סכום פטור.')}
      ${step('רווח ריאלי', 'min(A, B) | max(A, B) | 0', `${rule} = ${App.signed(c.real)} ₪`, App.esc(Core.SCENARIO_TEXT[c.scenario] || ''), 'result')}
      ${step('מס רווח הון', '25% × max(0, Real)', `25% × ${num(Math.max(0, c.real))} = ${num(c.tax)} ₪`, 'לפני קיזוז הפסדים של אותה שנה.', 'result')}
    </ol>`;
  }

  function renderOut() {
    const out = $('#fx-out');
    const d = derive();
    const r = compute(d);
    if (!r.ok) { out.innerHTML = `<ul class="lc-issues">${r.issues.map(i => `<li>${App.esc(i)}</li>`).join('')}</ul>`; return; }
    const c = r.calc;
    const rs = c.sell.rate;
    const paramsRows = [
      ['P', 'תמורה', `${money(r.P)} $`, `${num(d.qty)} × ${n(st.price)}`],
      ['F', 'עמלות', `${money(r.F)} $`, ''],
      ['V', st.plan === 'RSU' && d.is102 ? 'שווי ההטבה: ממוצע 30 הימים × כמות' : st.plan === 'RSU' ? 'שווי ביום ההבשלה × כמות' : 'מחיר שוק ביום הרכישה × כמות', `${money(r.V)} $`, ''],
      ['Cp', 'מה ששילמת', `${money(r.Cp)} $`, st.plan === 'RSU' ? 'ב‑RSU לא משלמים' : ''],
      ['Rb', d.is102 ? 'שער ביום ההקצאה' : 'שער ביום הרכישה או ההבשלה', isFinite(r.rbUsed) ? String(r.rbUsed) : '—', d.rbDate ? D(d.rbDate) : ''],
      ['Rs', 'שער ביום המכירה', String(rs), D(st.saleDate)],
    ];
    let html = `<h3>הפרמטרים</h3><dl class="params">${paramsRows.map(([k, t, v, x]) => `<dt>${k}</dt><dd>${t}: <b>${App.L(v)}</b>${x ? ` <span class="muted">(${App.L(x)})</span>` : ''}</dd>`).join('')}</dl>`;

    if (d.is102) {
      html += `<h3>שלב 1: הכנסת עבודה, במס שולי (הנאמן מנכה במכירה)</h3><ol class="steps">
        ${c.early
          ? step('הכנסת עבודה: כל הרווח', 'W = P − F − Cp', `${money(r.P)} − ${money(r.F)} − ${money(r.Cp)} = ${money(c.workUsd)} $`, `המכירה לפני ${D(c.unlock)}, תום 24 החודשים מההקצאה (${D(c.alloc)}). לכן כל הרווח הוא הכנסת עבודה.`)
          : step('הכנסת עבודה', 'W = min(V, P − F) − Cp', `min(${money(r.V)}, ${money(r.P - r.F)}) − ${money(r.Cp)} = ${money(c.workUsd)} $`, st.plan === 'RSU' ? 'ב‑RSU: ממוצע 30 ימי המסחר שלפני ההענקה.' : 'ב‑ESPP: ההנחה, כלומר מחיר השוק ביום הרכישה פחות מה ששילמת.')}
        ${step('בשקלים', 'W₪ = W × Rs', `${money(c.workUsd)} × ${rs} = ${num(r.workIls)} ₪`, 'בשער של יום המכירה, כמו בניכוי של הנאמן.')}
        ${step('מס שולי משוער', `W₪ × ${rate()}%`, `${num(r.workIls)} × ${rate()}% = ${num(r.workTax)} ₪`, `${App.profile.marginalRate}% מס שולי${App.profile.includeNi ? ` ועוד ${App.profile.niRate}% ביטוח לאומי ובריאות` : ''}. הערכה בלבד.`, 'result')}
      </ol>`;
      html += c.early ? `<p class="case">${App.esc(Core.SCENARIO_TEXT['early-102'])}</p>` : capitalSteps(r, d, 'שלב 2: רווח הון, במס של 25%');
    } else {
      html += `<h3>שלב 1: ההטבה במשכורת (שולמה ביום ${st.plan === 'RSU' ? 'ההבשלה' : 'הרכישה'}, לא בדוח הזה)</h3><ol class="steps">
        ${step('ההטבה', st.plan === 'RSU' ? 'W₀ = V' : 'W₀ = V − Cp', st.plan === 'RSU' ? `${money(r.payroll.w0)} $` : `${money(r.V)} − ${money(r.Cp)} = ${money(r.payroll.w0)} $`, st.plan === 'RSU' ? 'כל השווי ביום ההבשלה.' : 'ההנחה ביום הרכישה.')}
        ${step('בשקלים', 'W₀₪ = W₀ × Rb', `${money(r.payroll.w0)} × ${c.buy.rate} = ${num(r.payroll.w0Ils)} ₪`, 'בשער של יום הרכישה או ההבשלה. המעסיק עשוי להשתמש בשער אחר.')}
        ${step('מס במשכורת, משוער', `W₀₪ × ${rate()}%`, `${num(r.payroll.w0Ils)} × ${rate()}% = ${num(r.payroll.tax)} ₪`, 'נוכה בתלוש השכר. מופיע כאן רק כדי לראות את התמונה המלאה.', 'result')}
      </ol>`;
      html += capitalSteps(r, d, 'שלב 2: רווח הון, במס של 25%');
    }
    html += moneySplit(r, d);
    out.innerHTML = html;
  }

  function moneySplit(r, d) {
    const c = r.calc;
    const work = d.is102 ? r.workTax : r.payroll.tax;
    const net = c.proceedsIls - r.paidIls - c.feesIls - work - c.tax;
    const segs = [
      ['paid', 'מה ששילמת על המניות', r.paidIls],
      ['fees', 'עמלות', c.feesIls],
      ['work', d.is102 ? 'מס שולי (הנאמן מנכה)' : 'מס במשכורת (שולם קודם)', work],
      ['cap', 'מס רווח הון', c.tax],
      ['net', 'נשאר לך רווח נקי', Math.max(0, net)],
    ].filter(s => s[2] > 0);
    const total = segs.reduce((a, s) => a + s[2], 0) || 1;
    const gross = c.proceedsIls - r.paidIls - c.feesIls;
    const eff = gross > 0 ? Math.round(((work + c.tax) / gross) * 1000) / 10 : null;
    const label = segs.map(s => `${s[1]} ${App.ils(s[2])}`).join(', ');
    return `<h3>לאן הולך הכסף מהמכירה</h3>
      <p class="hint">התמורה בשקלים היא ${App.ils(c.proceedsIls)}. ${d.is102 ? '' : 'המס במשכורת שולם לפני המכירה, אבל הוא חלק מהעלות של ההטבה. '}${eff !== null ? `המס הכולל הוא ${eff}% מהרווח.` : ''}</p>
      <div class="fx-bar" role="img" aria-label="${App.esc(label)}">${segs.map(s => `<span class="seg seg-${s[0]}" style="width:${(s[2] / total) * 100}%"></span>`).join('')}</div>
      <ul class="fx-legend">${segs.map(s => `<li><i class="sw seg-${s[0]}"></i><span>${s[1]}</span><b>${App.ils(s[2])}</b></li>`).join('')}</ul>
      ${net < 0 ? `<p class="case">אחרי המיסים והעלות יש הפסד נטו של ${App.ils(-net)}.</p>` : ''}`;
  }

  function renderAll() {
    const f = s => `<div class="formula">${s.map(x => `<span>${x}</span>`).join('')}</div>`;
    const L = App.L;
    $('#fx-all').innerHTML = `
      <p>הסימנים: ${L('P')} תמורה, ${L('F')} עמלות, ${L('V')} שווי ההטבה, ${L('Cp')} מה ששילמת (בדולרים), ${L('Rb')} ו‑${L('Rs')} השער היציג ביום הרכישה, ההבשלה או ההקצאה, וביום המכירה. ${L('m')} הוא שיעור המס השולי, כולל ביטוח לאומי ובריאות אם רלוונטי.</p>
      <p>רווח ההון מחושב תמיד באותה דרך, לפי חוזר 10/2025: ${L('A = (P − C − F) × Rs')}, ${L('B = P×Rs − C×Rb − F×Rs')}, ואז רווח ריאלי = ${L('min(A, B)')} כששניהם רווח, ${L('max(A, B)')} כששניהם הפסד, ו‑0 אחרת. המס הוא 25% אחרי קיזוז הפסדים. מה שמשתנה בין המקרים הוא ההגדרה של ${L('V')}, של העלות ${L('C')} ושל התאריך של ${L('Rb')}.</p>
      <h3>‏ESPP, סעיף 102 עם נאמן</h3>
      ${f([`שווי ההטבה: ${L('V = FMV(purchase) × qty')}`, `ששולם: ${L('Cp = purchase price × qty')}`, `הכנסת עבודה: ${L('W = min(V, P − F) − Cp')}`, `מס שולי: ${L('Tax_w = W × Rs × m')}`, `עלות לרווח ההון: ${L('C = Cp + W')}, בשער של יום הרכישה (ההקצאה)`, 'מכירה לפני 24 חודשים: כל הרווח הכנסת עבודה, ואין רווח הון'])}
      <h3>‏ESPP בלי נאמן</h3>
      ${f([`הטבה במשכורת, ביום הרכישה: ${L('W₀ = V − Cp')}`, `מס במשכורת: ${L('Tax₀ ≈ W₀ × Rb × m')}`, `עלות לרווח ההון: ${L('C = V')} (Adjusted Cost Basis), בשער של יום הרכישה`])}
      <h3>‏RSU, סעיף 102 עם נאמן</h3>
      ${f([`שווי ההטבה: ${L('V = avg30(before grant) × qty')}`, `ששולם: ${L('Cp = 0')}`, `הכנסת עבודה: ${L('W = min(V, P − F)')}`, `מס שולי: ${L('Tax_w = W × Rs × m')}`, `עלות לרווח ההון: ${L('C = W')}, בשער של יום ההענקה (ההקצאה)`, 'מכירה לפני 24 חודשים מההענקה: כל הרווח הכנסת עבודה'])}
      <h3>‏RSU בלי נאמן</h3>
      ${f([`הטבה במשכורת, ביום ההבשלה: ${L('W₀ = V = FMV(vest) × qty')}`, `מס במשכורת: ${L('Tax₀ ≈ W₀ × Rb × m')}`, `עלות לרווח ההון: ${L('C = V')}, בשער של יום ההבשלה`])}
      <p class="hint">המס השולי הוא הערכה לפי השיעור שהגדרת. מס יסף לא מחושב. בחלק רווח ההון של מסלול 102 אין הכרעה רשמית בין חישוב ריאלי לנומינלי, והכלי מחשב ריאלית.</p>`;
  }

  function render() {
    if (!App) return;
    renderInputs();
    renderOut();
  }

  // ------------------------------------------------------------ init

  function choose(key, value) {
    st[key] = value;
    persist();
    render();
  }

  function init() {
    App = window.App;
    const saved = App.store.get(LS, null);
    if (saved && typeof saved === 'object') st = { ...EXAMPLE, ...saved };
    const plan = $('#fx-plan'), track = $('#fx-track');
    plan.addEventListener('click', e => { const b = e.target.closest('[data-plan]'); if (b) { choose('plan', b.dataset.plan); b.focus(); } });
    track.addEventListener('click', e => { const b = e.target.closest('[data-track]'); if (b) { choose('track', b.dataset.track); b.focus(); } });
    App.radioKeys(plan, '[data-plan]', b => { choose('plan', b.dataset.plan); b.focus(); });
    App.radioKeys(track, '[data-track]', b => { choose('track', b.dataset.track); b.focus(); });
    $('#fx-inputs').addEventListener('input', e => {
      const k = e.target.dataset.fx;
      if (!k) return;
      st[k] = k === 'symbol' ? e.target.value.toUpperCase() : e.target.value;
      if (k === 'symbol') e.target.value = st[k];
      persist();
      renderInputs(); // placeholders and notes depend on dates and symbol; the focused field keeps its value
      renderOut();
    });
    $('#fx-fill').addEventListener('change', e => {
      const lots = App.reportLots().filter(l => l.planType === 'ESPP' || l.planType === 'RSU');
      const l = lots[+e.target.value];
      if (!l) return;
      fillFromLot(l);
      App.toast('הנתונים מולאו מהעסקה');
    });
    $('#fx-reset').addEventListener('click', () => { st = { ...EXAMPLE }; persist(); render(); App.toast('המחשבון אופס לדוגמה'); });
    App.syncWorkInputs();
    renderAll();
    render();
  }

  /** Copy a report lot into the calculator. */
  function fillFromLot(l) {
      const per = v => (isFinite(v) && l.qty > 0 ? String(Math.round((v / l.qty) * 10000) / 10000) : '');
      st = {
        ...st, plan: l.planType, track: App.sec102Of(l) ? '102' : 'regular', symbol: l.symbol || st.symbol, qty: isFinite(l.qty) ? String(l.qty) : '',
        grantDate: l.grantDate || '', buyDate: l.dateAcquired || '', saleDate: l.dateSold || '', price: per(l.proceedsUsd),
        fees: String(l.feesUsd || 0), fmv: per(l.costUsd), paid: per(l.paidUsd), avg30: l.avg30 || '', rb: l.rateBuy || '', rs: l.rateSell || '',
      };
      persist();
      render();
  }

  window.Formulas = { render, fillFromLot: l => { fillFromLot(l); } };
  document.addEventListener('DOMContentLoaded', init);
})();
