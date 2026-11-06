/* UI glue: state, table editing, import, summary, chart and downloads. */
(function () {
  'use strict';
  const Core = window.Core;
  const RATES = (window.USD_ILS_RATES && window.USD_ILS_RATES.rates) || {};
  const SECONDARY = window.USD_ILS_SECONDARY || {};
  const SOURCES = { boi: RATES, ecb: SECONDARY.ecb && SECONDARY.ecb.rates, yahoo: SECONDARY.yahoo && SECONDARY.yahoo.rates };
  const LS_PROFILE = 'f1399.profile';
  const LS_LOTS = 'f1399.lots';
  const $ = sel => document.querySelector(sel);

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };

  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (isFinite(n) ? (n < 0 ? `(${Math.abs(n).toLocaleString('en-US')})` : n.toLocaleString('en-US')) : '');
  let nextId = 1;

  // ------------------------------------------------------------ state

  const profile = Object.assign({ name: '', idNumber: '', belonging: '2', place: 'israel', sec102: true, signDate: '' }, store.get(LS_PROFILE, {}));
  let lots = store.get(LS_LOTS, []).map(l => ({ ...l, id: nextId++ }));

  const blankLot = () => ({ id: nextId++, symbol: '', planType: 'ESPP', qty: NaN, dateAcquired: '', dateSold: '', timeSold: '', proceedsUsd: NaN, costUsd: NaN, feesUsd: 0, sec102: null, rateBuy: '', rateSell: '', order: '' });

  const EXAMPLE = [
    { symbol: 'QCOM', planType: 'ESPP', qty: 17, dateAcquired: '2024-01-31', dateSold: '2026-05-11', proceedsUsd: 3938.96, costUsd: 2524.67, feesUsd: 0 },
  ];

  function persist() {
    store.set(LS_PROFILE, profile);
    store.set(LS_LOTS, lots.map(({ id, ...rest }) => rest));
  }

  function computeAll() {
    return lots.map(lot => ({
      lot,
      calc: Core.computeLot(lot, RATES, { rateBuy: lot.rateBuy, rateSell: lot.rateSell }),
    }));
  }

  // ------------------------------------------------------------ profile form

  function bindProfile() {
    const fields = { 'p-name': 'name', 'p-id': 'idNumber', 'p-belonging': 'belonging', 'p-place': 'place', 'p-date': 'signDate' };
    for (const [id, key] of Object.entries(fields)) {
      const input = document.getElementById(id);
      input.value = profile[key] || (key === 'signDate' ? today() : '');
      input.addEventListener('input', () => { profile[key] = input.value.trim(); persist(); });
    }
    const cb = $('#p-102');
    cb.checked = !!profile.sec102;
    cb.addEventListener('change', () => { profile.sec102 = cb.checked; persist(); renderTable(); });
  }

  // ------------------------------------------------------------ table

  const num = v => (isFinite(v) ? v : '');

  function rowHtml(lot) {
    const sec102 = lot.sec102 === null || lot.sec102 === undefined ? profile.sec102 : lot.sec102;
    const autoBuy = Core.lookupRate(RATES, lot.dateAcquired);
    const autoSell = Core.lookupRate(RATES, lot.dateSold);
    const ph = r => (r ? `${r.rate}${r.exact ? '' : '*'}` : 'ידני');
    const tip = r => (r ? `שער יציג ${r.rate} מתאריך ${Core.formatDateIL(r.date)}${r.exact ? '' : ' (השער האחרון שפורסם לפני התאריך)'}` : 'אין שער בנתונים - יש להזין ידנית');
    return `
      <td><input class="sym" data-k="symbol" value="${esc(lot.symbol)}" aria-label="סימול"></td>
      <td><select data-k="planType" aria-label="סוג תוכנית">
        ${['ESPP', 'RSU', 'Options', 'אחר'].map(p => `<option ${p === lot.planType ? 'selected' : ''}>${p}</option>`).join('')}
      </select></td>
      <td><input class="qty" type="number" step="any" data-k="qty" value="${num(lot.qty)}" aria-label="כמות"></td>
      <td><input type="date" data-k="dateAcquired" value="${esc(lot.dateAcquired)}" aria-label="תאריך רכישה"></td>
      <td><input type="date" data-k="dateSold" value="${esc(lot.dateSold)}" aria-label="תאריך מכירה"></td>
      <td><input type="time" data-k="timeSold" value="${esc(lot.timeSold || '')}" aria-label="שעת מכירה בשעון ניו יורק" title="שעת הביצוע מ-Order Details ב-E*Trade (שעון ניו יורק)"></td>
      <td><input type="number" step="0.01" data-k="proceedsUsd" value="${num(lot.proceedsUsd)}" aria-label="תמורה בדולרים"></td>
      <td><input type="number" step="0.01" data-k="costUsd" value="${num(lot.costUsd)}" aria-label="עלות בדולרים"></td>
      <td><input type="number" step="0.01" data-k="feesUsd" value="${num(lot.feesUsd)}" aria-label="עמלות בדולרים"></td>
      <td><input type="checkbox" data-k="sec102" ${sec102 ? 'checked' : ''} aria-label="סעיף 102"></td>
      <td><input class="rate" type="number" step="0.001" data-k="rateBuy" value="${esc(lot.rateBuy)}" placeholder="${ph(autoBuy)}" title="${esc(tip(autoBuy))}" aria-label="שער רכישה"></td>
      <td><input class="rate" type="number" step="0.001" data-k="rateSell" value="${esc(lot.rateSell)}" placeholder="${ph(autoSell)}" title="${esc(tip(autoSell))}" aria-label="שער מכירה"></td>
      <td class="num" data-out="proceedsIls"></td>
      <td class="num" data-out="costIls"></td>
      <td class="num" data-out="nominal"></td>
      <td class="num" data-out="inflationary"></td>
      <td class="num" data-out="real"></td>
      <td class="num" data-out="tax"></td>
      <td><button class="del" type="button" data-del aria-label="מחיקת שורה" title="מחיקת שורה">×</button></td>`;
  }

  function renderTable() {
    const body = $('#tx-body');
    body.innerHTML = '';
    for (const lot of lots) {
      const tr = document.createElement('tr');
      tr.dataset.id = lot.id;
      tr.innerHTML = rowHtml(lot);
      body.appendChild(tr);
      const issueTr = document.createElement('tr');
      issueTr.className = 'issue-row';
      issueTr.dataset.issueFor = lot.id;
      issueTr.innerHTML = '<td class="issue" colspan="19"></td>';
      body.appendChild(issueTr);
    }
    $('#empty-state').hidden = lots.length > 0;
    refresh();
  }

  function refresh() {
    const items = computeAll();
    for (const { lot, calc } of items) {
      const tr = document.querySelector(`tr[data-id="${lot.id}"]`);
      const issueTr = document.querySelector(`tr[data-issue-for="${lot.id}"]`);
      if (!tr) continue;
      for (const td of tr.querySelectorAll('[data-out]')) {
        const k = td.dataset.out;
        td.textContent = calc.ok ? fmt(calc[k]) : '';
        td.classList.toggle('gain', calc.ok && k === 'real' && calc.real > 0);
        td.classList.toggle('loss', calc.ok && k === 'real' && calc.real < 0);
      }
      for (const key of ['rateBuy', 'rateSell']) {
        const input = tr.querySelector(`[data-k="${key}"]`);
        const r = Core.lookupRate(RATES, key === 'rateBuy' ? lot.dateAcquired : lot.dateSold);
        input.placeholder = r ? `${r.rate}${r.exact ? '' : '*'}` : 'ידני';
      }
      tr.classList.toggle('has-issue', !calc.ok);
      issueTr.hidden = calc.ok;
      issueTr.firstElementChild.textContent = calc.ok ? '' : `⚠ ${calc.issues.join(' · ')}`;
    }
    renderSummary(items);
    renderChecks(items);
    renderChart();
    persist();
  }

  function onTableInput(ev) {
    const input = ev.target;
    const k = input.dataset.k;
    if (!k) return;
    const tr = input.closest('tr');
    const lot = lots.find(l => l.id === +tr.dataset.id);
    if (!lot) return;
    if (input.type === 'checkbox') lot[k] = input.checked;
    else if (input.type === 'number' && !['rateBuy', 'rateSell'].includes(k)) lot[k] = input.value === '' ? NaN : +input.value;
    else if (k === 'symbol') lot[k] = input.value.trim().toUpperCase();
    else lot[k] = input.value;
    refresh();
  }

  // ------------------------------------------------------------ rate control

  const intradayCache = new Map(); // url -> Promise<file|null>
  let intradayIndex = null;

  function loadJson(url) {
    if (!intradayCache.has(url)) {
      intradayCache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));
    }
    return intradayCache.get(url);
  }

  /** Market rate at the sale moment: minute archive first, then hourly bars. */
  async function intradayRate(lot) {
    const epoch = Core.nyToUtcEpoch(lot.dateSold, lot.timeSold);
    if (epoch === null) return null;
    if (!intradayIndex) intradayIndex = (await loadJson('data/rates/intraday/index.json')) || { minute: [], hourly: [] };
    const d = new Date(epoch * 1000);
    const month = d.toISOString().slice(0, 7), year = month.slice(0, 4);
    if (intradayIndex.minute.includes(month)) {
      const r = Core.intradayAt(await loadJson(`data/rates/intraday/minute/${month}.json`), epoch, 5);
      if (r) return { ...r, epoch, kind: 'דקה' };
    }
    if (intradayIndex.hourly.includes(year)) {
      const r = Core.intradayAt(await loadJson(`data/rates/intraday/hourly/${year}.json`), epoch, 1);
      if (r) return { ...r, epoch, kind: 'שעה' };
    }
    return { epoch, missing: true };
  }

  const pct = v => (v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
  const rateCell = (c, label) => {
    if (!c || !c.rate) return '<td>—</td>';
    const late = c.date && c.date !== label ? `<span class="dev">מ‑${Core.formatDateIL(c.date)}</span>` : '';
    return `<td class="num ${c.warn ? 'warn-cell' : ''}">${c.rate}<span class="dev">${pct(c.devPct)}</span>${late}</td>`;
  };

  let checksSeq = 0;
  async function renderChecks(items) {
    const seq = ++checksSeq;
    const body = $('#check-body');
    const rows = [];
    let flagged = 0;
    for (const [i, { lot, calc }] of items.entries()) {
      const events = [['רכישה', lot.dateAcquired], ['מכירה', lot.dateSold]];
      for (const [label, date] of events) {
        if (!date) continue;
        const cc = Core.crossCheck(SOURCES, date);
        if (cc.warn) flagged++;
        let intraCells = '<td></td><td></td><td></td><td></td>';
        if (label === 'מכירה') {
          const ir = lot.timeSold ? await intradayRate(lot) : null;
          if (seq !== checksSeq) return; // a newer render started
          if (!lot.timeSold) {
            intraCells = '<td class="hint">לא הוזנה שעה</td><td></td><td></td><td></td>';
          } else if (!ir || ir.missing) {
            intraCells = `<td>${esc(lot.timeSold)}</td><td colspan="3" class="hint">אין נתוני שעה/דקה לזמן הזה (ארכיון הדקות מתחיל ב‑${esc((intradayIndex && intradayIndex.minute[0]) || '?')}, נתוני שעה כשנתיים אחורה)</td>`;
          } else {
            const boi = cc.boi && cc.boi.rate;
            const diff = boi ? ((ir.rate / boi - 1) * 100) : null;
            const effect = boi && isFinite(lot.proceedsUsd) ? Core.roundILS(lot.proceedsUsd * (ir.rate - boi)) : null;
            const utc = new Date(ir.ts * 1000).toISOString().slice(11, 16);
            intraCells = `<td>${esc(lot.timeSold)}</td>
              <td class="num">${ir.rate.toFixed(4)}<span class="dev">דיוק: ${ir.kind}${ir.exact ? '' : ' (הקרוב)'} · נכון ל‑<bdi dir="ltr">${utc} UTC</bdi></span></td>
              <td class="num">${pct(diff)}</td><td class="num">${effect === null ? '' : fmt(effect)}</td>`;
          }
        }
        rows.push(`<tr class="${label === 'רכישה' ? 'sep' : ''}">
          <td>${label === 'רכישה' ? i + 1 : ''}</td><td>${label === 'רכישה' ? esc(lot.symbol) : ''}</td><td>${label}</td>
          <td>${Core.formatDateIL(date)}</td>
          <td class="num">${cc.boi ? cc.boi.rate : '—'}${cc.boi && cc.boi.date !== date ? `<span class="dev">מ‑${Core.formatDateIL(cc.boi.date)}</span>` : ''}</td>
          ${rateCell(cc.checks.ecb, cc.boi && cc.boi.date)}${rateCell(cc.checks.yahoo, cc.boi && cc.boi.date)}
          ${intraCells}</tr>`);
      }
    }
    if (seq !== checksSeq) return;
    body.innerHTML = rows.join('') || '<tr><td colspan="11" class="hint">אין עסקאות לבדיקה.</td></tr>';
    const ecbMeta = SECONDARY.ecb, yMeta = SECONDARY.yahoo;
    $('#check-meta').textContent = [
      flagged ? `⚠ ${flagged} תאריכים עם סטייה חריגה (ECB מעל ${Core.CHECK_THRESHOLDS.ecb}%, Yahoo מעל ${Core.CHECK_THRESHOLDS.yahoo}%). כדאי לבדוק את השער מול אתר בנק ישראל.` : 'כל השערים תואמים בין המקורות.',
      ecbMeta ? `ECB: עד ${Core.formatDateIL(ecbMeta.last)}.` : 'נתוני ECB לא נטענו.',
      yMeta ? `Yahoo: עד ${Core.formatDateIL(yMeta.last)}.` : 'נתוני Yahoo לא נטענו.',
      'הסטייה מחושבת ביחס לשער היציג.',
    ].join(' ');
  }

  // ------------------------------------------------------------ summary

  function dueDate(key) {
    const [y, h] = key.split('-H');
    return h === '1' ? `31.7.${y}` : `31.1.${+y + 1}`;
  }

  function renderSummary(items) {
    const host = $('#summary');
    const groups = Core.summarize(items);
    if (!groups.length) { host.innerHTML = '<p class="hint">הסיכום יופיע אחרי שתוזן לפחות עסקה אחת תקינה.</p>'; return; }
    host.innerHTML = groups.map(g => `
      <div class="sum-card ${g.isYear ? 'year' : ''}">
        <h3>${esc(g.label)}</h3>
        <dl>
          <dt>מספר מכירות (lots)</dt><dd>${g.count}</dd>
          <dt>תמורה ₪</dt><dd>${fmt(g.proceedsIls)}</dd>
          <dt>רווחים ריאליים ₪</dt><dd>${fmt(g.gains)}</dd>
          <dt>הפסדים לקיזוז ₪</dt><dd>${fmt(g.losses)}</dd>
          <dt>רווח ריאלי נטו ₪</dt><dd>${fmt(g.net)}</dd>
          <dt>מס משוער 25% ₪</dt><dd class="big">${fmt(g.tax)}</dd>
        </dl>
        ${g.isYear ? (g.carryLoss < 0 ? `<div class="due">הפסד להעברה לשנה הבאה: ${fmt(g.carryLoss)} ₪</div>` : '') : `<div class="due">מקדמה בדוח חצי‑שנתי עד ${dueDate(g.key)}</div>`}
      </div>`).join('');
  }

  // ------------------------------------------------------------ chart

  function renderChart() {
    const markers = [];
    for (const l of lots) {
      const name = `${esc(l.symbol || '')} ${esc(l.planType || '')}`.trim();
      if (l.dateAcquired) markers.push({ date: l.dateAcquired, type: 'buy', label: `רכישה: ${name}` });
      if (l.dateSold) markers.push({ date: l.dateSold, type: 'sell', label: `מכירה: ${name}` });
    }
    window.RateChart.renderRateChart($('#chart'), RATES, markers, $('#tooltip'));
    const meta = window.USD_ILS_RATES;
    $('#rates-meta').textContent = meta
      ? `מקור: בנק ישראל, שער יציג (סדרה RER_USD_ILS). ${meta.count} ימי פרסום, מ‑${Core.formatDateIL(meta.first)} עד ${Core.formatDateIL(meta.last)}.`
      : 'קובץ השערים לא נטען.';
  }

  // ------------------------------------------------------------ import

  function setMsg(el, text, kind) { el.className = `msg ${kind || ''}`; el.textContent = text; }

  async function onFile(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const msg = $('#import-msg');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      let best = { lots: [], warnings: ['הקובץ ריק'] };
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        const res = Core.parseEtradeRows(rows);
        if (res.lots.length > best.lots.length) best = res;
      }
      if (!best.lots.length) { setMsg(msg, `לא יובאו עסקאות. ${best.warnings.join(' · ')}`, 'err'); return; }
      const added = best.lots.map(l => ({ ...blankLot(), ...l, sec102: null }));
      lots = lots.concat(added).sort((a, b) => (a.dateSold || '').localeCompare(b.dateSold || '') || (a.dateAcquired || '').localeCompare(b.dateAcquired || ''));
      renderTable();
      const extra = best.warnings.length ? ` שים לב: ${best.warnings.join(' · ')}` : '';
      setMsg(msg, `יובאו ${added.length} שורות מכירה מהקובץ ${file.name}.${extra}`, best.warnings.length ? 'warn' : 'ok');
    } catch (e) {
      console.error(e);
      setMsg(msg, `לא הצלחנו לקרוא את הקובץ: ${e.message}`, 'err');
    }
  }

  // ------------------------------------------------------------ export

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

  function readyItems() {
    const items = computeAll();
    const ok = items.filter(it => it.calc.ok);
    return { items, ok, bad: items.length - ok.length };
  }

  async function onPdf() {
    const msg = $('#export-msg');
    const { ok, bad } = readyItems();
    if (!ok.length) { setMsg(msg, 'אין עסקאות תקינות להורדה. השלם את השדות החסרים בטבלה.', 'err'); return; }
    const btn = $('#dl-pdf');
    btn.disabled = true;
    setMsg(msg, 'מכין את ה‑PDF...', '');
    try {
      const [formBytes, fontBytes] = await Promise.all([
        fetchBytes('assets/forms/form-1399y-2025-blank.pdf'),
        fetchBytes('assets/fonts/NotoSansHebrew_400Regular.ttf'),
      ]);
      const items = ok.map(it => ({ lot: { ...it.lot, sec102: it.lot.sec102 ?? profile.sec102 }, calc: it.calc }));
      const bytes = await window.Pdf1399.buildPdf({ formBytes, fontBytes, profile: { ...profile, signDate: profile.signDate || today() }, items });
      const year = ok[0].lot.dateSold.slice(0, 4);
      download(bytes, `form-1399-${year}.pdf`, 'application/pdf');
      setMsg(msg, `נוצר PDF עם ${ok.length} טפסים ודף סיכום.${bad ? ` ${bad} שורות עם שגיאות לא נכללו.` : ''}`, bad ? 'warn' : 'ok');
    } catch (e) {
      console.error(e);
      const hint = location.protocol === 'file:' ? ' הדף נפתח ישירות מהדיסק, והדפדפן חוסם טעינת קבצים. צריך לפתוח אותו דרך GitHub Pages או שרת מקומי (python3 -m http.server).' : '';
      setMsg(msg, `יצירת ה‑PDF נכשלה: ${e.message}.${hint}`, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function onXlsx() {
    const msg = $('#export-msg');
    const { ok } = readyItems();
    if (!ok.length) { setMsg(msg, 'אין עסקאות תקינות להורדה.', 'err'); return; }
    const rows = ok.map(({ lot, calc }, i) => ({
      '#': i + 1, 'נייר': lot.symbol, 'תוכנית': lot.planType, 'כמות': lot.qty,
      'תאריך רכישה': Core.formatDateIL(lot.dateAcquired), 'תאריך מכירה': Core.formatDateIL(lot.dateSold),
      'שער רכישה': calc.buy.rate, 'שער מכירה': calc.sell.rate,
      'תמורה $': lot.proceedsUsd, 'עלות $': lot.costUsd, 'עמלות $': lot.feesUsd || 0,
      'תמורה ₪': calc.proceedsIls, 'עלות ₪': calc.costIls, 'עמלות ₪': calc.feesIls,
      'רווח נומינלי ₪': calc.nominal, 'סכום אינפלציוני ₪': calc.inflationary, 'רווח/הפסד ריאלי ₪': calc.real, 'מס 25% ₪': calc.tax,
    }));
    const sums = Core.summarize(ok).map(g => ({
      'תקופה': g.label, 'מכירות': g.count, 'תמורה ₪': g.proceedsIls, 'רווחים ריאליים ₪': g.gains,
      'הפסדים לקיזוז ₪': g.losses, 'רווח ריאלי נטו ₪': g.net, 'מס משוער 25% ₪': g.tax,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'עסקאות');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sums), 'סיכום');
    const checks = [];
    for (const { lot } of ok) {
      for (const [label, date] of [['רכישה', lot.dateAcquired], ['מכירה', lot.dateSold]]) {
        const cc = Core.crossCheck(SOURCES, date);
        checks.push({
          'נייר': lot.symbol, 'אירוע': label, 'תאריך': Core.formatDateIL(date),
          'בנק ישראל': cc.boi ? cc.boi.rate : '', 'ECB': cc.checks.ecb.rate ?? '', 'סטייה ECB %': cc.checks.ecb.devPct ?? '',
          'Yahoo': cc.checks.yahoo.rate ?? '', 'סטייה Yahoo %': cc.checks.yahoo.devPct ?? '',
          'שעת מכירה (ניו יורק)': label === 'מכירה' ? (lot.timeSold || '') : '',
        });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checks), 'בקרת שערים');
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, `capital-gains-${ok[0].lot.dateSold.slice(0, 4)}.xlsx`);
    setMsg(msg, 'קובץ ה‑Excel ירד.', 'ok');
  }

  // ------------------------------------------------------------ init

  function init() {
    bindProfile();
    const body = $('#tx-body');
    body.addEventListener('input', onTableInput);
    body.addEventListener('change', onTableInput);
    body.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-del]');
      if (!btn) return;
      const id = +btn.closest('tr').dataset.id;
      lots = lots.filter(l => l.id !== id);
      renderTable();
    });
    $('#file').addEventListener('change', onFile);
    $('#add-row').addEventListener('click', () => { lots.push(blankLot()); renderTable(); });
    $('#load-example').addEventListener('click', () => {
      lots = lots.concat(EXAMPLE.map(l => ({ ...blankLot(), ...l })));
      renderTable();
      setMsg($('#import-msg'), 'נטענה דוגמה: מכירת 17 מניות QCOM מתוכנית ESPP.', 'ok');
    });
    $('#clear-all').addEventListener('click', () => {
      if (!lots.length) return;
      if (!confirm(`למחוק את כל ${lots.length} העסקאות מהטבלה?`)) return;
      lots = [];
      renderTable();
    });
    $('#dl-pdf').addEventListener('click', onPdf);
    $('#dl-xlsx').addEventListener('click', onXlsx);
    renderTable();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
