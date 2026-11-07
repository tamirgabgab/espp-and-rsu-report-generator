/*
 * Sale simulator: estimate the tax on selling shares that were not sold yet
 * (ESPP and RSU, section 102 trustee track or regular), using the same
 * calculation as the report (src/js/core.js).
 *
 * Holdings live only in this browser (localStorage "f1399.holdings").
 */
(function () {
  'use strict';
  const Core = window.Core;
  const $ = sel => document.querySelector(sel);
  const LS_HOLDINGS = 'f1399.holdings';
  let App; // set on DOMContentLoaded (app.js defines it first)
  let nextId = 1;
  let holdings = [];
  const state = { date: '', rate: '', prices: {}, qty: {} };

  const D = iso => Core.formatDateIL(iso);
  const is102 = h => (h.sec102 === null || h.sec102 === undefined ? !!App.profile.sec102 : !!h.sec102);
  const withId = h => ({ ...Core.cleanHolding(h), id: nextId++ });

  const EXAMPLE = [
    { symbol: 'QCOM', planType: 'ESPP', qty: 12, dateAcquired: '2024-01-31', costPerShare: 148.51, paidPerShare: 126.23, sec102: null },
    { symbol: 'QCOM', planType: 'ESPP', qty: 20, dateAcquired: '2025-07-31', costPerShare: 146.76, paidPerShare: 124.75, sec102: null },
    { symbol: 'QCOM', planType: 'RSU', qty: 25, grantDate: '2024-03-01', dateAcquired: '2025-03-03', costPerShare: 153.62, sec102: null },
  ];

  function persist() {
    App.store.set(LS_HOLDINGS, holdings.map(({ id, ...rest }) => rest));
  }

  // ------------------------------------------------------------ parameters

  const lastBoi = () => {
    const meta = window.USD_ILS_RATES;
    return meta ? { rate: meta.rates[meta.last], date: meta.last } : null;
  };
  const symbols = () => [...new Set(holdings.map(h => h.symbol).filter(Boolean))].sort();

  function renderParams() {
    if (!state.date) state.date = App.today();
    $('#sim-date').value = state.date;
    const boi = lastBoi();
    if (state.rate === '' && boi) state.rate = String(boi.rate);
    $('#sim-rate').value = state.rate;
    $('#sim-rate-note').textContent = boi ? `השער היציג האחרון: ${boi.rate} מ‑${D(boi.date)}. השער ביום המכירה עצמו עוד לא ידוע.` : '';
    const host = $('#sim-prices');
    // Keep the inputs (and focus) when the set of symbols did not change.
    const want = symbols().join(',');
    if (host.dataset.syms === want) return;
    host.dataset.syms = want;
    host.innerHTML = symbols().map(sym => {
      const last = Core.lastClose(App.PRICES[sym]);
      if (state.prices[sym] === undefined) state.prices[sym] = last ? String(last.price) : '';
      const id = `sim-price-${sym.replace(/[^A-Z0-9]/g, '_')}`;
      return `<div class="field">
        <label for="${id}">מחיר מכירה של <bdi>${App.esc(sym)}</bdi> ($ למניה)</label>
        <input id="${id}" data-sym="${App.esc(sym)}" type="number" inputmode="decimal" step="0.01" min="0" value="${App.esc(state.prices[sym])}">
        <p class="field-note">${last ? `סגירה אחרונה: ${last.price} ב‑${D(last.date)} (Yahoo Finance).` : 'אין מחירים בכלי לנייר הזה, צריך להזין מחיר.'}</p>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ holdings list

  const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function trackText(h) {
    if (!is102(h)) return 'רגיל (ההטבה מוסתה במשכורת)';
    const alloc = h.planType === 'RSU' ? h.grantDate : h.dateAcquired;
    if (!alloc) return '102 · חסר תאריך הקצאה';
    const unlock = Core.unlockDate(alloc);
    return unlock <= (state.date || App.today()) ? '102 · אחרי 24 חודשים' : `102 · נעול עד ${D(unlock)}`;
  }

  function renderList() {
    const host = $('#sim-list');
    $('#sim-empty').hidden = holdings.length > 0;
    $('#sim-clear').hidden = holdings.length === 0;
    if (!holdings.length) { host.innerHTML = ''; return; }
    const actions = h => `<span class="row-actions">
        <button type="button" class="icon-btn" data-hact="edit" data-id="${h.id}" aria-label="עריכת המנה" data-tip="עריכת המנה">${ICON_EDIT}</button>
        <button type="button" class="icon-btn danger" data-hact="delete" data-id="${h.id}" aria-label="מחיקת המנה" data-tip="מחיקת המנה">${ICON_DEL}</button>
      </span>`;
    const money = n => (isFinite(n) ? App.usd(n) : '—');
    host.innerHTML = `<div class="lots-desktop"><table class="lots-table">
        <thead><tr><th scope="col">נייר</th><th scope="col">כמות</th><th scope="col">הענקה</th><th scope="col">רכישה / הבשלה</th>
          <th scope="col">שווי $ למניה</th><th scope="col">שולם $ למניה</th><th scope="col">מסלול</th><th scope="col"><span class="visually-hidden">פעולות</span></th></tr></thead>
        <tbody>${holdings.map(h => `<tr>
          <td><span class="sym">${App.esc(h.symbol || '—')}</span><span class="plan">${h.planType}</span></td>
          <td class="num">${isFinite(h.qty) ? h.qty : '—'}</td>
          <td>${h.planType === 'RSU' ? D(h.grantDate) || '—' : '—'}</td>
          <td>${D(h.dateAcquired) || '—'}</td>
          <td class="num">${money(h.costPerShare)}</td>
          <td class="num">${h.planType === 'RSU' ? '0.00' : money(h.paidPerShare)}</td>
          <td>${trackText(h)}</td>
          <td class="actions-cell">${actions(h)}</td></tr>`).join('')}</tbody></table></div>
      <div class="lots-mobile">${holdings.map(h => `<article class="lot-card">
          <div class="lc-head"><div class="lc-title"><span class="sym">${App.esc(h.symbol || '—')}</span><span class="plan"> · <bdi>${h.planType}</bdi>${isFinite(h.qty) ? ` · ${h.qty} מניות` : ''}</span></div></div>
          <div class="lc-dates">${h.planType === 'RSU' ? `הענקה ${D(h.grantDate) || '—'} · הבשלה ${D(h.dateAcquired) || '—'}` : `רכישה ${D(h.dateAcquired) || '—'}`}</div>
          <div class="lc-dates">${trackText(h)}</div>
          <div class="lc-actions"><span></span>${actions(h)}</div>
        </article>`).join('')}</div>`;
  }

  // ------------------------------------------------------------ results

  function simParams(h) {
    const price = +state.prices[h.symbol];
    const qtyRaw = state.qty[h.id];
    const qty = qtyRaw === undefined || qtyRaw === '' ? h.qty : Math.min(+qtyRaw, h.qty);
    return { qty, price, date: state.date || App.today(), rate: +state.rate, is102: is102(h), rates: App.RATES, prices: App.PRICES, settings: App.profile };
  }

  function runOne(h) {
    const o = simParams(h);
    const issues = [];
    if (!(o.price > 0)) issues.push(`חסר מחיר מכירה ל‑${h.symbol || 'נייר'}`);
    if (!(o.rate > 0)) issues.push('חסר שער דולר');
    if (!(o.qty > 0)) issues.push('הכמות למכירה צריכה להיות גדולה מ‑0');
    if (!h.dateAcquired && !(o.is102 && h.planType === 'RSU')) issues.push(h.planType === 'RSU' ? 'חסר תאריך הבשלה' : 'חסר תאריך רכישה');
    if (!isFinite(h.costPerShare) && !(o.is102 && h.planType === 'RSU')) issues.push('חסר השווי ביום הרכישה או ההבשלה');
    if (issues.length) return { o, now: { ok: false, issues } };
    return { o, ...Core.simulateHolding(h, o) };
  }

  function metric(k, v, cls = '') {
    return `<div class="lc-metric"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  }

  function resultCard(h, r) {
    const head = `<div class="lc-head"><div class="lc-title"><span class="sym">${App.esc(h.symbol || '—')}</span><span class="plan"> · <bdi>${h.planType}</bdi> · ${trackText(h)}</span></div></div>`;
    const qtyId = `sim-qty-${h.id}`;
    const qtyField = `<div class="field sim-qty"><label for="${qtyId}">כמות למכירה <small>(מתוך ${isFinite(h.qty) ? h.qty : '—'})</small></label>
      <input id="${qtyId}" data-qty="${h.id}" type="number" inputmode="decimal" step="any" min="0" max="${isFinite(h.qty) ? h.qty : ''}" value="${App.esc(state.qty[h.id] ?? (isFinite(h.qty) ? h.qty : ''))}"></div>`;
    if (!r.now.ok) {
      return `<article class="sim-card has-issue">${head}${qtyField}<ul class="lc-issues">${r.now.issues.map(i => `<li>${App.esc(i)}</li>`).join('')}</ul>
        <div class="actions"><button type="button" class="btn btn-sm" data-hact="edit" data-id="${h.id}">השלמת הנתונים</button></div></article>`;
    }
    const n = r.now, c = n.calc;
    const realCls = c.real > 0 ? 'gain' : c.real < 0 ? 'loss' : '';
    let later = '';
    if (r.later && r.later.ok) {
      const gain = r.later.net - n.net;
      later = `<p class="sim-later">${gain > 0 ? `אם תחכה עד ${D(c.unlock)} (תום 24 החודשים), באותו מחיר ובאותו שער, יישאר לך <b>${App.ils(r.later.net)}</b>, כלומר <b>${App.ils(gain)}</b> יותר.` : `גם אחרי ${D(c.unlock)} התוצאה לא משתפרת באותו מחיר.`} החיסכון בא מכך שרק ההטבה תמוסה במס שולי, והשאר ב‑25%.</p>`;
    }
    const note = c.early ? `<p class="case">${App.esc(Core.SCENARIO_TEXT['early-102'])}</p>`
      : c.baseSource === 'avg30' ? `<p class="hint">שווי ההטבה ב‑RSU: ממוצע הסגירה <bdi class="ltr">${c.avg.avg} $</bdi> ב‑30 ימי המסחר שלפני ההענקה, מ‑${D(c.avg.from)} עד ${D(c.avg.to)}.</p>`
        : c.track === '102' && !c.paidKnown ? '<p class="hint">חסר המחיר ששילמת, ולכן חלק ההנחה לא חושב.</p>' : '';
    return `<article class="sim-card">${head}${qtyField}
      <div class="lc-metrics sim-metrics">
        ${metric('תמורה', App.ils(n.proceedsIls))}
        ${r.o.is102 ? metric('הכנסת עבודה', App.ils(c.workIls)) : ''}
        ${r.o.is102 ? metric('מס שולי משוער', App.ils(n.workTax)) : ''}
        ${c.early ? '' : metric('רווח הון ריאלי', App.ils(c.real), realCls)}
        ${c.early ? '' : metric('מס רווח הון 25%', App.ils(n.capTax))}
        ${metric('נשאר ביד', App.ils(n.net), 'sim-net')}
      </div>
      ${note}${later}
    </article>`;
  }

  function renderResults() {
    const out = $('#sim-out');
    if (!holdings.length) { out.innerHTML = '<p class="hint">התוצאה תופיע אחרי שתוסיף לפחות מנה אחת.</p>'; return; }
    const results = holdings.map(h => ({ h, r: runOne(h) }));
    const ok = results.filter(x => x.r.now.ok);
    const year = (state.date || App.today()).slice(0, 4);
    const realized = App.realizedByYear(year);
    const realizedNet = realized.gains + realized.losses;
    const simReal = ok.reduce((a, x) => a + (x.r.now.calc.early ? 0 : x.r.now.calc.real), 0);
    const taxBefore = Core.roundILS(Math.max(0, realizedNet) * Core.TAX_RATE);
    const taxAfter = Core.roundILS(Math.max(0, realizedNet + simReal) * Core.TAX_RATE);
    const capTax = taxAfter - taxBefore;
    const proceeds = ok.reduce((a, x) => a + x.r.now.proceedsIls, 0);
    const workTax = ok.reduce((a, x) => a + x.r.now.workTax, 0);
    const workIls = ok.reduce((a, x) => a + (x.r.now.calc.workIls || 0), 0);
    const net = proceeds - workTax - capTax;
    const waitGain = ok.reduce((a, x) => a + (x.r.later && x.r.later.ok ? Math.max(0, x.r.later.net - x.r.now.net) : 0), 0);
    const offsetNote = realized.count
      ? `מס רווח ההון מחושב אחרי קיזוז מול ${realized.count === 1 ? 'מכירה אחת' : `${realized.count} מכירות`} שכבר נמצאות בדוח של ${year} (רווח ריאלי נטו ${App.ils(realizedNet)}). זו התוספת למס של השנה.`
      : `אין בדוח מכירות של ${year}, ולכן אין קיזוז מול מכירות קודמות.`;
    out.innerHTML = `
      <div class="hero sim-hero">
        <div class="tile"><div class="tile-label">תמורה</div><div class="tile-value">${App.ils(proceeds)}</div><div class="tile-sub">${ok.length === 1 ? 'מנה אחת' : `${ok.length} מנות`} · שער ${App.esc(state.rate)}</div></div>
        <div class="tile"><div class="tile-label">מס שולי משוער</div><div class="tile-value">${App.ils(workTax)}</div><div class="tile-sub">על הכנסת עבודה ${App.ils(workIls)} (102)</div></div>
        <div class="tile"><div class="tile-label">מס רווח הון</div><div class="tile-value">${App.ils(capTax)}</div><div class="tile-sub">25%, אחרי קיזוז בשנת ${year}</div></div>
        <div class="tile tile-accent"><div class="tile-label">נשאר ביד</div><div class="tile-value">${App.ils(net)}</div><div class="tile-sub">${waitGain > 0 ? `המתנה לתום 24 החודשים חוסכת כ‑${App.ils(waitGain)}` : 'לפני מס יסף, אם חל'}</div></div>
      </div>
      <p class="hint">${offsetNote}</p>
      <div class="sim-cards">${results.map(x => resultCard(x.h, x.r)).join('')}</div>
      <p class="hint">הערכה בלבד: המחיר והשער ביום המכירה עוד לא ידועים, המס השולי הוא השיעור שהגדרת, ומס יסף לא חושב. במסלול 102 הנאמן מנכה את המס בפועל במכירה.</p>`;
  }

  function render() {
    if (!App) return;
    renderParams();
    renderList();
    renderResults();
  }

  // ------------------------------------------------------------ editor

  const dlg = () => $('#holding-dialog');
  const form = () => $('#holding-form');
  const H = name => form().elements[name];
  let editing = null;

  function updateHoldingFields() {
    const plan = H('planType').value;
    const s102 = H('sec102').checked;
    $('#hw-grantDate').hidden = plan !== 'RSU';
    $('#hw-paidPerShare').hidden = plan !== 'ESPP';
    $('#hw-avg30').hidden = !(plan === 'RSU' && s102);
    $('#hl-dateAcquired').textContent = plan === 'RSU' ? 'תאריך הבשלה (Vest)' : 'תאריך רכישה';
    $('#hl-costPerShare').textContent = plan === 'RSU' ? 'שווי ביום ההבשלה ($ למניה)' : 'שווי ביום הרכישה ($ למניה)';
    const sym = H('symbol').value.trim().toUpperCase();
    const note = $('#h-avg30-note');
    note.textContent = '';
    if (plan === 'RSU' && s102) {
      const a = H('grantDate').value ? Core.avgCloseBefore(App.PRICES[sym], H('grantDate').value) : null;
      H('avg30').placeholder = a ? `אוטומטי: ${a.avg}` : '';
      note.textContent = a ? `ממוצע הסגירה מ‑${D(a.from)} עד ${D(a.to)}. משאירים ריק כדי להשתמש בו.`
        : App.PRICES[sym] ? 'מזינים תאריך הענקה כדי לחשב את הממוצע.' : 'אין מחירי מניה לנייר הזה, ולכן צריך להזין את הממוצע.';
    }
    // Suggest the close on the acquisition date as the value per share.
    const close = App.PRICES[sym] && H('dateAcquired').value ? Core.lookupRate(App.PRICES[sym].rates, H('dateAcquired').value) : null;
    H('costPerShare').placeholder = close ? `סגירה באותו יום: ${close.rate}` : '';
  }

  const RULES = {
    symbol: v => (!v ? 'צריך סימול של המניה' : null),
    qty: v => (v === '' ? 'צריך כמות מניות' : !(+v > 0) ? 'הכמות צריכה להיות גדולה מ‑0' : null),
  };
  function validate(name) {
    const el = H(name);
    const err = RULES[name](el.value.trim());
    el.setAttribute('aria-invalid', err ? 'true' : 'false');
    $(`#e-h-${name}`).textContent = err || '';
    return !err;
  }

  function openHolding(id) {
    const h = id ? holdings.find(x => x.id === id) : { symbol: symbols()[0] || '', planType: 'ESPP', qty: NaN, dateAcquired: '', grantDate: '', costPerShare: NaN, paidPerShare: NaN, avg30: '', sec102: null };
    editing = id || null;
    $('#holding-title').textContent = id ? 'עריכת מנה' : 'מנה חדשה';
    for (const k of ['symbol', 'planType', 'dateAcquired', 'grantDate', 'avg30']) H(k).value = h[k] ?? '';
    for (const k of ['qty', 'costPerShare', 'paidPerShare']) H(k).value = isFinite(h[k]) ? h[k] : '';
    H('sec102').checked = is102(h);
    for (const el of form().querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const el of form().querySelectorAll('.field-error')) el.textContent = '';
    updateHoldingFields();
    dlg().showModal();
    setTimeout(() => H(id ? 'qty' : 'symbol').focus(), 30);
  }

  function saveHolding(ev) {
    ev.preventDefault();
    const okAll = Object.keys(RULES).map(validate);
    if (okAll.includes(false)) { const f = form().querySelector('[aria-invalid="true"]'); if (f) f.focus(); return; }
    const num = k => (H(k).value === '' ? NaN : +H(k).value);
    const sym = H('symbol').value.trim().toUpperCase();
    const data = {
      symbol: sym, planType: H('planType').value, qty: num('qty'), dateAcquired: H('dateAcquired').value, grantDate: H('grantDate').value,
      costPerShare: num('costPerShare'), paidPerShare: H('planType').value === 'RSU' ? 0 : num('paidPerShare'), avg30: H('avg30').value,
      sec102: H('sec102').checked === !!App.profile.sec102 ? null : H('sec102').checked,
    };
    // No value per share typed: take the close on the acquisition date, if we have it.
    if (!isFinite(data.costPerShare) && App.PRICES[sym] && data.dateAcquired) {
      const close = Core.lookupRate(App.PRICES[sym].rates, data.dateAcquired);
      if (close) data.costPerShare = close.rate;
    }
    let id = editing;
    if (editing) Object.assign(holdings.find(x => x.id === editing), Core.cleanHolding(data));
    else { const h = withId(data); holdings.push(h); id = h.id; }
    dlg().close();
    persist();
    render();
    focusHolding(id);
    App.toast(editing ? 'המנה עודכנה' : 'המנה נוספה');
  }

  function focusHolding(id) {
    const el = [...document.querySelectorAll(`[data-hact="edit"][data-id="${id}"]`)].find(e => e.offsetParent);
    if (el) el.focus();
  }

  function deleteHolding(id) {
    const idx = holdings.findIndex(x => x.id === id);
    if (idx === -1) return;
    const [removed] = holdings.splice(idx, 1);
    persist();
    render();
    const next = holdings[idx] || holdings[idx - 1];
    if (next) focusHolding(next.id); else $('#sim-h-title').focus();
    App.toast(`המנה ${removed.symbol} ${removed.planType} נמחקה`, { label: 'ביטול', run: () => { holdings.splice(idx, 0, removed); persist(); render(); focusHolding(removed.id); } });
  }

  // ------------------------------------------------------------ import

  async function importHoldings(file) {
    const msg = $('#sim-msg');
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const found = [];
      const warnings = [];
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        const r = Core.parseHoldingsRows(rows, name);
        found.push(...r.holdings);
        if (!r.holdings.length) warnings.push(`${name}: ${r.warnings.join(' · ')}`);
      }
      if (!found.length) { App.setMsg(msg, `לא נמצאו מניות בקובץ. ${warnings.join(' · ')}`, 'err', { actions: [{ label: 'בחירת קובץ אחר', run: () => $('#sim-file').click() }] }); return; }
      holdings = holdings.concat(found.map(withId));
      persist();
      render();
      const missing = found.filter(h => (h.planType === 'RSU' ? !h.grantDate : !isFinite(h.paidPerShare) || !h.dateAcquired)).length;
      App.setMsg(msg, `יובאו ${found.length} מנות מהקובץ ${file.name}.${missing ? ` ב‑${missing} מהן חסרים נתונים (תאריך הענקה או מחיר רכישה), וכדאי להשלים אותם בעריכה.` : ' כדאי לעבור על השורות ולוודא שהנתונים נכונים.'}`, missing ? 'warn' : 'ok');
    } catch (e) {
      console.error(e);
      App.setMsg(msg, 'הקובץ לא נקרא. אפשר לנסות קובץ אחר, או להוסיף את המנות ידנית.', 'err', {
        actions: [{ label: 'בחירת קובץ אחר', run: () => $('#sim-file').click() }], details: App.errDetails(e),
      });
    }
  }

  // ------------------------------------------------------------ init

  function init() {
    App = window.App;
    holdings = (App.store.get(LS_HOLDINGS, []) || []).map(withId);
    form().addEventListener('submit', saveHolding);
    for (const name of Object.keys(RULES)) {
      const el = H(name);
      el.addEventListener('blur', () => { if (el.value !== '' || el.getAttribute('aria-invalid')) validate(name); });
      el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') validate(name); });
    }
    for (const k of ['planType', 'sec102', 'grantDate', 'dateAcquired', 'symbol']) H(k).addEventListener('change', updateHoldingFields);
    H('symbol').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    dlg().addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dlg()) dlg().close(); });

    $('#sim-add').addEventListener('click', () => openHolding(null));
    $('#sim-import').addEventListener('click', () => $('#sim-file').click());
    $('#sim-file').addEventListener('change', e => { importHoldings(e.target.files[0]); e.target.value = ''; });
    $('#sim-example').addEventListener('click', () => {
      holdings = holdings.concat(EXAMPLE.map(withId));
      persist();
      render();
      App.setMsg($('#sim-msg'), 'נטענה דוגמה: שתי רכישות ESPP ומענק RSU של QCOM.', 'ok');
    });
    $('#sim-clear').addEventListener('click', () => {
      const n = holdings.length;
      App.confirmDestructive({
        title: n === 1 ? 'למחוק את המנה?' : `למחוק את כל ${n} המנות?`,
        body: `הפעולה מוחקת ${n === 1 ? 'מנה אחת' : `${n} מנות`} מהסימולטור בדפדפן הזה. אחרי המחיקה אפשר לבטל אותה לכמה שניות.`,
        ok: n === 1 ? 'מחיקת המנה' : `מחיקת ${n} מנות`,
        run: () => {
          const backup = holdings.slice();
          holdings = [];
          persist();
          render();
          $('#sim-h-title').focus();
          App.toast(`נמחקו ${n === 1 ? 'מנה אחת' : `${n} מנות`}`, { label: 'ביטול', run: () => { holdings = backup; persist(); render(); } });
        },
      });
    });
    $('#sim-list').addEventListener('click', onAction);
    $('#sim-out').addEventListener('click', onAction);
    // Quantities are inside the re-rendered results: update on change (blur / Enter) to keep focus while typing.
    $('#sim-out').addEventListener('change', e => {
      const id = e.target.dataset.qty;
      if (!id) return;
      state.qty[id] = e.target.value;
      renderResults();
      const again = $(`#sim-qty-${id}`);
      if (again) again.focus();
    });
    $('#sim-date').addEventListener('change', e => { state.date = e.target.value || App.today(); renderList(); renderResults(); });
    $('#sim-rate').addEventListener('input', e => { state.rate = e.target.value; renderResults(); });
    $('#sim-prices').addEventListener('input', e => { const sym = e.target.dataset.sym; if (!sym) return; state.prices[sym] = e.target.value; renderResults(); });
    render();
  }

  function onAction(e) {
    const b = e.target.closest('[data-hact]');
    if (!b) return;
    const id = +b.dataset.id;
    if (b.dataset.hact === 'edit') openHolding(id); else deleteHolding(id);
  }

  window.Sim = {
    render,
    getHoldings: () => holdings.map(({ id, ...rest }) => rest),
    setHoldings(list) { holdings = list.map(withId); persist(); render(); },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
